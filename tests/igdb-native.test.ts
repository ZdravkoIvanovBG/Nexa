// @ts-nocheck -- Node's test modules are not included in the application tsconfig.
// The bridge to the Rust IGDB module, with a mocked `invoke`. No Tauri, no
// network. Values are dummies, never real credentials.
import assert from "node:assert/strict";
import test from "node:test";
import { inspect } from "node:util";
import { IgdbError } from "../src/lib/providers/igdb/client.ts";
import {
  clientErrorKind,
  createIgdbNative,
  createNativeIgdbClient,
  createTauriTransport,
  IGDB_COMMANDS,
  IgdbNativeError,
  toNativeError,
  toNativeStatus,
} from "../src/lib/providers/igdb/native.ts";

const SECRET = "dummysecretSHOULDNEVERLEAK0000";
const CLIENT_ID = "dummyclientid00000000000000abcd";

const VERIFIED = { storage: "secure", state: "verified", verifying: false, clientIdHint: "abcd" };

function recorder(handler) {
  const calls = [];
  const invoke = async (command, args) => {
    calls.push({ command, args });
    return handler(command, args, calls.length);
  };
  return { invoke, calls };
}

function rejection(kind, extra = {}) {
  return { kind, status: null, retryAfterMs: null, message: "fixed", ...extra };
}

test("command names match the Rust commands", () => {
  assert.deepEqual(IGDB_COMMANDS, {
    status: "igdb_status",
    setCredentials: "igdb_set_credentials",
    verify: "igdb_verify_credentials",
    clear: "igdb_clear_credentials",
    query: "igdb_query",
  });
});

test("the secret goes to exactly one command and is not kept", async () => {
  const { invoke, calls } = recorder(() => VERIFIED);
  const native = createIgdbNative(invoke);
  const status = await native.setCredentials(`  ${CLIENT_ID} `, ` ${SECRET}\n`);
  assert.deepEqual(status, VERIFIED);
  assert.deepEqual(calls, [
    { command: "igdb_set_credentials", args: { clientId: CLIENT_ID, clientSecret: SECRET } },
  ]);
  await native.status();
  await native.verify();
  await native.clear();
  for (const call of calls.slice(1)) {
    assert.equal(call.args, undefined, `${call.command} takes no arguments`);
  }
  assert.ok(!inspect(native, { depth: 5, showHidden: true }).includes(SECRET));
});

test("empty input is refused before calling Rust", async () => {
  const { invoke, calls } = recorder(() => VERIFIED);
  const native = createIgdbNative(invoke);
  for (const [id, secret] of [
    ["", SECRET],
    [CLIENT_ID, ""],
    ["   ", "  "],
    [null, SECRET],
  ]) {
    await assert.rejects(native.setCredentials(id, secret), (e) => e.kind === "invalid_input");
  }
  assert.equal(calls.length, 0);
});

test("status payloads are validated field by field", () => {
  assert.deepEqual(toNativeStatus(VERIFIED), VERIFIED);
  assert.deepEqual(
    toNativeStatus({ ...VERIFIED, clientSecret: SECRET, accessToken: "tok", extra: 1 }),
    VERIFIED,
    "unknown fields are dropped",
  );
  assert.equal(toNativeStatus({ ...VERIFIED, clientIdHint: CLIENT_ID }).clientIdHint, null);
  assert.equal(toNativeStatus({ ...VERIFIED, clientIdHint: "<b>" }).clientIdHint, null);
  for (const bad of [
    null,
    "verified",
    42,
    {},
    { storage: "plaintext", state: "verified" },
    { storage: "secure", state: "hacked" },
  ]) {
    assert.deepEqual(toNativeStatus(bad), {
      storage: "unavailable",
      state: "unavailable",
      verifying: false,
      clientIdHint: null,
    });
  }
});

test("errors are rebuilt from known kinds only", () => {
  const error = toNativeError(rejection("invalid_credentials", { status: 403, detail: SECRET }));
  assert.equal(error.kind, "invalid_credentials");
  assert.equal(error.status, 403);
  for (const text of [error.message, String(error), JSON.stringify(error), inspect(error)]) {
    assert.ok(!text.includes(SECRET));
  }
  assert.equal(toNativeError("raw string with " + SECRET).kind, "unavailable");
  assert.ok(!toNativeError("raw string with " + SECRET).message.includes(SECRET));
  assert.equal(toNativeError(new Error(SECRET)).kind, "unavailable");
  assert.equal(toNativeError({ kind: "constructor" }).kind, "unavailable");
  assert.equal(toNativeError({ kind: "busy", status: 1e12 }).status, null);
  assert.equal(toNativeError({ kind: "rate_limited", retryAfterMs: 20000 }).retryAfterMs, 20000);
});

