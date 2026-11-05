// @ts-nocheck -- Node's test modules are not included in the application tsconfig.
// Mocked: every response comes from an in-memory transport; no network.
import assert from "node:assert/strict";
import test from "node:test";
import {
  RATE_LIMIT_BACKOFF_MS,
  createIgdbClient,
  createRateGate,
  IgdbError,
} from "../src/lib/providers/igdb/client.ts";

const SECRET_TOKEN = "TOKEN_abc123_SHOULD_NEVER_LEAK";
const Q = { fields: ["name"], limit: 1 };

function res(status, body = [], retryAfter = null) {
  return {
    status,
    retryAfter,
    json: async () => {
      if (body instanceof Error) throw body;
      return body;
    },
  };
}

function setup(handler, extra = {}) {
  const sent = [];
  const sleeps = [];
  const requests = [];
  let renewCalls = 0;
  const transport = {
    ready: extra.ready ?? (() => true),
    renew:
      extra.renew ??
      (async () => {
        renewCalls += 1;
        return true;
      }),
    send: async (req) => {
      sent.push(req);
      return handler(req, sent.length);
    },
  };
  if (extra.noRenew) delete transport.renew;
  const client = createIgdbClient({
    transport,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    isOffline: extra.isOffline ?? (() => false),
    onRequest: (info) => requests.push(info),
    ratePerSecond: 1000,
  });
  return { client, sent, sleeps, requests, renews: () => renewCalls };
}

function assertSafe(error) {
  assert.ok(error instanceof IgdbError, "expected an IgdbError");
  for (const text of [error.message, String(error), JSON.stringify(error), String(error.stack)]) {
    assert.ok(!text.includes(SECRET_TOKEN), `token leaked into: ${text}`);
    assert.ok(!text.includes("fields name"), `query body leaked into: ${text}`);
    assert.ok(!text.includes("api.igdb.com"), `URL leaked into: ${text}`);
  }
  assert.equal(error.cause, undefined);
}

test("sends a built body to the endpoint and parses JSON", async () => {
  const { client, sent, requests } = setup(() => res(200, [{ id: 1, name: "A", slug: "a" }]));
  const data = await client.query("games", Q);
  assert.deepEqual(data, [{ id: 1, name: "A", slug: "a" }]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].endpoint, "games");
  assert.equal(sent[0].body, "fields name; limit 1;");
  assert.ok(sent[0].signal instanceof AbortSignal);
  assert.deepEqual(Object.keys(requests[0]).sort(), ["endpoint", "ms", "status"]);
  assert.ok(!JSON.stringify(requests).includes("fields"), "diagnostics never include the body");
});

test("no request without credentials, for unknown endpoints, or for invalid queries", async () => {
  const none = setup(() => res(200), { ready: () => false });
  await assert.rejects(none.client.query("games", Q), { kind: "missing_credentials" });
  assert.equal(none.sent.length, 0);

  const { client, sent } = setup(() => res(200));
  await assert.rejects(client.query("users", Q), { kind: "bad_request" });
  await assert.rejects(client.query("games", { fields: ["bad;field"] }), { kind: "bad_request" });
  await assert.rejects(client.query("games", { fields: ["name"], limit: 9999 }), {
    kind: "bad_request",
  });
  assert.equal(sent.length, 0);
});

test("401 renews the token once and retries", async () => {
  const { client, sent, renews } = setup((_, n) => (n === 1 ? res(401) : res(200, [])));
  assert.deepEqual(await client.query("games", Q), []);
  assert.equal(renews(), 1);
  assert.equal(sent.length, 2);
});

test("a second 401 after renewing is invalid_credentials", async () => {
  const { client, sent, renews } = setup(() => res(401, { message: SECRET_TOKEN }));
  const error = await client.query("games", Q).catch((e) => e);
  assert.equal(error.kind, "invalid_credentials");
  assertSafe(error);
  assert.equal(renews(), 1);
  assert.equal(sent.length, 2);
});

test("401 with failed or missing renewal stops immediately", async () => {
  const failing = setup(() => res(401), { renew: async () => false });
  await assert.rejects(failing.client.query("games", Q), { kind: "invalid_credentials" });
  assert.equal(failing.sent.length, 1);

  const throwing = setup(() => res(401), {
    renew: async () => {
      throw new Error(SECRET_TOKEN);
    },
  });
  const error = await throwing.client.query("games", Q).catch((e) => e);
  assertSafe(error);
  assert.equal(error.kind, "invalid_credentials");

  const none = setup(() => res(401), { noRenew: true });
  await assert.rejects(none.client.query("games", Q), { kind: "invalid_credentials" });
  assert.equal(none.sent.length, 1);
});

test("403 is invalid_credentials without retry", async () => {
  const { client, sent } = setup(() => res(403));
  await assert.rejects(client.query("games", Q), { kind: "invalid_credentials", status: 403 });
  assert.equal(sent.length, 1);
});

test("429 backs off 250/500/1000 ms, then reports rate_limited", async () => {
  const { client, sent, sleeps } = setup(() => res(429));
  const error = await client.query("games", Q).catch((e) => e);
  assert.equal(error.kind, "rate_limited");
  assertSafe(error);
  assert.equal(sent.length, 1 + RATE_LIMIT_BACKOFF_MS.length);
  assert.deepEqual(sleeps, [250, 500, 1000]);
});

test("429 honours a short Retry-After and recovers", async () => {
  const { client, sleeps } = setup((_, n) => (n === 1 ? res(429, [], "2") : res(200, [])));
  assert.deepEqual(await client.query("games", Q), []);
  assert.deepEqual(sleeps, [2000]);
});

