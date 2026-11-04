(function () {
  'use strict';
  const section = document.querySelector('[data-citations-api]');
  if (!section) return;
  const status = section.querySelector('[data-citations-updated]');
  const items = Array.from(section.querySelectorAll('[data-citations-paper]'));
  const zh = document.documentElement.lang.toLowerCase().startsWith('zh');

  function render(payload) {
    if (payload?.schema_version !== 1 || payload.profile_id !== 'krmeL-4AAAAJ' ||
        !Array.isArray(payload.papers) || payload.papers.length !== items.length ||
        !Number.isFinite(Date.parse(payload.updated_at))) return;
    const rows = new Map();
    for (const row of payload.papers) {
      if (!row || typeof row.paper !== 'string' || rows.has(row.paper) ||
          !(row.count === null || (Number.isSafeInteger(row.count) && row.count >= 0))) return;
      let link;
      try { link = new URL(row.url); } catch { return; }
      if (link.protocol !== 'https:' || link.hostname !== 'scholar.google.com') return;
      rows.set(row.paper, row);
    }
    if (items.some((item) => !rows.has(item.dataset.citationsPaper))) return;
    items.forEach(function (item) {
      const row = rows.get(item.dataset.citationsPaper);
      item.textContent = (zh ? '被引 ' : 'Cited by ') + (row.count === null ? '—' : row.count);
      item.href = row.url;
      item.title = row.state === 'not_in_profile'
        ? (zh ? 'Google Scholar 档案中尚无此条目' : 'Not yet listed in this Google Scholar profile')
        : row.count === null
          ? (zh ? 'Google Scholar 未显示引用次数' : 'Google Scholar does not display a citation count')
          : 'Google Scholar';
    });
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai',
      year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(payload.updated_at));
    const stale = Date.now() - Date.parse(payload.updated_at) > 48 * 60 * 60 * 1000;
    if (status) {
      status.textContent = 'Google Scholar · ' + (zh ? '更新于 ' : 'Updated ') + day +
        (stale ? (zh ? '（上次成功同步）' : ' (last successful sync)') : '');
      status.dataset.citationsTimestamp = payload.updated_at;
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(function () { controller.abort(); }, 10000);
  const local = window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost';
  const endpoint = local ? 'assets/citations-initial.json' : section.dataset.citationsApi;
  fetch(endpoint, { signal: controller.signal, credentials: 'omit' })
    .then(function (response) { if (!response.ok) throw new Error('unavailable'); return response.json(); })
    .then(render)
    .catch(function () { /* Keep the dated, verified snapshot already rendered in the page. */ })
    .finally(function () { clearTimeout(timeout); });
}());
