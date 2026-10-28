// @ts-nocheck -- Node's test modules are not included in the application tsconfig.
import assert from "node:assert/strict";
import test from "node:test";
import { capabilityOf, createRawgClient, RawgError } from "../src/lib/providers/rawg/client.ts";
import { keyFingerprint } from "../src/lib/game-discovery/gates.ts";
import { createRawgSessionStatus } from "../src/lib/game-discovery/status.ts";

const KEY = "SECRET_RAWG_KEY_123";
const AUTH = { key: KEY, verifiedFor: keyFingerprint(KEY) };

function response(status: number, body: unknown = { results: [] }, headers = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => {
      if (body instanceof Error) throw body;
      return body;
    },
  } as Response;
}

function setup(handler: (url: string, call: number) => Response | Promise<Response>) {
  const calls: string[] = [];
  const status = createRawgSessionStatus();
  const requests: { path: string; status: number | null }[] = [];
  const client = createRawgClient({
    fetchImpl: async (url) => {
      calls.push(url);
      return handler(url, calls.length);
    },
    status,
    base: "https://rawg.test/api",
    sleep: async () => {},
    isOffline: () => false,
    onRequest: (info) => requests.push(info),
  });
  return { client, calls, status, requests };
}

function assertNoKey(error: unknown) {
  assert.ok(error instanceof RawgError, "expected a RawgError");
  for (const text of [error.message, String(error), JSON.stringify(error), String(error.stack)]) {
    assert.ok(!text.includes(KEY), `key leaked into: ${text}`);
    assert.ok(!text.includes("rawg.test"), `URL leaked into: ${text}`);
  }
  assert.equal(error.cause, undefined);
}

test("puts the key only in the request URL and parses the body", async () => {
  const { client, calls, requests } = setup(() => response(200, { results: [{ id: 1 }] }));
  const data = await client.get("/games", { page_size: 20, search: "witcher" }, AUTH);
  assert.deepEqual(data, { results: [{ id: 1 }] });
  assert.equal(calls.length, 1);
  const url = new URL(calls[0]);
  assert.equal(url.pathname, "/api/games");
  assert.equal(url.searchParams.get("key"), KEY);
  assert.equal(url.searchParams.get("search"), "witcher");
  assert.deepEqual(requests, [{ path: "/games", status: 200, ms: requests[0].ms }]);
  assert.ok(!JSON.stringify(requests).includes(KEY));
});

test("never sends a request without a ready key", async () => {
  const { client, calls, status } = setup(() => response(200));
  await assert.rejects(client.get("/games", {}, { key: "", verifiedFor: "" }), {
    kind: "missing_key",
  });
  await assert.rejects(client.get("/games", {}, { key: KEY, verifiedFor: "" }), {
    kind: "unverified",
  });
  await assert.rejects(client.get("/games", {}, { key: "other", verifiedFor: AUTH.verifiedFor }), {
    kind: "unverified",
  });
  status.markRejected(AUTH.verifiedFor);
  await assert.rejects(client.get("/games", {}, AUTH), { kind: "invalid_key" });
  assert.equal(calls.length, 0);
});

test("core 401/403 rejects the key for the session without retrying", async () => {
  for (const code of [401, 403]) {
    const { client, calls, status } = setup(() => response(code));
    await assert.rejects(client.get("/games/3328", {}, AUTH), {
      kind: "invalid_key",
      status: code,
    });
    assert.equal(calls.length, 1);
    assert.equal(status.isRejected(AUTH.verifiedFor), true);
    await assert.rejects(client.get("/games", {}, AUTH), { kind: "invalid_key" });
    assert.equal(calls.length, 1, "rejected key must short-circuit");
  }
});

test("sub-endpoint 401/403 marks only that capability unavailable", async () => {
  const { client, calls, status } = setup(() => response(403));
  await assert.rejects(client.get("/games/3328/screenshots", {}, AUTH), {
    kind: "capability_unavailable",
  });
  assert.equal(status.isRejected(AUTH.verifiedFor), false);
  assert.equal(status.isCapabilityUnavailable("screenshots"), true);
  await assert.rejects(client.get("/games/3328/screenshots", {}, AUTH), {
    kind: "capability_unavailable",
  });
  assert.equal(calls.length, 1, "known-unavailable capability must not be requested again");
});

