// Citation data only. This Worker never changes the homepage's likes tables.
export const PROFILE_ID = 'krmeL-4AAAAJ';
export const PROFILE_URL = `https://scholar.google.com/citations?user=${PROFILE_ID}&hl=en`;
export const PAPERS = [
  { paper: 'ssrn-7600475', id: null, title: 'A Clinical Study Of Pelvic Floor Continence Reserve-Guided Radical Anus-Preserving Resection For Anal Canal And Ultralow Rectal Cancers' },
  { paper: 'dualss', id: 'qjMakFHDy7sC' },
  { paper: 'entropy', id: '2osOgNQ5qMEC' },
  { paper: 'mff', id: '9yKSN-GCB0IC' },
  { paper: 'hsm', id: 'UeHWp8X0CEIC' },
  { paper: 'lidar', id: 'u-x6o8ySG0sC' },
  { paper: 'phase', id: 'd1gkVwhDpl0C' },
  { paper: 'metamaterials', id: 'u5HHmVD_uO8C' },
];

class SyncError extends Error {
  constructor(code) { super(code); this.code = code; }
}

function titleKey(value) {
  return String(value).normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function articleUrl(id) {
  const url = new URL('https://scholar.google.com/citations');
  url.search = new URLSearchParams({ view_op: 'view_citation', user: PROFILE_ID,
    citation_for_view: id, hl: 'en' });
  return url.href;
}

export function validateSnapshot(value) {
  if (value?.schema_version !== 1 || value.profile_id !== PROFILE_ID ||
      !Number.isFinite(Date.parse(value.updated_at)) || !Array.isArray(value.papers) ||
      value.papers.length !== PAPERS.length) throw new SyncError('invalid_snapshot');
  const allowedStates = new Set(['available', 'blank', 'not_in_profile']);
  for (let i = 0; i < PAPERS.length; i++) {
    const row = value.papers[i];
    if (row?.paper !== PAPERS[i].paper || !allowedStates.has(row.state) ||
        !(row.count === null || (Number.isSafeInteger(row.count) && row.count >= 0)) ||
        (row.state === 'available') !== (row.count !== null)) throw new SyncError('invalid_snapshot');
    const link = new URL(row.url);
    if (link.protocol !== 'https:' || link.hostname !== 'scholar.google.com') throw new SyncError('invalid_snapshot');
  }
  return value;
}

export function buildSnapshot(source, now = new Date()) {
  if (source?.search_metadata?.status !== 'Success' ||
      source.search_parameters?.author_id !== PROFILE_ID ||
      source.search_parameters?.engine !== 'google_scholar_author' ||
      !Array.isArray(source.articles) || source.articles.length === 0 || source.articles.length > 100 ||
      source.serpapi_pagination?.next) throw new SyncError('incomplete_profile');
  const byId = new Map();
  for (const article of source.articles) {
    const id = article.citation_id;
    if (typeof id !== 'string' || !id.startsWith(PROFILE_ID + ':') ||
        !/^[A-Za-z0-9_-]+$/.test(id.slice(PROFILE_ID.length + 1)) || byId.has(id)) throw new SyncError('invalid_article_ids');
    byId.set(id, article);
  }
  const processed = String(source.search_metadata.processed_at || '').replace(' UTC', 'Z').replace(' ', 'T');
  const observed = new Date(processed);
  if (!Number.isFinite(observed.getTime()) || observed.getTime() > now.getTime() + 300000 ||
      now.getTime() - observed.getTime() > 86400000) throw new SyncError('invalid_source_timestamp');
  const papers = PAPERS.map((definition) => {
    let article;
    if (definition.id) {
      article = byId.get(PROFILE_ID + ':' + definition.id);
      if (!article) throw new SyncError('mapped_article_missing');
    } else {
      const matches = source.articles.filter((a) => titleKey(a.title) === titleKey(definition.title));
      if (matches.length > 1) throw new SyncError('ambiguous_new_article');
      article = matches[0];
      if (!article) return { paper: definition.paper, count: null, state: 'not_in_profile',
        scholar_id: null, url: PROFILE_URL };
    }
    if (!article.cited_by || !Object.hasOwn(article.cited_by, 'value')) throw new SyncError('missing_count_field');
    const count = article.cited_by.value;
    if (count !== null && !(Number.isSafeInteger(count) && count >= 0)) throw new SyncError('invalid_count');
    const citesId = article.cited_by.cites_id;
    const url = count !== null && count > 0 && /^\d{1,24}$/.test(String(citesId || ''))
      ? `https://scholar.google.com/scholar?hl=en&cites=${citesId}` : articleUrl(article.citation_id);
    return { paper: definition.paper, count, state: count === null ? 'blank' : 'available',
      scholar_id: article.citation_id, url };
  });
  return validateSnapshot({ schema_version: 1, profile_id: PROFILE_ID, source: 'Google Scholar',
    updated_at: observed.toISOString(), papers });
}

export async function saveSnapshot(database, snapshot) {
  validateSnapshot(snapshot);
  const results = await database.batch([database.prepare(
    'INSERT INTO scholar_citation_snapshots (profile_id, payload_json, updated_at) VALUES (?, ?, ?) ' +
    'ON CONFLICT(profile_id) DO UPDATE SET payload_json=excluded.payload_json, updated_at=excluded.updated_at ' +
    'WHERE excluded.updated_at >= scholar_citation_snapshots.updated_at'
  ).bind(PROFILE_ID, JSON.stringify(snapshot), snapshot.updated_at)]);
  if (!Array.isArray(results) || results.some((result) => result.success !== true)) throw new SyncError('storage_failed');
}

export async function refreshCitations(env, fetcher = fetch) {
  if (typeof env.SERPAPI_API_KEY !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(env.SERPAPI_API_KEY)) {
    throw new SyncError('missing_credential');
  }
  const url = new URL('https://serpapi.com/search.json');
  url.search = new URLSearchParams({ engine: 'google_scholar_author', author_id: PROFILE_ID,
    hl: 'en', num: '100', no_cache: 'true', api_key: env.SERPAPI_API_KEY });
  let source;
  try {
    const response = await fetcher(url.href, { signal: AbortSignal.timeout(45000) });
    if (!response.ok) throw new SyncError('upstream_http_' + response.status);
    source = await response.json();
  } catch (error) {
    if (error instanceof SyncError) throw error;
    throw new SyncError('upstream_unavailable');
  }
  const snapshot = buildSnapshot(source);
  await saveSnapshot(env.DB, snapshot);
  return snapshot;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': status === 200 ? 'public, max-age=300' : 'no-store',
    'X-Content-Type-Options': 'nosniff',
  } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/api/citations' || url.search) return json({ error: 'not_found' }, 404);
    if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
    try {
      const row = await env.DB.prepare('SELECT payload_json FROM scholar_citation_snapshots WHERE profile_id = ?')
        .bind(PROFILE_ID).first();
      if (!row) return json({ error: 'citations_unavailable' }, 503);
      return json(validateSnapshot(JSON.parse(row.payload_json)));
    } catch {
      return json({ error: 'citations_unavailable' }, 503);
    }
  },
  async scheduled(_controller, env) {
    try {
      await refreshCitations(env);
    } catch (error) {
      // Never log upstream URLs, response bodies or credential-bearing exceptions.
      throw new Error(error instanceof SyncError ? error.code : 'citation_sync_failed');
    }
  },
};