test("429 ignores an excessive Retry-After", async () => {
  const { client, sleeps } = setup((_, n) => (n === 1 ? res(429, [], "3600") : res(200, [])));
  await client.query("games", Q);
  assert.deepEqual(sleeps, [250]);
});

test("5xx retries twice, then unavailable", async () => {
  const { client, sent, sleeps } = setup(() => res(503));
  await assert.rejects(client.query("games", Q), { kind: "unavailable", status: 503 });
  assert.equal(sent.length, 3);
  assert.deepEqual(sleeps, [500, 1500]);
});

test("400 and 404 are bad_request and never retried", async () => {
  for (const status of [400, 404]) {
    const { client, sent } = setup(() => res(status, [{ title: "Syntax Error" }]));
    await assert.rejects(client.query("games", Q), { kind: "bad_request", status });
    assert.equal(sent.length, 1);
  }
});

test("transport failures retry once and never leak the thrown error", async () => {
  const { client, sent, requests } = setup(() => {
    throw new Error(
      `fetch failed: Authorization: Bearer ${SECRET_TOKEN} https://api.igdb.com/v4/games`,
    );
  });
  const error = await client.query("games", Q).catch((e) => e);
  assert.equal(error.kind, "network");
  assertSafe(error);
  assert.equal(sent.length, 2);
  assert.deepEqual(
    requests.map((r) => r.status),
    [null, null],
  );
});

test("offline fails fast without sending", async () => {
  const { client, sent } = setup(() => res(200), { isOffline: () => true });
  await assert.rejects(client.query("games", Q), { kind: "network" });
  assert.equal(sent.length, 0);
});

test("unparseable JSON is bad_response", async () => {
  const { client } = setup(() => res(200, new SyntaxError(SECRET_TOKEN)));
  const error = await client.query("games", Q).catch((e) => e);
  assert.equal(error.kind, "bad_response");
  assertSafe(error);
});

test("identical in-flight queries share one request", async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const { client, sent } = setup(async () => {
    await gate;
    return res(200, [{ id: 1 }]);
  });
  const a = client.query("games", Q);
  const b = client.query("games", Q);
  const c = client.query("games", { ...Q, limit: 2 });
  release();
  const [ra, rb] = await Promise.all([a, b, c]);
  assert.equal(ra, rb);
  assert.equal(sent.length, 2, "different bodies are different requests");
});

test("an aborted caller does not cancel the shared request for others", async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const { client, sent } = setup(async () => {
    await gate;
    return res(200, ["ok"]);
  });
  const controller = new AbortController();
  const aborted = client.query("games", Q, controller.signal);
  const other = client.query("games", Q);
  controller.abort();
  await assert.rejects(aborted, { name: "AbortError" });
  release();
  assert.deepEqual(await other, ["ok"]);
  assert.equal(sent.length, 1);
});

test("never more than `concurrency` requests open at once", async () => {
  let open = 0;
  let peak = 0;
  const client = createIgdbClient({
    transport: {
      send: async () => {
        open += 1;
        peak = Math.max(peak, open);
        await new Promise((r) => setTimeout(r, 5));
        open -= 1;
        return res(200, []);
      },
    },
    concurrency: 4,
    ratePerSecond: 1000,
    isOffline: () => false,
  });
  await Promise.all(
    Array.from({ length: 12 }, (_, i) => client.query("games", { fields: ["name"], limit: i + 1 })),
  );
  assert.equal(peak, 4);
});

test("rate gate: at most N starts in any 1000 ms window", async () => {
  let clock = 0;
  const starts = [];
  const gate = createRateGate({
    perSecond: 4,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
  });
  for (let i = 0; i < 10; i++) {
    await gate.take();
    starts.push(clock);
  }
  for (let i = 4; i < starts.length; i++) {
    assert.ok(starts[i] - starts[i - 4] >= 1000, `window violated at ${i}: ${starts}`);
  }
  assert.deepEqual(starts.slice(0, 5), [0, 0, 0, 0, 1000]);
});

test("the client applies the rate gate to every attempt, including retries", async () => {
  let clock = 0;
  const starts = [];
  const client = createIgdbClient({
    transport: {
      send: async () => {
        starts.push(clock);
        return res(503);
      },
    },
    ratePerSecond: 2,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    isOffline: () => false,
  });
  await assert.rejects(client.query("games", Q), { kind: "unavailable" });
  for (let i = 2; i < starts.length; i++) assert.ok(starts[i] - starts[i - 2] >= 1000);
});

test("multiquery maps results by name and validates input", async () => {
  const { client, sent } = setup(() =>
    res(200, [{ name: "top", result: [{ id: 1 }] }, { name: "total", count: 42 }, { bogus: true }]),
  );
  const out = await client.multiquery([
    { name: "top", endpoint: "games", query: Q },
    { name: "total", endpoint: "games/count", query: { fields: [], where: [], limit: 1 } },
  ]);
  assert.deepEqual(out, { top: [{ id: 1 }], total: 42 });
  assert.equal(sent[0].endpoint, "multiquery");
  await assert.rejects(client.multiquery([]), { kind: "bad_request" });
});

test("games() returns normalized public games and rejects non-arrays", async () => {
  const { client } = setup(() =>
    res(200, [
      { id: 5, name: "Five", slug: "five" },
      { id: 6, name: "Six", slug: "six", themes: [{ id: 42, name: "Erotic", slug: "erotic" }] },
    ]),
  );
  const games = await client.games(Q);
  assert.deepEqual(
    games.map((g) => g.id),
    ["igdb:5"],
  );
  const bad = setup(() => res(200, { not: "a list" }));
  await assert.rejects(bad.client.games(Q), { kind: "bad_response" });
});