test("command rejections surface as IgdbNativeError", async () => {
  const native = createIgdbNative(async () => {
    throw rejection("storage_unavailable");
  });
  await assert.rejects(
    native.clear(),
    (e) => e instanceof IgdbNativeError && e.kind === "storage_unavailable",
  );
  await assert.rejects(native.verify(), (e) => e.kind === "storage_unavailable");
});

// ---------------------------------------------------------------------------
// Transport and client

test("the transport sends only the endpoint and the body", async () => {
  const { invoke, calls } = recorder(() => [{ id: 1942, name: "Game" }]);
  const transport = createTauriTransport(invoke);
  const res = await transport.send({
    endpoint: "games",
    body: "fields name; limit 1;",
    signal: new AbortController().signal,
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), [{ id: 1942, name: "Game" }]);
  assert.deepEqual(calls, [
    { command: "igdb_query", args: { endpoint: "games", body: "fields name; limit 1;" } },
  ]);
  assert.equal(transport.ready, undefined, "Rust decides readiness");
  assert.equal(transport.renew, undefined, "Rust renews tokens");
});

test("the transport refuses unknown endpoints without calling Rust", async () => {
  const { invoke, calls } = recorder(() => []);
  const transport = createTauriTransport(invoke);
  for (const endpoint of ["https://evil.example/", "../oauth2/token", "characters"]) {
    const res = await transport.send({
      endpoint,
      body: "fields *;",
      signal: new AbortController().signal,
    });
    assert.equal(res.errorKind, "bad_request");
  }
  assert.equal(calls.length, 0);
});

test("Rust failures are final: the client does not retry them", async () => {
  for (const [kind, expected] of [
    ["rate_limited", "rate_limited"],
    ["unavailable", "unavailable"],
    ["network", "network"],
    ["invalid_credentials", "invalid_credentials"],
    ["missing_credentials", "missing_credentials"],
    ["storage_unsupported", "missing_credentials"],
    ["storage_corrupted", "missing_credentials"],
    ["storage_unavailable", "unavailable"],
    ["bad_request", "bad_request"],
    ["forbidden", "bad_request"],
  ]) {
    const { invoke, calls } = recorder(() => {
      throw rejection(kind, { status: kind === "rate_limited" ? 429 : null, detail: SECRET });
    });
    const client = createNativeIgdbClient(invoke);
    await assert.rejects(
      client.query("games", { fields: ["name"], limit: 1 }),
      (e) => e instanceof IgdbError && e.kind === expected && !String(e.stack).includes(SECRET),
    );
    assert.equal(calls.length, 1, `${kind}: one call, no client-side retry`);
  }
});

test("native kinds map onto client kinds", () => {
  assert.equal(clientErrorKind("desktop_only"), "missing_credentials");
  assert.equal(clientErrorKind("busy"), "unavailable");
  assert.equal(clientErrorKind("invalid_input"), "bad_request");
  assert.equal(clientErrorKind("network"), "network");
});

test("the client returns normalized games through the Rust transport", async () => {
  const { invoke, calls } = recorder(() => [
    {
      id: 1942,
      name: "The Witcher 3",
      slug: "the-witcher-3",
      game_type: 0,
      cover: { image_id: "abc" },
    },
    {
      id: 9,
      name: "Hidden",
      slug: "hidden",
      game_type: 0,
      themes: [{ id: 42, slug: "erotic", name: "Erotic" }],
    },
  ]);
  const client = createNativeIgdbClient(invoke);
  const games = await client.games({ fields: ["name", "slug"], limit: 2 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args.body, "fields name,slug; limit 2;");
  assert.deepEqual(
    games.map((g) => g.id),
    ["igdb:1942"],
  );
});

test("an abort while waiting reports a network error, not a hang", async () => {
  let release;
  const invoke = () => new Promise((resolve) => (release = resolve));
  const transport = createTauriTransport(invoke);
  const controller = new AbortController();
  const pending = transport.send({
    endpoint: "games",
    body: "fields name;",
    signal: controller.signal,
  });
  controller.abort();
  const res = await pending;
  assert.equal(res.errorKind, "network");
  release([]);
});
