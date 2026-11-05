// @ts-nocheck -- Node's test modules are not included in the application tsconfig.
// Mocked: the Twitch token endpoint and IGDB are in-memory fakes; no network.
import assert from "node:assert/strict";
import test from "node:test";
import { createIgdbClient, IgdbError } from "../src/lib/providers/igdb/client.ts";
import { createFetchTransport } from "../src/lib/providers/igdb/server/fetch-transport.ts";
import {
  createTwitchTokenSource,
  TwitchAuthError,
} from "../src/lib/providers/igdb/server/twitch-auth.ts";

const CLIENT_ID = "client_id_test";
const SECRET = "SECRET_client_secret_xyz";
const TOKEN_1 = "TOKEN_first_abc";
const TOKEN_2 = "TOKEN_second_def";
const DAY = 86_400_000;

function json(status, body) {
  return { status, headers: { get: () => null }, json: async () => body };
}

function twitchFake(responses) {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      const next = responses[Math.min(calls.length - 1, responses.length - 1)];
      if (next instanceof Error) throw next;
      return typeof next === "function" ? next() : next;
    },
  };
}

function assertNoSecrets(value) {
  for (const text of [value?.message, String(value), JSON.stringify(value), String(value?.stack)]) {
    for (const secret of [SECRET, TOKEN_1, TOKEN_2]) {
      assert.ok(!String(text).includes(secret), `secret leaked into: ${text}`);
    }
  }
}

test("mints a token with the secret in the POST body, never the URL", async () => {
  const fake = twitchFake([
    json(200, { access_token: TOKEN_1, expires_in: 5_000_000, token_type: "bearer" }),
  ]);
  const tokens = createTwitchTokenSource({
    clientId: CLIENT_ID,
    clientSecret: SECRET,
    fetchImpl: fake.fetchImpl,
  });
  assert.equal(await tokens.getToken(), TOKEN_1);
  const [call] = fake.calls;
  assert.equal(call.url, "https://id.twitch.tv/oauth2/token");
  assert.ok(!call.url.includes(SECRET));
  assert.equal(call.init.method, "POST");
  const body = new URLSearchParams(call.init.body);
  assert.equal(body.get("client_id"), CLIENT_ID);
  assert.equal(body.get("client_secret"), SECRET);
  assert.equal(body.get("grant_type"), "client_credentials");
  assertNoSecrets(tokens.state());
  assert.ok(!("token" in tokens.state()));
});

test("reuses the token until 24 h before expiry, then renews", async () => {
  let clock = 0;
  const fake = twitchFake([
    json(200, { access_token: TOKEN_1, expires_in: 5_000_000 }),
    json(200, { access_token: TOKEN_2, expires_in: 5_000_000 }),
  ]);
  const tokens = createTwitchTokenSource({
    clientId: CLIENT_ID,
    clientSecret: SECRET,
    fetchImpl: fake.fetchImpl,
    now: () => clock,
  });
  assert.equal(await tokens.getToken(), TOKEN_1);
  clock = 5_000_000_000 - DAY - 1;
  assert.equal(await tokens.getToken(), TOKEN_1);
  clock = 5_000_000_000 - DAY;
  assert.equal(await tokens.getToken(), TOKEN_2);
  assert.equal(fake.calls.length, 2);
});

test("short-lived tokens renew at half-life", async () => {
  let clock = 0;
  const fake = twitchFake([
    json(200, { access_token: TOKEN_1, expires_in: 3600 }),
    json(200, { access_token: TOKEN_2, expires_in: 3600 }),
  ]);
  const tokens = createTwitchTokenSource({
    clientId: CLIENT_ID,
    clientSecret: SECRET,
    fetchImpl: fake.fetchImpl,
    now: () => clock,
  });
  await tokens.getToken();
  clock = 1_799_999;
  assert.equal(await tokens.getToken(), TOKEN_1);
  clock = 1_800_000;
  assert.equal(await tokens.getToken(), TOKEN_2);
});

test("concurrent callers share one token request", async () => {
  const fake = twitchFake([json(200, { access_token: TOKEN_1, expires_in: 5_000_000 })]);
  const tokens = createTwitchTokenSource({
    clientId: CLIENT_ID,
    clientSecret: SECRET,
    fetchImpl: fake.fetchImpl,
  });
  const all = await Promise.all([tokens.getToken(), tokens.getToken(), tokens.getToken()]);
  assert.deepEqual(all, [TOKEN_1, TOKEN_1, TOKEN_1]);
  assert.equal(fake.calls.length, 1);
});

test("missing, rejected and failing credentials give fixed, secret-free errors", async () => {
  const missing = createTwitchTokenSource({
    clientId: CLIENT_ID,
    clientSecret: " ",
    fetchImpl: async () => assert.fail("no request"),
  });
  assert.equal(missing.configured(), false);
  await assert.rejects(missing.getToken(), { kind: "missing_credentials" });

  const cases = [
    [json(400, { message: `invalid client secret ${SECRET}` }), "invalid_credentials"],
    [json(403, {}), "invalid_credentials"],
    [json(500, {}), "unavailable"],
    [json(200, { access_token: "", expires_in: 10 }), "unavailable"],
    [json(200, { access_token: TOKEN_1 }), "unavailable"],
    [new Error(`connect ECONNREFUSED client_secret=${SECRET}`), "network"],
  ];
  for (const [response, kind] of cases) {
    const fake = twitchFake([response]);
    const tokens = createTwitchTokenSource({
      clientId: CLIENT_ID,
      clientSecret: SECRET,
      fetchImpl: fake.fetchImpl,
    });
    const error = await tokens.getToken().catch((e) => e);
    assert.ok(error instanceof TwitchAuthError, kind);
    assert.equal(error.kind, kind);
    assert.equal(error.cause, undefined);
    assertNoSecrets(error);
  }
});