test("429 retries once only for a short Retry-After, otherwise surfaces", async () => {
  const short = setup((_, n) =>
    n === 1 ? response(429, {}, { "retry-after": "2" }) : response(200),
  );
  await short.client.get("/games", {}, AUTH);
  assert.equal(short.calls.length, 2);

  const long = setup(() => response(429, {}, { "retry-after": "60" }));
  await assert.rejects(long.client.get("/games", {}, AUTH), { kind: "rate_limited" });
  assert.equal(long.calls.length, 1);

  const none = setup(() => response(429));
  await assert.rejects(none.client.get("/games", {}, AUTH), { kind: "rate_limited" });
  assert.equal(none.calls.length, 1);

  const repeated = setup(() => response(429, {}, { "retry-after": "1" }));
  await assert.rejects(repeated.client.get("/games", {}, AUTH), { kind: "rate_limited" });
  assert.equal(repeated.calls.length, 2, "never loops on 429");
});

test("5xx retries twice then reports unavailable", async () => {
  const { client, calls } = setup(() => response(503));
  await assert.rejects(client.get("/games", {}, AUTH), { kind: "unavailable", status: 503 });
  assert.equal(calls.length, 3);
});

test("transport failures retry once and never leak the URL or key", async () => {
  const { client, calls } = setup((url) => {
    throw new Error(`send: error sending request for url (${url})`);
  });
  const error = await client.get("/games", { search: "x" }, AUTH).catch((e) => e);
  assert.equal(error.kind, "network");
  assert.equal(calls.length, 2);
  assertNoKey(error);
});

test("404 and malformed JSON map to their own kinds without leaking", async () => {
  const notFound = setup(() => response(404));
  const nf = await notFound.client.get("/games/nope", {}, AUTH).catch((e) => e);
  assert.equal(nf.kind, "not_found");
  assertNoKey(nf);

  const malformed = setup(() => response(200, new SyntaxError(`bad json at ${KEY}`)));
  const bad = await malformed.client.get("/games", {}, AUTH).catch((e) => e);
  assert.equal(bad.kind, "bad_response");
  assertNoKey(bad);
});

test("offline short-circuits without fetching", async () => {
  const calls: string[] = [];
  const client = createRawgClient({
    fetchImpl: async (url) => {
      calls.push(url);
      return response(200);
    },
    status: createRawgSessionStatus(),
    isOffline: () => true,
    sleep: async () => {},
  });
  await assert.rejects(client.get("/games", {}, AUTH), { kind: "network" });
  assert.equal(calls.length, 0);
});

test("identical in-flight requests are deduplicated", async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const { client, calls } = setup(async () => {
    await gate;
    return response(200, { results: [] });
  });
  const a = client.get("/games", { page: 1 }, AUTH);
  const b = client.get("/games", { page: 1 }, AUTH);
  release();
  await Promise.all([a, b]);
  assert.equal(calls.length, 1);
});

test("validateKey distinguishes valid, invalid, offline, unavailable and rate-limited", async () => {
  const cases: [Parameters<typeof setup>[0], string][] = [
    [() => response(200, { results: [] }), "valid"],
    [() => response(401), "invalid"],
    [() => response(403), "invalid"],
    [() => response(429), "rate_limited"],
    [() => response(502), "unavailable"],
    [() => response(200, { detail: "nope" }), "unavailable"],
    [
      () => {
        throw new Error(`connect failed ${KEY}`);
      },
      "offline",
    ],
  ];
  for (const [handler, expected] of cases) {
    const { client, calls } = setup(handler);
    assert.equal(await client.validateKey(` ${KEY} `), expected);
    assert.equal(calls.length, 1, "validation is a single request");
    assert.equal(new URL(calls[0]).pathname, "/api/genres");
  }
});

test("a successful validation clears a session rejection for that key", async () => {
  const { client, status } = setup(() => response(200, { results: [] }));
  status.markRejected(AUTH.verifiedFor);
  assert.equal(await client.validateKey(KEY), "valid");
  assert.equal(status.isRejected(AUTH.verifiedFor), false);
});

test("capabilityOf classifies sub-endpoints and core endpoints", () => {
  assert.equal(capabilityOf("/games"), null);
  assert.equal(capabilityOf("/games/3328"), null);
  assert.equal(capabilityOf("/games/the-witcher-3"), null);
  assert.equal(capabilityOf("/genres"), null);
  assert.equal(capabilityOf("/games/3328/screenshots"), "screenshots");
  assert.equal(capabilityOf("/games/3328/game-series"), "series");
  assert.equal(capabilityOf("/games/3328/additions"), "additions");
  assert.equal(capabilityOf("/games/3328/parent-games"), "parents");
});
