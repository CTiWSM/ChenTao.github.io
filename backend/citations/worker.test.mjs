import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import worker, { buildSnapshot, saveSnapshot, refreshCitations, PROFILE_ID } from './worker.js';
import { SQLiteD1 } from '../tests/sqlite-d1.mjs';

const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
const example = [
  ['u5HHmVD_uO8C', 22], ['u-x6o8ySG0sC', 14], ['9yKSN-GCB0IC', 11],
  ['UeHWp8X0CEIC', 2], ['d1gkVwhDpl0C', 1], ['qjMakFHDy7sC', null], ['2osOgNQ5qMEC', null],
];
function source(date = new Date()) {
  return { search_metadata: { status: 'Success', processed_at: date.toISOString() },
    search_parameters: { engine: 'google_scholar_author', author_id: PROFILE_ID },
    articles: example.map(([id, count]) => ({ citation_id: PROFILE_ID + ':' + id,
      title: 'Title is not used to join mapped articles', cited_by: { value: count, cites_id: '1234567890123456789' } })) };
}
function db(t) {
  const database = new SQLiteD1();
  database.sqlite.exec(schema);
  t.after(() => database.close());
  return database;
}
const read = (database) => database.prepare('SELECT payload_json FROM scholar_citation_snapshots WHERE profile_id=?').bind(PROFILE_ID).first();
const request = (method = 'GET', path = '/api/citations') => new Request('https://example.workers.dev' + path, { method });

test('article IDs join independently of source ordering; blank and not-in-profile remain distinct', () => {
  const data = source();
  data.articles.reverse();
  const snapshot = buildSnapshot(data);
  const rows = Object.fromEntries(snapshot.papers.map((row) => [row.paper, row]));
  assert.equal(rows.metamaterials.count, 22);
  assert.equal(rows.lidar.count, 14);
  assert.equal(rows.mff.count, 11);
  assert.equal(rows.hsm.count, 2);
  assert.equal(rows.phase.count, 1);
  assert.equal(rows.dualss.count, null);
  assert.equal(rows.dualss.state, 'blank');
  assert.equal(rows['ssrn-7600475'].state, 'not_in_profile');
  assert.equal(snapshot.papers.length, 8);
});

test('an explicit zero and a legitimate decrease are accepted', () => {
  const data = source();
  data.articles[0].cited_by.value = 21;
  data.articles[5].cited_by.value = 0;
  const snapshot = buildSnapshot(data);
  assert.equal(snapshot.papers.find((row) => row.paper === 'metamaterials').count, 21);
  assert.equal(snapshot.papers.find((row) => row.paper === 'dualss').count, 0);
  assert.equal(snapshot.papers.find((row) => row.paper === 'dualss').state, 'available');
});

test('wrong profile, duplicates, missing mapped articles and malformed counts are rejected', () => {
  for (const mutate of [
    (s) => { s.search_parameters.author_id = 'another-author'; },
    (s) => { s.articles.push(s.articles[0]); },
    (s) => { s.articles.pop(); },
    (s) => { s.articles[0].cited_by.value = -1; },
    (s) => { s.articles[0].cited_by.value = '22'; },
    (s) => { s.articles[0].cited_by = {}; },
    (s) => { s.serpapi_pagination = { next: 'more' }; },
    (s) => { s.search_metadata.status = 'Error'; },
  ]) {
    const data = source();
    mutate(data);
    assert.throws(() => buildSnapshot(data));
  }
});

test('stale and future upstream timestamps are rejected', () => {
  assert.throws(() => buildSnapshot(source(new Date(Date.now() - 90000000))));
  assert.throws(() => buildSnapshot(source(new Date(Date.now() + 600000))));
});

test('upstream failure preserves the last success and does not expose the credential', async (t) => {
  const database = db(t);
  await saveSnapshot(database, buildSnapshot(source()));
  const previous = await read(database);
  const key = 'x'.repeat(64);
  await assert.rejects(refreshCitations({ DB: database, SERPAPI_API_KEY: key }, async () => {
    throw new Error('Network failure in a credential-bearing request: ' + key);
  }), (error) => error.message === 'upstream_unavailable' && !error.message.includes(key));
  assert.deepEqual(await read(database), previous);
  await assert.rejects(refreshCitations({ DB: database, SERPAPI_API_KEY: key }, async () =>
    Response.json({ error: 'quota' }, { status: 429 })), /upstream_http_429/);
  assert.deepEqual(await read(database), previous);
});

test('a refresh writes only sanitized public fields and leaves likes unchanged', async (t) => {
  const database = db(t);
  const before = database.sqlite.prepare('SELECT * FROM like_totals').all();
  const key = 'x'.repeat(64);
  let calls = 0;
  const snapshot = await refreshCitations({ DB: database, SERPAPI_API_KEY: key }, async (url) => {
    calls++;
    const u = new URL(url);
    assert.equal(u.searchParams.get('author_id'), PROFILE_ID);
    assert.equal(u.searchParams.get('num'), '100');
    assert.equal(u.searchParams.get('no_cache'), 'true');
    return Response.json({ ...source(), echoed_credential: key });
  });
  assert.equal(calls, 1);
  assert.ok(!(await read(database)).payload_json.includes(key));
  assert.deepEqual(database.sqlite.prepare('SELECT * FROM like_totals').all(), before);
  assert.equal(snapshot.profile_id, PROFILE_ID);
});

test('older overlapping refreshes cannot overwrite a newer snapshot', async (t) => {
  const database = db(t);
  const newer = buildSnapshot(source());
  await saveSnapshot(database, newer);
  const olderSource = source(new Date(Date.now() - 60000));
  olderSource.articles[0].cited_by.value = 1;
  await saveSnapshot(database, buildSnapshot(olderSource));
  assert.equal(JSON.parse((await read(database)).payload_json).updated_at, newer.updated_at);
});

test('public GET reads the cache; other routes and methods cannot trigger a refresh', async (t) => {
  const database = db(t);
  assert.equal((await worker.fetch(request(), { DB: database })).status, 503);
  await saveSnapshot(database, buildSnapshot(source()));
  const response = await worker.fetch(request(), { DB: database });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal((await response.json()).papers.length, 8);
  assert.equal((await worker.fetch(request('POST'), { DB: database })).status, 405);
  assert.equal((await worker.fetch(request('GET', '/api/citations?refresh=1'), { DB: database })).status, 404);
});
