import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import worker from "./worker.js";
import { SQLiteD1 } from "./tests/sqlite-d1.mjs";

const schema = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
const ORIGIN = "https://ctiwsm.github.io";
const ENDPOINT = "https://chentao-homepage-api.c708978499.workers.dev/api/likes";

function databaseFor(t) {
  const database = new SQLiteD1();
  t.after(() => database.close());
  return database;
}

function request(method = "GET", options = {}) {
  const headers = new Headers(options.headers);
  if (options.origin !== null) headers.set("Origin", options.origin ?? ORIGIN);
  return new Request(options.url ?? ENDPOINT, {
    method,
    headers,
    ...(options.body === undefined ? {} : { body: options.body }),
    ...(options.body instanceof ReadableStream ? { duplex: "half" } : {}),
  });
}

async function call(database, method = "GET", options = {}) {
  const response = await worker.fetch(request(method, options), { DB: database });
  return { response, body: response.status === 204 ? null : await response.json() };
}

function like(database, visitorId, extra = {}) {
  return call(database, "POST", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ visitorId }),
    ...extra,
  });
}

test("fresh database has zero likes; a no-Origin GET is public and uncached", async (t) => {
  const database = databaseFor(t);
  const { response, body } = await call(database, "GET", { origin: null });
  assert.equal(response.status, 200);
  assert.deepEqual(body, { site: "chentao-homepage", count: 0, liked: false });
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS n FROM likes").get().n, 0);
});

test("a like is persisted as a SHA-256 digest; retries and UUID case do not duplicate it", async (t) => {
  const database = databaseFor(t);
  const id = randomUUID();
  const first = await like(database, id);
  assert.equal(first.response.status, 201);
  assert.deepEqual(first.body, { site: "chentao-homepage", count: 1, liked: true, added: true });
  const repeated = await like(database, id.toUpperCase());
  assert.equal(repeated.response.status, 200);
  assert.deepEqual(repeated.body, { site: "chentao-homepage", count: 1, liked: true, added: false });
  const stored = database.sqlite.prepare("SELECT visitor_hash FROM likes").get().visitor_hash;
  assert.equal(stored, createHash("sha256").update(id).digest("hex"));
  assert.notEqual(stored, id);
  assert.equal((await call(database, "GET", { headers: { "X-Visitor-Id": id.toUpperCase() } })).body.liked, true);
  assert.equal((await call(database, "GET", { headers: { "X-Visitor-Id": randomUUID() } })).body.liked, false);
  assert.equal((await call(database)).body.liked, false);
});

test("40 concurrent requests for one visitor add exactly one like", async (t) => {
  const database = databaseFor(t);
  const id = randomUUID();
  const responses = await Promise.all(Array.from({ length: 40 }, () => like(database, id)));
  assert.equal(responses.filter(({ body }) => body.added === true).length, 1);
  assert.equal(responses.filter(({ response }) => response.status === 201).length, 1);
  assert.ok(responses.every(({ body }) => body.count === 1 && body.liked === true));
  assert.equal((await call(database)).body.count, 1);
});

test("different concurrent visitors accumulate correctly while repeated requests stay idempotent", async (t) => {
  const database = databaseFor(t);
  const ids = Array.from({ length: 30 }, () => randomUUID());
  const responses = await Promise.all(ids.flatMap((id) => [like(database, id), like(database, id)]));
  assert.equal(responses.filter(({ body }) => body.added).length, ids.length);
  assert.equal((await call(database)).body.count, ids.length);
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS n FROM likes").get().n, ids.length);
});

test("re-running schema preserves likes and does not duplicate trigger effects", async (t) => {
  const database = databaseFor(t);
  await like(database, randomUUID());
  await like(database, randomUUID());
  database.sqlite.exec(schema);
  database.sqlite.exec(schema);
  assert.equal((await call(database)).body.count, 2);
  assert.equal((await like(database, randomUUID())).body.count, 3);
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_schema WHERE type = 'trigger'").get().n, 2);
  database.sqlite.exec("DELETE FROM likes WHERE rowid = (SELECT MIN(rowid) FROM likes)");
  assert.equal((await call(database)).body.count, 2);
});

test("failed counter update rolls back the like and returns a non-disclosing 503", async (t) => {
  const database = databaseFor(t);
  database.sqlite.exec("CREATE TRIGGER simulate_failure BEFORE UPDATE ON like_totals BEGIN SELECT RAISE(ABORT, 'private database information'); END");
  const { response, body } = await like(database, randomUUID());
  assert.equal(response.status, 503);
  assert.deepEqual(body, { error: "service_unavailable" });
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS n FROM likes").get().n, 0);
  assert.equal((await call(database)).body.count, 0);
});

