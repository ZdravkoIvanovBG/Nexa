// @ts-nocheck -- Node's test modules are not included in the application tsconfig.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { beforeEach, afterEach } from "node:test";
import { classifyCloudError, createGameQueue } from "../src/lib/game-library/cloud/queue.ts";

const OWNER = { userId: "user-a", profileId: "p1" };

const op = (key, value = 1, overrides = {}) => ({
  table: "game_queue",
  owner: OWNER,
  key,
  row: { entry_id: key, value },
  ...overrides,
});

function harness({ saved = null, userId = "user-a", refresh = true } = {}) {
  const h = {
    saved,
    sent: [],
    timers: [],
    refreshes: 0,
    drained: 0,
    respond: async () => null,
  };
  h.queue = createGameQueue({
    load: () => h.saved,
    save: (payload) => {
      h.saved = payload;
    },
    send: async (table, rows) => {
      h.sent.push({ table, rows });
      return h.respond(table, rows, h.sent.length);
    },
    userId: () => userId,
    refreshSession: async () => {
      h.refreshes++;
      return refresh;
    },
    setTimer: (run, ms) => {
      const timer = { run, ms };
      h.timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => {
      h.timers = h.timers.filter((t) => t !== timer);
    },
    onDrained: () => h.drained++,
  });
  return h;
}

// The queue reports problems on the console by design. Keep test output readable.
const { warn, error } = console;
beforeEach(() => {
  console.warn = () => {};
  console.error = () => {};
});
afterEach(() => {
  console.warn = warn;
  console.error = error;
});

test("rapid edits to one row collapse to the final value", async () => {
  const h = harness();
  h.queue.enqueue([op("a", 1)]);
  h.queue.enqueue([op("a", 2)]);
  h.queue.enqueue([op("a", 3)]);
  await h.queue.drain();
  assert.equal(h.sent.length, 1);
  assert.deepEqual(h.sent[0].rows, [{ entry_id: "a", value: 3 }]);
});

test("an enqueue schedules one debounced flush", () => {
  const h = harness();
  h.queue.enqueue([op("a")]);
  h.queue.enqueue([op("b")]);
  assert.equal(h.timers.length, 1);
  assert.equal(h.timers[0].ms, 400);
});

test("the debounce timer sends what's queued", async () => {
  const h = harness();
  h.queue.enqueue([op("a")]);
  h.timers.shift().run();
  await h.queue.drain();
  assert.equal(h.queue.pendingCount(), 0);
});

test("queued rows survive a restart", async () => {
  const first = harness();
  first.queue.enqueue([op("a", 7)]);
  const restarted = harness({ saved: first.saved });
  assert.equal(restarted.queue.pendingCount(), 1);
  await restarted.queue.drain();
  assert.deepEqual(restarted.sent[0].rows, [{ entry_id: "a", value: 7 }]);
});

test("a corrupt saved queue is ignored", () => {
  assert.equal(harness({ saved: "{nope" }).queue.pendingCount(), 0);
  assert.equal(harness({ saved: '[{"table":"watchlist"}]' }).queue.pendingCount(), 0);
});

test("large batches go in chunks, one table at a time", async () => {
  const h = harness();
  h.queue.enqueue(Array.from({ length: 450 }, (_, i) => op(`q${i}`)));
  h.queue.enqueue([op("r1", 1, { table: "game_library" })]);
  await h.queue.drain();
  assert.deepEqual(
    h.sent.map((s) => [s.table, s.rows.length]),
    [
      ["game_library", 1],
      ["game_queue", 200],
      ["game_queue", 200],
      ["game_queue", 50],
    ],
  );
});

test("an edit made during an upload is not lost", async () => {
  const h = harness();
  h.queue.enqueue([op("a", 1)]);
  h.respond = async () => {
    if (h.sent.length === 1) h.queue.enqueue([op("a", 2)]);
    return null;
  };
  await h.queue.drain();
  assert.equal(h.sent.length, 2);
  assert.deepEqual(h.sent[1].rows, [{ entry_id: "a", value: 2 }]);
  assert.equal(h.queue.pendingCount(), 0);
});

test("drain waits for a run already in flight", async () => {
  const h = harness();
  h.queue.enqueue([op("a")]);
  let release;
  h.respond = () => new Promise((done) => (release = () => done(null)));
  const first = h.queue.drain();
  await new Promise((done) => setImmediate(done));
  let secondFinished = false;
  const second = h.queue.drain().then(() => (secondFinished = true));
  await new Promise((done) => setImmediate(done));
  assert.equal(secondFinished, false);
  release();
  await Promise.all([first, second]);
  assert.equal(secondFinished, true);
  assert.equal(h.sent.length, 1);
});

test("only the signed-in user's rows are sent, and others stay queued", async () => {
  const h = harness();
  h.queue.enqueue([op("mine"), op("theirs", 1, { owner: { userId: "user-b", profileId: "p1" } })]);
  await h.queue.drain();
  assert.deepEqual(h.sent[0].rows, [{ entry_id: "mine", value: 1 }]);
  assert.equal(h.sent.length, 1);
  assert.equal(h.queue.pendingCount(), 1);
});

test("nothing is sent with no session", async () => {
  const h = harness({ userId: null });
  h.queue.enqueue([op("a")]);
  assert.equal(await h.queue.drain(), "no-session");
  assert.equal(h.sent.length, 0);
  assert.equal(h.queue.pendingCount(), 1);
});

test("a network failure keeps the rows and backs off", async () => {
  const h = harness();
  h.queue.enqueue([op("a")]);
  h.timers.length = 0;
  h.respond = async () => ({ message: "TypeError: Failed to fetch" });
  assert.equal(await h.queue.drain(), "failed");
  assert.equal(h.queue.pendingCount(), 1);
  assert.equal(h.timers[0].ms, 1000);
  h.timers.shift().run();
  await h.queue.drain();
  assert.equal(h.timers[0].ms, 2000);
});

test("backoff stops at a minute and resets after a success", async () => {
  const h = harness();
  h.queue.enqueue([op("a")]);
  h.timers.length = 0;
  h.respond = async () => ({ message: "offline" });
  for (let i = 0; i < 10; i++) {
    await h.queue.drain();
    if (i < 9) h.timers.shift().run();
    await new Promise((done) => setImmediate(done));
  }
  assert.equal(h.timers[0].ms, 60000);

  h.respond = async () => null;
  h.timers.shift().run();
  await h.queue.drain();
  h.respond = async () => ({ message: "offline" });
  h.queue.enqueue([op("b")]);
  h.timers.length = 0;
  await h.queue.drain();
  assert.equal(h.timers[0].ms, 1000);
});

test("rows the server rejects are held back without losing their neighbours", async () => {
  const h = harness();
  h.queue.enqueue([op("good-1"), op("bad"), op("good-2")]);
  h.respond = async (_table, rows) =>
    rows.some((r) => r.entry_id === "bad") ? { code: "23514", message: "check failed" } : null;
  assert.equal(await h.queue.drain(), "held");
  assert.equal(h.queue.pendingCount(), 1);
  const stored = h.sent.filter((s) => s.rows.length === 1).map((s) => s.rows[0].entry_id);
  assert.ok(stored.includes("good-1") && stored.includes("good-2"));
  assert.equal(h.drained, 0);
});

test("a held row isn't retried this session unless it changes", async () => {
  const h = harness();
  h.queue.enqueue([op("bad", 1)]);
  h.respond = async () => ({ code: "23514" });
  await h.queue.drain();
  const attempts = h.sent.length;
  await h.queue.drain();
  assert.equal(h.sent.length, attempts);

  h.respond = async () => null;
  h.queue.enqueue([op("bad", 2)]);
  assert.equal(await h.queue.drain(), "drained");
});

for (const [name, code] of [
  ["PostgREST can't find the table", "PGRST205"],
  ["Postgres can't find the table", "42P01"],
  ["PostgREST can't find a column", "PGRST204"],
  ["RLS refuses the write", "42501"],
]) {
  test(`when ${name}, the queue stops instead of retrying`, async () => {
    const h = harness();
    h.queue.enqueue([op("a"), op("b")]);
    h.timers.length = 0;
    h.respond = async () => ({ code });
    assert.equal(await h.queue.drain(), "blocked");
    assert.equal(h.sent.length, 1);
    assert.equal(h.timers.length, 0, "no retry scheduled");
    assert.equal(h.refreshes, 0, "a policy can't be fixed by refreshing the session");
    assert.equal(h.queue.isBlocked(), true);
  });
}

test("a blocked queue drops its rows and takes no more, since hydrate will resend", async () => {
  const h = harness();
  h.queue.enqueue([op("a")]);
  h.respond = async () => ({ code: "PGRST205" });
  await h.queue.drain();
  assert.equal(h.queue.pendingCount(), 0);
  h.queue.enqueue([op("b")]);
  assert.equal(h.queue.pendingCount(), 0);
  assert.equal(JSON.parse(h.saved).length, 0);
});

test("an expired session refreshes once and carries on", async () => {
  const h = harness();
  h.queue.enqueue([op("a")]);
  h.respond = async (_t, _r, attempt) => (attempt === 1 ? { code: "PGRST303", status: 401 } : null);
  assert.equal(await h.queue.drain(), "drained");
  assert.equal(h.refreshes, 1);
  assert.equal(h.queue.pendingCount(), 0);
});

test("a session that can't refresh backs off rather than looping", async () => {
  const h = harness({ refresh: false });
  h.queue.enqueue([op("a")]);
  h.timers.length = 0;
  h.respond = async () => ({ status: 401 });
  assert.equal(await h.queue.drain(), "failed");
  assert.equal(h.sent.length, 1);
  assert.equal(h.timers[0].ms, 1000);
});

test("a refresh that doesn't help can't loop within one run", async () => {
  const h = harness({ refresh: true });
  h.queue.enqueue([op("a")]);
  h.respond = async () => ({ status: 401 });
  assert.equal(await h.queue.drain(), "failed");
  assert.equal(h.refreshes, 1);
  assert.equal(h.sent.length, 2);
});

test("a thrown send is treated as a transient failure", async () => {
  const h = harness();
  h.queue.enqueue([op("a")]);
  h.respond = async () => {
    throw new Error("socket hang up");
  };
  assert.equal(await h.queue.drain(), "failed");
  assert.equal(h.queue.pendingCount(), 1);
});

test("the drained signal fires only once everything has landed", async () => {
  const h = harness();
  h.queue.enqueue([op("a")]);
  await h.queue.drain();
  assert.equal(h.drained, 1);
});

test("a deleted profile's rows leave the queue", async () => {
  const h = harness();
  const other = { userId: "user-a", profileId: "p2" };
  h.queue.enqueue([op("a"), op("b", 1, { owner: other })]);
  h.queue.dropProfile("p1");
  await h.queue.drain();
  assert.deepEqual(h.sent[0].rows, [{ entry_id: "b", value: 1 }]);
});

test("errors are sorted into what can and can't be retried", () => {
  assert.equal(classifyCloudError({ code: "42501", status: 403 }), "blocked");
  assert.equal(classifyCloudError({ code: "42501", status: 401 }), "blocked");
  assert.equal(classifyCloudError({ code: "23514" }), "bad-row");
  assert.equal(classifyCloudError({ code: "22003" }), "bad-row");
  assert.equal(classifyCloudError({ code: "PGRST303", status: 401 }), "auth");
  assert.equal(classifyCloudError({ status: 401 }), "auth");
  assert.equal(classifyCloudError({ status: 503 }), "transient");
  assert.equal(classifyCloudError({ message: "Failed to fetch" }), "transient");
});

test("every cloud query is scoped to the profile, since RLS can't do that", () => {
  const client = readFileSync(
    new URL("../src/lib/game-library/cloud/client.ts", import.meta.url),
    "utf8",
  );
  assert.equal((client.match(/\.select\(/g) ?? []).length, 1, "one read path");
  assert.match(
    client,
    /\.select\("\*"\)\s+\.eq\("user_id", owner\.userId\)\s+\.eq\("profile_id", owner\.profileId\)/,
  );
  const rows = readFileSync(
    new URL("../src/lib/game-library/cloud/rows.ts", import.meta.url),
    "utf8",
  );
  assert.match(rows, /"user_id,profile_id,game_id"/);
  assert.match(rows, /"user_id,profile_id,entry_id"/);
});

test("the movie sync queue is not used by the Game Library", () => {
  for (const file of ["cloud/queue.ts", "cloud/hydrate.ts", "cloud/client.ts", "store.ts"]) {
    const url = new URL(`../src/lib/game-library/${file}`, import.meta.url);
    assert.doesNotMatch(
      readFileSync(url, "utf8"),
      /@\/lib\/cloud\/(queue|mirror|hydrate|rows)/,
      file,
    );
  }
});
