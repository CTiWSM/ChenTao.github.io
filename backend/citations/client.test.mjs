import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const publicRoot = new URL(existsSync(new URL('../../citation-counts.js', import.meta.url)) ? '../../' : '../../docs/', import.meta.url);
const script = readFileSync(new URL('citation-counts.js', publicRoot), 'utf8');
const snapshot = JSON.parse(readFileSync(new URL('assets/citations-initial.json', publicRoot), 'utf8'));

async function preview(payload, { fail = false, hostname = 'ctiwsm.github.io', pending = false,
  numericInitial = false, language = 'zh-CN' } = {}) {
  const items = snapshot.papers.map((row) => ({ dataset: { citationsPaper: row.paper },
    textContent: numericInitial ? (row.count === null ? '—' : String(row.count)) : 'initial ' + row.paper,
    href: row.url, title: '', attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; } }));
  const initialRows = items.map((item) => ({ item, querySelector: () => item }));
  const list = { children: initialRows.slice(), appendChild(row) {
    this.children = this.children.filter((existing) => existing !== row); this.children.push(row);
  } };
  const symbol = { textContent: '↕' };
  const button = { disabled: true, attributes: { 'aria-pressed': 'false' },
    querySelector: () => symbol, listeners: {},
    addEventListener(name, callback) { this.listeners[name] = callback; },
    setAttribute(name, value) { this.attributes[name] = value; },
    click() { this.listeners.click(); } };
  const section = { dataset: { citationsApi: 'https://api.example.test/api/citations' },
    querySelectorAll: () => items,
    querySelector: (selector) => selector === '.publication-list' ? list : selector === '[data-citations-sort]' ? button : null };
  let requested;
  let requests = 0;
  let resolveFetch;
  const events = {};
  const context = { document: { documentElement: { lang: language }, querySelector: () => section },
    window: { location: { hostname }, addEventListener(name, callback) { events[name] = callback; } }, URL, Date, Intl, AbortController,
    setTimeout: () => 1, clearTimeout: () => {},
    fetch: async (url) => { requested = url; requests++; if (fail) throw new Error('offline');
      if (pending) return new Promise((resolve) => { resolveFetch = resolve; });
      return { ok: true, json: async () => payload }; } };
  vm.runInNewContext(script, context);
  await new Promise(setImmediate);
  await new Promise(setImmediate);
  return { items, requested, button, symbol, list, initialRows,
    order: () => list.children.map((row) => row.item.dataset.citationsPaper),
    requests: () => requests, pageshow: (persisted) => events.pageshow({ persisted }),
    deliver: async (value) => {
      resolveFetch({ ok: true, json: async () => value });
      await new Promise(setImmediate); await new Promise(setImmediate);
    } };
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

test('first click sorts numerically descending and the second restores exact original order', async () => {
  const result = await preview(snapshot);
  const original = result.order();
  assert.equal(result.button.disabled, false);
  result.button.click();
  assert.deepEqual(result.order(), ['metamaterials', 'lidar', 'mff', 'hsm', 'phase', 'ssrn-7600475', 'dualss', 'entropy']);
  assert.equal(result.symbol.textContent, '↓');
  assert.equal(result.button.attributes['aria-pressed'], 'true');
  assert.equal(new Set(result.list.children).size, 8);
  assert.ok(result.initialRows.every((row) => result.list.children.includes(row)));
  result.button.click();
  assert.deepEqual(result.order(), original);
  assert.equal(result.symbol.textContent, '↕');
  assert.equal(result.button.attributes['aria-pressed'], 'false');
  assert.equal(result.requests(), 1);
});

test('ties retain original positions and a real zero precedes all missing values', async () => {
  const data = structuredClone(snapshot);
  data.papers.find((row) => row.paper === 'mff').count = 14;
  data.papers.find((row) => row.paper === 'dualss').count = 0;
  const result = await preview(data);
  result.button.click();
  assert.deepEqual(result.order(), ['metamaterials', 'mff', 'lidar', 'hsm', 'phase', 'dualss', 'ssrn-7600475', 'entropy']);
});

test('sorting works before fetch and remains descending when fresh data arrives', async () => {
  const result = await preview(snapshot, { pending: true, numericInitial: true });
  const original = result.order();
  result.button.click();
  assert.equal(result.order()[0], 'metamaterials');
  const data = structuredClone(snapshot);
  data.papers.find((row) => row.paper === 'mff').count = 30;
  await result.deliver(data);
  assert.equal(result.order()[0], 'mff');
  assert.equal(result.symbol.textContent, '↓');
  result.button.click();
  assert.deepEqual(result.order(), original);
  assert.equal(result.items.find((row) => row.dataset.citationsPaper === 'mff').textContent, '30');
});

test('page/history restoration and a new language page both reset sorting', async () => {
  const result = await preview(snapshot);
  const original = result.order();
  result.button.click();
  result.pageshow(true);
  assert.deepEqual(result.order(), original);
  assert.equal(result.button.attributes['aria-pressed'], 'false');
  assert.equal(result.symbol.textContent, '↕');
  const english = await preview(snapshot, { language: 'en' });
  assert.deepEqual(english.order(), original);
  assert.equal(english.symbol.textContent, '↕');
});