test("missing binding or schema returns 503 rather than a fabricated zero", async (t) => {
  const database = databaseFor(t);
  const missing = await worker.fetch(request(), {});
  assert.equal(missing.status, 503);
  assert.deepEqual(await missing.json(), { error: "service_unavailable" });
  database.sqlite.exec("DELETE FROM like_totals");
  const uninitialized = await call(database);
  assert.equal(uninitialized.response.status, 503);
  assert.deepEqual(uninitialized.body, { error: "service_unavailable" });
});

test("only the declared origins are allowed, with valid CORS preflight for GET and POST", async (t) => {
  const database = databaseFor(t);
  for (const origin of [ORIGIN, "http://127.0.0.1:8765", "http://localhost:8765"]) {
    for (const method of ["GET", "POST"]) {
      const { response } = await call(database, "OPTIONS", {
        origin,
        headers: { "Access-Control-Request-Method": method, "Access-Control-Request-Headers": "Content-Type, X-Visitor-Id" },
      });
      assert.equal(response.status, 204);
      assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
      assert.match(response.headers.get("Vary"), /Origin/);
      assert.equal(response.headers.get("Access-Control-Allow-Credentials"), null);
    }
    assert.equal((await call(database, "GET", { origin })).response.headers.get("Access-Control-Allow-Origin"), origin);
  }
  for (const origin of [null, "null", "https://example.com", "https://ctiwsm.github.io.evil.example", "https://ctiwsm.github.io/ChenTao.github.io/", "http://localhost:8766"]) {
    const { response } = await like(database, randomUUID(), { origin });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
  }
  assert.equal((await call(database, "GET", { origin: "https://example.com" })).response.status, 403);
  assert.equal((await call(database, "OPTIONS", { origin: null, headers: { "Access-Control-Request-Method": "POST" } })).response.status, 403);
  assert.equal((await call(database, "OPTIONS", { headers: { "Access-Control-Request-Method": "DELETE" } })).response.status, 403);
  assert.equal((await call(database, "OPTIONS", { headers: { "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "Authorization" } })).response.status, 403);
});

test("strict methods, path, query, UUID and JSON validation reject requests without writes", async (t) => {
  const database = databaseFor(t);
  for (const method of ["PUT", "PATCH", "DELETE"]) {
    const { response } = await call(database, method);
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("Allow"), "GET, POST, OPTIONS");
  }
  assert.equal((await call(database, "GET", { url: `${ENDPOINT}/` })).response.status, 404);
  assert.equal((await call(database, "GET", { url: `${ENDPOINT}?site=other` })).response.status, 400);
  for (const visitorId of ["", null, 7, "bad-id", randomUUID().replace(/-4/, "-1"), "00000000-0000-4000-7000-000000000000", `${randomUUID()} `]) {
    assert.equal((await like(database, visitorId)).response.status, 400);
  }
  assert.equal((await call(database, "GET", { headers: { "X-Visitor-Id": "' OR 1=1 --" } })).response.status, 400);
  for (const body of ["", "{", "null", "[]", "{}", JSON.stringify({ visitorId: randomUUID(), site: "other" })]) {
    assert.equal((await call(database, "POST", { body, headers: { "Content-Type": "application/json" } })).response.status, 400);
  }
  assert.equal((await like(database, randomUUID(), { headers: { "Content-Type": "text/plain" } })).response.status, 415);
  assert.equal((await like(database, randomUUID(), { headers: { "Content-Type": "application/json; charset=utf-8" } })).response.status, 201);
  assert.equal((await call(database)).body.count, 1);
});

test("body limit applies to streamed bytes and declared size; invalid UTF-8 is rejected", async (t) => {
  const database = databaseFor(t);
  const oversized = JSON.stringify({ visitorId: randomUUID() }) + " ".repeat(260);
  assert.equal((await call(database, "POST", { body: oversized, headers: { "Content-Type": "application/json" } })).response.status, 413);
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(" ".repeat(150)));
      controller.enqueue(new TextEncoder().encode(" ".repeat(150)));
      controller.close();
    },
  });
  assert.equal((await call(database, "POST", { body: stream, headers: { "Content-Type": "application/json" } })).response.status, 413);
  assert.equal((await like(database, randomUUID(), { headers: { "Content-Type": "application/json", "Content-Length": "257" } })).response.status, 413);
  assert.equal((await like(database, randomUUID(), { headers: { "Content-Type": "application/json", "Content-Length": "bad" } })).response.status, 400);
  assert.equal((await call(database, "POST", { body: new Uint8Array([0xff]), headers: { "Content-Type": "application/json" } })).response.status, 400);
  assert.equal((await call(database)).body.count, 0);
});
