const SITE = "chentao-homepage";
const MAX_BODY_BYTES = 256;
const ALLOWED_ORIGINS = new Set([
  "https://ctiwsm.github.io",
  "http://127.0.0.1:8765",
  "http://localhost:8765",
]);
const ALLOWED_HEADERS = new Set(["content-type", "x-visitor-id"]);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class RequestError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function responseHeaders(origin) {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    Vary: "Origin",
  });
  if (ALLOWED_ORIGINS.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return headers;
}

function jsonResponse(body, status, origin, extraHeaders = {}) {
  const headers = responseHeaders(origin);
  for (const [key, value] of Object.entries(extraHeaders)) {
    headers.set(key, value);
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function validateVisitorId(value) {
  if (typeof value !== "string" || !UUID_V4.test(value)) {
    throw new RequestError(400, "invalid_visitor_id");
  }
  return value.toLowerCase();
}

async function hashVisitorId(visitorId) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(visitorId),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function readPostVisitorId(request) {
  const mediaType = (request.headers.get("Content-Type") || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    throw new RequestError(415, "json_required");
  }

  const declaredLength = request.headers.get("Content-Length");
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) {
      throw new RequestError(400, "invalid_content_length");
    }
    if (Number(declaredLength) > MAX_BODY_BYTES) {
      throw new RequestError(413, "body_too_large");
    }
  }
  if (!request.body) throw new RequestError(400, "invalid_json");

  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        // Cancellation must not delay the rejection of an oversized body.
        void reader.cancel().catch(() => {});
        throw new RequestError(413, "body_too_large");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError(400, "invalid_body");
  } finally {
    reader.releaseLock();
  }

  let body;
  try {
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new RequestError(400, "invalid_json");
  }
  if (
    body === null ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    !Object.hasOwn(body, "visitorId")
  ) {
    throw new RequestError(400, "invalid_body");
  }
  return validateVisitorId(body.visitorId);
}

function readCountStatement(database, visitorHash) {
  if (visitorHash === null) {
    return database
      .prepare("SELECT total AS count, 0 AS liked FROM like_totals WHERE site = ?")
      .bind(SITE);
  }
  return database
    .prepare(
      "SELECT total AS count, " +
        "EXISTS(SELECT 1 FROM likes WHERE site = ? AND visitor_hash = ?) AS liked " +
        "FROM like_totals WHERE site = ?",
    )
    .bind(SITE, visitorHash, SITE);
}

function validateCountRow(row) {
  if (
    !row ||
    !Number.isSafeInteger(row.count) ||
    row.count < 0 ||
    (row.liked !== 0 && row.liked !== 1)
  ) {
    throw new Error("Invalid database result");
  }
  return { site: SITE, count: row.count, liked: row.liked === 1 };
}

function preflight(request, origin) {
  if (!ALLOWED_ORIGINS.has(origin)) {
    throw new RequestError(403, "origin_not_allowed");
  }
  const method = request.headers.get("Access-Control-Request-Method");
  if (method !== "GET" && method !== "POST") {
    throw new RequestError(403, "preflight_not_allowed");
  }
  const requestedHeaders = request.headers.get("Access-Control-Request-Headers");
  if (requestedHeaders !== null) {
    const names = requestedHeaders.split(",").map((value) => value.trim().toLowerCase());
    if (names.some((name) => !ALLOWED_HEADERS.has(name))) {
      throw new RequestError(403, "preflight_not_allowed");
    }
  }
  const headers = responseHeaders(origin);
  headers.delete("Content-Type");
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, X-Visitor-Id");
  headers.set("Access-Control-Max-Age", "600");
  headers.set("Vary", "Origin, Access-Control-Request-Method, Access-Control-Request-Headers");
  return new Response(null, { status: 204, headers });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    try {
      const url = new URL(request.url);
      if (url.pathname !== "/api/likes") {
        throw new RequestError(404, "not_found");
      }
      if (url.search) throw new RequestError(400, "query_not_supported");
      if (!["GET", "POST", "OPTIONS"].includes(request.method)) {
        return jsonResponse({ error: "method_not_allowed" }, 405, origin, {
          Allow: "GET, POST, OPTIONS",
        });
      }
      if (origin !== null && !ALLOWED_ORIGINS.has(origin)) {
        throw new RequestError(403, "origin_not_allowed");
      }
      if (request.method === "OPTIONS") return preflight(request, origin);

      if (request.method === "GET") {
        const visitorHeader = request.headers.get("X-Visitor-Id");
        const visitorHash = visitorHeader === null
          ? null
          : await hashVisitorId(validateVisitorId(visitorHeader));
        const row = await readCountStatement(env.DB, visitorHash).first();
        return jsonResponse(validateCountRow(row), 200, origin);
      }

      if (!ALLOWED_ORIGINS.has(origin)) {
        throw new RequestError(403, "origin_not_allowed");
      }
      const visitorHash = await hashVisitorId(await readPostVisitorId(request));
      // A unique key and database triggers handle concurrent requests atomically.
      // There is no read-increment-write operation in application code.
      const results = await env.DB.batch([
        env.DB
          .prepare(
            "INSERT INTO likes (site, visitor_hash) VALUES (?, ?) " +
              "ON CONFLICT(site, visitor_hash) DO NOTHING",
          )
          .bind(SITE, visitorHash),
        readCountStatement(env.DB, visitorHash),
      ]);
      if (
        !Array.isArray(results) ||
        results.length !== 2 ||
        results.some((result) => result.success !== true) ||
        !Number.isSafeInteger(results[0].meta?.changes) ||
        results[0].meta.changes < 0
      ) {
        throw new Error("Invalid database batch result");
      }
      const body = validateCountRow(results[1].results?.[0]);
      if (!body.liked) throw new Error("Missing committed like");
      const added = results[0].meta.changes > 0;
      return jsonResponse({ ...body, liked: true, added }, added ? 201 : 200, origin);
    } catch (error) {
      if (error instanceof RequestError) {
        return jsonResponse({ error: error.code }, error.status, origin);
      }
      // Database errors and deployment details must not be exposed to visitors.
      return jsonResponse({ error: "service_unavailable" }, 503, origin);
    }
  },
};
