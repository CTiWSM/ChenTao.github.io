import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const publicRoot = new URL(existsSync(new URL('../../citation-counts.js', import.meta.url)) ? '../../' : '../../docs/', import.meta.url);
const script = readFileSync(new URL('citation-counts.js', publicRoot), 'utf8');
const snapshot = JSON.parse(readFileSync(new URL('assets/citations-initial.json', publicRoot), 'utf8'));

async function preview(payload, { fail = false, hostname = 'ctiwsm.github.io' } = {}) {
  const items = snapshot.papers.map((row) => ({ dataset: { citationsPaper: row.paper },
    textContent: 'initial ' + row.paper, href: row.url, title: '', attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; } }));
  const section = { dataset: { citationsApi: 'https://api.example.test/api/citations' },
    querySelectorAll: () => items };
  let requested;
  const context = { document: { documentElement: { lang: 'zh-CN' }, querySelector: () => section },
    window: { location: { hostname } }, URL, Date, Intl, AbortController,
    setTimeout: () => 1, clearTimeout: () => {},
    fetch: async (url) => { requested = url; if (fail) throw new Error('offline');
      return { ok: true, json: async () => payload }; } };
  vm.runInNewContext(script, context);
  await new Promise(setImmediate);
  await new Promise(setImmediate);
  return { items, requested };
}

test('citation column contains only a number or dash and preserves accessible labels', async () => {
  const data = structuredClone(snapshot);
  data.papers.find((row) => row.paper === 'dualss').count = 0;
  data.papers.find((row) => row.paper === 'dualss').state = 'available';
  const result = await preview(data);
  assert.equal(result.items.find((row) => row.dataset.citationsPaper === 'metamaterials').textContent, '22');
  assert.equal(result.items.find((row) => row.dataset.citationsPaper === 'dualss').textContent, '0');
  assert.equal(result.items.find((row) => row.dataset.citationsPaper === 'entropy').textContent, '—');
  assert.equal(result.items.find((row) => row.dataset.citationsPaper === 'metamaterials').attributes['aria-label'], 'Google Scholar 引用量：22');
});

test('incomplete responses cannot partially replace the dated initial snapshot', async () => {
  const data = structuredClone(snapshot);
  data.papers.pop();
  const result = await preview(data);
  assert.ok(result.items.every((row) => row.textContent.startsWith('initial ')));
});

test('unsafe source links and invalid numeric types are rejected before updating any row', async () => {
  for (const mutate of [
    (p) => { p.papers[3].url = 'javascript:alert(1)'; },
    (p) => { p.papers[3].count = '11'; },
    (p) => { p.profile_id = 'different-profile'; },
  ]) {
    const data = structuredClone(snapshot);
    mutate(data);
    const result = await preview(data);
    assert.ok(result.items.every((row) => row.textContent.startsWith('initial ')));
  }
});

test('network failure preserves the previously rendered values', async () => {
  const result = await preview(snapshot, { fail: true });
  assert.ok(result.items.every((row) => row.textContent.startsWith('initial ')));
});

test('local preview reads the public initial JSON without consuming an API search', async () => {
  const result = await preview(snapshot, { hostname: '127.0.0.1' });
  assert.equal(result.requested, 'assets/citations-initial.json');
});