test("renew() forces a new token and reports failure as false", async () => {
  const fake = twitchFake([
    json(200, { access_token: TOKEN_1, expires_in: 5_000_000 }),
    json(200, { access_token: TOKEN_2, expires_in: 5_000_000 }),
    json(401, {}),
  ]);
  const tokens = createTwitchTokenSource({
    clientId: CLIENT_ID,
    clientSecret: SECRET,
    fetchImpl: fake.fetchImpl,
  });
  await tokens.getToken();
  assert.equal(await tokens.renew(), true);
  assert.equal(await tokens.getToken(), TOKEN_2);
  assert.equal(await tokens.renew(), false);
});

test("fetch transport sends IGDB headers and the body, and nothing else", async () => {
  const twitch = twitchFake([json(200, { access_token: TOKEN_1, expires_in: 5_000_000 })]);
  const tokens = createTwitchTokenSource({
    clientId: CLIENT_ID,
    clientSecret: SECRET,
    fetchImpl: twitch.fetchImpl,
  });
  const igdbCalls = [];
  const transport = createFetchTransport({
    tokens,
    base: "https://igdb.test/v4",
    fetchImpl: async (url, init) => {
      igdbCalls.push({ url, init });
      return json(200, [{ id: 1, name: "A", slug: "a" }]);
    },
  });
  const client = createIgdbClient({ transport, isOffline: () => false, sleep: async () => {} });
  const games = await client.games({ fields: ["name", "slug"], limit: 1 });
  assert.deepEqual(
    games.map((g) => g.id),
    ["igdb:1"],
  );
  const [call] = igdbCalls;
  assert.equal(call.url, "https://igdb.test/v4/games");
  assert.equal(call.init.method, "POST");
  assert.equal(call.init.body, "fields name,slug; limit 1;");
  assert.equal(call.init.headers["Client-ID"], CLIENT_ID);
  assert.equal(call.init.headers.Authorization, `Bearer ${TOKEN_1}`);
  assert.ok(!JSON.stringify(call).includes(SECRET), "the secret never goes to IGDB");
});

test("end to end: an expired token is renewed after a 401", async () => {
  const twitch = twitchFake([
    json(200, { access_token: TOKEN_1, expires_in: 5_000_000 }),
    json(200, { access_token: TOKEN_2, expires_in: 5_000_000 }),
  ]);
  const tokens = createTwitchTokenSource({
    clientId: CLIENT_ID,
    clientSecret: SECRET,
    fetchImpl: twitch.fetchImpl,
  });
  const seen = [];
  const transport = createFetchTransport({
    tokens,
    base: "https://igdb.test/v4",
    fetchImpl: async (_url, init) => {
      seen.push(init.headers.Authorization);
      return init.headers.Authorization === `Bearer ${TOKEN_1}` ? json(401, {}) : json(200, []);
    },
  });
  const client = createIgdbClient({ transport, isOffline: () => false, sleep: async () => {} });
  assert.deepEqual(await client.query("games", { fields: ["name"] }), []);
  assert.deepEqual(seen, [`Bearer ${TOKEN_1}`, `Bearer ${TOKEN_2}`]);
});

test("end to end: rejected credentials surface as invalid_credentials without secrets", async () => {
  const twitch = twitchFake([json(400, { message: SECRET })]);
  const tokens = createTwitchTokenSource({
    clientId: CLIENT_ID,
    clientSecret: SECRET,
    fetchImpl: twitch.fetchImpl,
  });
  const transport = createFetchTransport({
    tokens,
    base: "https://igdb.test/v4",
    fetchImpl: async () => assert.fail("IGDB must not be called without a token"),
  });
  const client = createIgdbClient({ transport, isOffline: () => false, sleep: async () => {} });
  const error = await client.query("games", { fields: ["name"] }).catch((e) => e);
  assert.ok(error instanceof IgdbError);
  assert.equal(error.kind, "invalid_credentials");
  assertNoSecrets(error);
});

test("end to end: Twitch unreachable is a network error", async () => {
  const twitch = twitchFake([new Error(`getaddrinfo ENOTFOUND ${SECRET}`)]);
  const tokens = createTwitchTokenSource({
    clientId: CLIENT_ID,
    clientSecret: SECRET,
    fetchImpl: twitch.fetchImpl,
  });
  const transport = createFetchTransport({
    tokens,
    fetchImpl: async () => assert.fail("no IGDB call"),
  });
  const client = createIgdbClient({ transport, isOffline: () => false, sleep: async () => {} });
  const error = await client.query("games", { fields: ["name"] }).catch((e) => e);
  assert.equal(error.kind, "network");
  assertNoSecrets(error);
});
