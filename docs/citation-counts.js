(function () {
  'use strict';
  const section = document.querySelector('[data-citations-api]');
  if (!section) return;
  const items = Array.from(section.querySelectorAll('[data-citations-paper]'));
  const zh = document.documentElement.lang.toLowerCase().startsWith('zh');
  const list = section.querySelector('.publication-list');
  const sortButton = section.querySelector('[data-citations-sort]');
  const sortSymbol = sortButton?.querySelector('[data-sort-symbol]');
  const originalRows = list ? Array.from(list.children) : [];
  const originalPosition = new Map(originalRows.map(function (row, index) { return [row, index]; }));
  let descending = false;

  function rowCount(row) {
    const text = row.querySelector('[data-citations-paper]')?.textContent.trim() || '';
    if (!/^\d+$/.test(text)) return null;
    const value = Number(text);
    return Number.isSafeInteger(value) ? value : null;
  }

  function applyOrder() {
    if (!list || !sortButton || !sortSymbol) return;
    const ordered = originalRows.slice();
    if (descending) {
      ordered.sort(function (left, right) {
        const a = rowCount(left);
        const b = rowCount(right);
        const stable = originalPosition.get(left) - originalPosition.get(right);
        if (a === null) return b === null ? stable : 1;
        if (b === null) return -1;
        return b - a || stable;
      });
    }
    ordered.forEach(function (row) { list.appendChild(row); });
    sortSymbol.textContent = descending ? '↓' : '↕';
    sortButton.setAttribute('aria-pressed', String(descending));
    const action = descending ? (zh ? '恢复原始顺序' : 'Restore original order')
      : (zh ? '按引用量降序排列' : 'Sort citations descending');
    sortButton.setAttribute('aria-label', action);
    sortButton.title = action;
  }

  if (sortButton && sortSymbol && list) {
    sortButton.addEventListener('click', function () { descending = !descending; applyOrder(); });
    sortButton.disabled = false;
    window.addEventListener('pageshow', function (event) {
      if (event.persisted) { descending = false; applyOrder(); }
    });
  }

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
      const count = row.count === null ? '—' : String(row.count);
      item.textContent = count;
      item.setAttribute('aria-label', (zh ? 'Google Scholar 引用量：' : 'Google Scholar citations: ') + count);
      item.href = row.url;
      item.title = row.state === 'not_in_profile'
        ? (zh ? 'Google Scholar 档案中尚无此条目' : 'Not yet listed in this Google Scholar profile')
        : row.count === null
          ? (zh ? 'Google Scholar 未显示引用次数' : 'Google Scholar does not display a citation count')
          : 'Google Scholar';
    });
    if (descending) applyOrder();
  }

  const controller = new AbortController();
  const timeout = setTimeout(function () { controller.abort(); }, 10000);
  const local = window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost';
  const endpoint = local ? 'assets/citations-initial.json' : section.dataset.citationsApi;
  fetch(endpoint, { signal: controller.signal, credentials: 'omit' })
    .then(function (response) { if (!response.ok) throw new Error('unavailable'); return response.json(); })
    .then(render)
    .catch(function () { /* Keep the verified snapshot already rendered in the page. */ })
    .finally(function () { clearTimeout(timeout); });
}());
