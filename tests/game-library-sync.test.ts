// @ts-nocheck -- Node's test modules are not included in the application tsconfig.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { afterEach, beforeEach } from "node:test";
import {
  GAME_QUEUE_KEY,
  forgetGameProfile,
  gamesBackedUp,
  hasQueuedGameOps,
  libraryKey,
  libraryProfiles,
  markGamesSynced,
} from "../src/lib/game-library/backup-state.ts";
import {
  createSyncTracker,
  hydrateGameLibrary,
  pullLibrary,
} from "../src/lib/game-library/cloud/hydrate.ts";
import { createGameQueue } from "../src/lib/game-library/cloud/queue.ts";
import { GAME_TABLE, patchToOps } from "../src/lib/game-library/cloud/rows.ts";
import {
  addMember,
  collectionSummary,
  moveEntry,
  removeEntry,
  restoreEntries,
  saveCollection,
  saveGame,
  setNotes,
  setProgress,
  setStatus,
  startGame,
  tierBoard,
  moveToTier,
  wishlistView,
} from "../src/lib/game-library/rules.ts";
import { maxStamp } from "../src/lib/game-library/sanitize.ts";
import { createGameStore } from "../src/lib/game-library/store-core.ts";

const USER = "user-a";
const OWNER = { userId: USER, profileId: "p1" };

const ref = (rawgId) => ({
  provider: "rawg",
  rawgId,
  slug: `game-${rawgId}`,
  name: `Game ${rawgId}`,
  released: null,
  image: null,
});

const AC = { franchiseId: "ac", title: "AC", image: null };

const { warn, error } = console;
beforeEach(() => {
  console.warn = () => {};
  console.error = () => {};
});
afterEach(() => {
  console.warn = warn;
  console.error = error;
});

/** Behaves like the Supabase tables, including the merge triggers. */
function fakeCloud({ rowCap = Infinity } = {}) {
  const tables = { [GAME_TABLE.library]: new Map(), [GAME_TABLE.queue]: new Map() };
  const cloud = {
    tables,
    failWith: null,
    pulls: 0,
    keyOf: (table, row) =>
      `${row.user_id}|${row.profile_id}|${table === GAME_TABLE.library ? row.game_id : row.entry_id}`,

    async send(table, rows) {
      if (cloud.failWith) return cloud.failWith;
      for (const incoming of rows) {
        const key = cloud.keyOf(table, incoming);
        const stored = tables[table].get(key);
        if (!stored) {
          tables[table].set(key, structuredClone(incoming));
        } else if (table === GAME_TABLE.queue) {
          if (incoming.updated_at >= stored.updated_at)
            tables[table].set(key, structuredClone(incoming));
        } else {
          const next = structuredClone(incoming);
          const keepOlder = (stamp, fields) => {
            if (next[stamp] < stored[stamp]) for (const f of fields) next[f] = stored[f];
          };
          keepOlder("state_at", [
            "status",
            "started_at",
            "completed_at",
            "progress_enabled",
            "progress",
            "state_at",
          ]);
          keepOlder("notes_at", ["notes", "notes_at"]);
          keepOlder("tier_at", ["tier", "tier_position", "tier_at"]);
          tables[table].set(key, next);
        }
      }
      return null;
    },

    async pull(table, owner, from, to) {
      cloud.pulls++;
      if (cloud.failWith) return { rows: [], error: cloud.failWith };
      const rows = [...tables[table].values()]
        .filter((r) => r.user_id === owner.userId && r.profile_id === owner.profileId)
        .sort((a, b) => (cloud.keyOf(table, a) < cloud.keyOf(table, b) ? -1 : 1))
        .slice(from, Math.min(to + 1, from + rowCap));
      return { rows: structuredClone(rows), error: null };
    },
  };
  return cloud;
}

let clock = 10_000;

function device(cloud, { owner = OWNER, skew = 0, storage = fakeStorage() } = {}) {
  const store = createGameStore({
    read: (key) => storage.getItem(key),
    write: (key, value) => {
      storage.setItem(key, value);
      return true;
    },
    remove: (key) => storage.removeItem(key),
    now: () => (clock += 5) + skew,
    random: Math.random,
    isPlaceholderProfile: () => false,
  });
  const tracker = createSyncTracker(
    (o) => maxStamp(store.snapshot(o.profileId)),
    (o, stamp) => markGamesSynced(o.userId, o.profileId, stamp, storage),
  );
  const queue = createGameQueue({
    load: () => storage.getItem(GAME_QUEUE_KEY),
    save: (payload) => storage.setItem(GAME_QUEUE_KEY, payload),
    send: (table, rows) => cloud.send(table, rows),
    userId: () => owner.userId,
    refreshSession: async () => true,
    setTimer: () => 0,
    clearTimer: () => {},
    onDrained: tracker.drained,
  });
  const d = {
    store,
    queue,
    storage,
    online: true,
    get data() {
      return store.snapshot(owner.profileId);
    },
    change(fn, ...args) {
      const patch = store.apply(owner.profileId, (data, ctx) => fn(data, ...args, ctx));
      if (d.online) queue.enqueue(patchToOps(owner, patch));
      return patch;
    },
    sync: (isCurrent = () => true) =>
      hydrateGameLibrary({
        owner,
        pull: (...args) => cloud.pull(...args),
        drain: () => queue.drain(),
        enqueue: (ops) => queue.enqueue(ops),
        merge: (remote) => store.merge(owner.profileId, remote),
        isCurrent,
        markBlocked: () => queue.markBlocked(owner),
        onReconciled: () => tracker.reconciled(owner),
      }),
  };
  return d;
}

const order = (d) =>
  wishlistView(d.data).map((i) => (i.kind === "game" ? i.record.gameId : i.entry.entryId));

const members = (d, id) => collectionSummary(d.data, id).members.map((m) => m.record.gameId);

async function settle(...devices) {
  for (let round = 0; round < 2; round++) for (const d of devices) await d.sync();
}

test("a second device receives the queue, collections and personal data", async () => {
  const cloud = fakeCloud();
  const a = device(cloud);
  const b = device(cloud);
  a.change(saveGame, ref(1));
  a.change(saveCollection, AC, [ref(10), ref(11)], ["s"]);
  a.change(moveEntry, "c:ac|rawg:11", 0);
  a.change(setNotes, "rawg:10", "Sequence 4");
  await settle(a, b);

  assert.deepEqual(order(b), ["rawg:1", "c:ac"]);
  assert.deepEqual(members(b, "c:ac"), ["rawg:11", "rawg:10"]);
  assert.equal(b.data.records["rawg:10"].notes, "Sequence 4");
  assert.deepEqual(b.data.queue["c:ac"].catalogSeen, ["s"]);
});

test("concurrent reorders of different games both survive and converge", async () => {
  const cloud = fakeCloud();
  const a = device(cloud);
  const b = device(cloud);
  for (const id of [1, 2, 3, 4]) a.change(saveGame, ref(id));
  await settle(a, b);

  a.change(moveEntry, "g:rawg:4", 0);
  b.change(moveEntry, "g:rawg:3", 1);
  await settle(a, b);

  assert.deepEqual(order(a), order(b));
  assert.equal(order(a)[0], "rawg:4");
});

test("the same game moved on two devices ends up in one place everywhere", async () => {
  const cloud = fakeCloud();
  const a = device(cloud);
  const b = device(cloud);
  for (const id of [1, 2, 3]) a.change(saveGame, ref(id));
  await settle(a, b);

  a.change(moveEntry, "g:rawg:3", 0);
  b.change(moveEntry, "g:rawg:3", 1);
  await settle(a, b);

  assert.deepEqual(order(a), order(b));
  assert.deepEqual(order(a), ["rawg:1", "rawg:3", "rawg:2"]);
});

test("a reorder inside a collection on one device and of the queue on another both hold", async () => {
  const cloud = fakeCloud();
  const a = device(cloud);
  const b = device(cloud);
  a.change(saveGame, ref(1));
  a.change(saveCollection, AC, [ref(10), ref(11)], []);
  await settle(a, b);

  a.change(moveEntry, "c:ac", 0);
  b.change(moveEntry, "c:ac|rawg:11", 0);
  await settle(a, b);

  assert.deepEqual(order(a), ["c:ac", "rawg:1"]);
  assert.deepEqual(order(b), ["c:ac", "rawg:1"]);
  assert.deepEqual(members(a, "c:ac"), ["rawg:11", "rawg:10"]);
  assert.deepEqual(members(b, "c:ac"), ["rawg:11", "rawg:10"]);
});

test("notes on one device and a status on another both survive", async () => {
  const cloud = fakeCloud();
  const a = device(cloud);
  const b = device(cloud);
  a.change(startGame, ref(1));
  await settle(a, b);

  a.change(setNotes, "rawg:1", "Stopped before the final boss.");
  b.change(setStatus, "rawg:1", "completed");
  await settle(b, a);

  for (const d of [a, b]) {
    assert.equal(d.data.records["rawg:1"].notes, "Stopped before the final boss.");
    assert.equal(d.data.records["rawg:1"].status, "completed");
  }
});

test("an older cloud snapshot never overwrites a newer local edit", async () => {
  const cloud = fakeCloud();
  const a = device(cloud);
  a.change(startGame, ref(1));
  a.change(setNotes, "rawg:1", "first");
  await a.sync();

  const stale = await cloud.pull(GAME_TABLE.library, OWNER, 0, 99);
  a.change(setNotes, "rawg:1", "newer");
  const realPull = cloud.pull;
  let served = 0;
  cloud.pull = async (table, ...rest) => {
    if (table === GAME_TABLE.library && served++ === 0) return stale;
    return realPull(table, ...rest);
  };
  await a.sync();
  assert.equal(a.data.records["rawg:1"].notes, "newer");
});

test("offline edits are uploaded on reconnect by the queue", async () => {
  const cloud = fakeCloud();
  const a = device(cloud);
  const b = device(cloud);
  cloud.failWith = { message: "Failed to fetch" };
  a.change(saveGame, ref(1));
  assert.equal(await a.queue.drain(), "failed");
  assert.equal(a.queue.pendingCount(), 2);

  cloud.failWith = null;
  await settle(a, b);
  assert.deepEqual(order(b), ["rawg:1"]);
});

test("offline edits that never reached the queue are uploaded by hydrate", async () => {
  const cloud = fakeCloud();
  const a = device(cloud);
  const b = device(cloud);
  a.online = false;
  a.change(saveGame, ref(1));
  a.change(setNotes, "rawg:1", "written with no session");
  a.online = true;
  await settle(a, b);
  assert.equal(b.data.records["rawg:1"].notes, "written with no session");
});

test("a failed pull leaves local data exactly as it was", async () => {
  const cloud = fakeCloud();
  const a = device(cloud);
  a.change(saveGame, ref(1));
  await a.sync();
  const before = a.data;
  cloud.failWith = { status: 503, message: "unavailable" };
  assert.equal(await a.sync(), "failed");
  assert.equal(a.data, before);
});

test("a deletion reaches other devices and isn't resurrected by them", async () => {
  const cloud = fakeCloud();
  const a = device(cloud);
  const b = device(cloud);
  a.change(saveGame, ref(1));
  a.change(saveGame, ref(2));
  await settle(a, b);

  a.change(removeEntry, "g:rawg:1");
  await settle(a, b);
  assert.deepEqual(order(b), ["rawg:2"]);
  assert.deepEqual(order(a), ["rawg:2"]);
});

test("a device offline during a deletion doesn't bring the row back", async () => {
  const cloud = fakeCloud();
  const a = device(cloud);
  const b = device(cloud);
  a.change(saveGame, ref(1));
  await settle(a, b);
  a.change(removeEntry, "g:rawg:1");
  await a.sync();

  // b still has the live row, and only now reconnects.
  await b.sync();
  await a.sync();
  assert.deepEqual(order(b), []);
  assert.deepEqual(order(a), []);
});

test("undo reaches other devices and beats the tombstone", async () => {
  const cloud = fakeCloud();
  const a = device(cloud);
  const b = device(cloud);
  a.change(saveCollection, AC, [ref(10), ref(11)], []);
  await settle(a, b);

  const removed = a.change(removeEntry, "c:ac");
  await settle(a, b);
  assert.deepEqual(order(b), []);

  a.change(
    restoreEntries,
    removed.queue.map((e) => e.entryId),
  );
  await settle(a, b);
  assert.deepEqual(order(b), ["c:ac"]);
  assert.deepEqual(members(b, "c:ac"), ["rawg:10", "rawg:11"]);
});

test("a game added offline to a collection removed elsewhere brings the collection back", async () => {
  const cloud = fakeCloud();
  const a = device(cloud);
  const b = device(cloud);
  a.change(saveCollection, AC, [ref(10)], []);
  await settle(a, b);

  a.change(removeEntry, "c:ac");
  await a.sync();
  b.change(addMember, "c:ac", ref(11));
  await settle(b, a);

  assert.deepEqual(order(a), ["c:ac"]);
  assert.deepEqual(members(a, "c:ac"), ["rawg:11"]);
});

test("the same game saved on two offline devices is one row", async () => {
  const cloud = fakeCloud();
  const a = device(cloud);
  const b = device(cloud);
  a.change(saveGame, ref(1));
  b.change(saveGame, ref(1));
  await settle(a, b);
  assert.equal(cloud.tables[GAME_TABLE.queue].size, 1);
  assert.equal(cloud.tables[GAME_TABLE.library].size, 1);
  assert.deepEqual(order(a), ["rawg:1"]);
  assert.deepEqual(order(b), ["rawg:1"]);
});

test("a rank made offline survives a status change synced from elsewhere", async () => {
  const cloud = fakeCloud();
  const a = device(cloud);
  const b = device(cloud);
  a.change(startGame, ref(1));
  await settle(a, b);

  a.change(moveToTier, "rawg:1", "S", 0);
  b.change(setStatus, "rawg:1", "completed");
  await settle(b, a);

  for (const d of [a, b]) {
    assert.equal(d.data.records["rawg:1"].status, "completed");
    assert.deepEqual(
      tierBoard(d.data).S.map((t) => t.record.gameId),
      ["rawg:1"],
    );
  }
});

test("a device with a fast clock can't make later edits lose", async () => {
  const cloud = fakeCloud();
  const fast = device(cloud, { skew: 3_600_000 });
  const normal = device(cloud);
  fast.change(startGame, ref(1));
  fast.change(setProgress, "rawg:1", 10);
  await settle(fast, normal);

  normal.change(setProgress, "rawg:1", 80);
  await settle(normal, fast);
  assert.equal(fast.data.records["rawg:1"].progress, 80);
  assert.equal(normal.data.records["rawg:1"].progress, 80);
});

test("converged devices stop uploading", async () => {
  const cloud = fakeCloud();
  const a = device(cloud);
  const b = device(cloud);
  a.change(saveGame, ref(1));
  a.change(setNotes, "rawg:1", "x");
  await settle(a, b);

  const send = cloud.send;
  let sends = 0;
  cloud.send = (...args) => (sends++, send(...args));
  await settle(a, b);
  assert.equal(sends, 0);
});

test("pulls page past a server row cap instead of silently truncating", async () => {
  const cloud = fakeCloud({ rowCap: 3 });
  const a = device(cloud);
  const b = device(cloud);
  for (let id = 1; id <= 10; id++) a.change(saveGame, ref(id));
  await settle(a, b);
  assert.equal(order(b).length, 10);
});

test("a long list pages through the client's own page size", async () => {
  const cloud = fakeCloud();
  const a = device(cloud);
  for (let id = 1; id <= 1200; id++) a.change(saveGame, ref(id));
  await a.queue.drain();
  const { data } = await pullLibrary(cloud.pull, OWNER);
  assert.equal(Object.keys(data.records).length, 1200);
});

test("profiles on one account stay separate through sync", async () => {
  const cloud = fakeCloud();
  const p1 = device(cloud, { owner: { userId: USER, profileId: "p1" } });
  const p2 = device(cloud, { owner: { userId: USER, profileId: "p2" } });
  p1.change(saveGame, ref(1));
  p1.change(setNotes, "rawg:1", "p1 only");
  p2.change(saveGame, ref(2));
  await settle(p1, p2);

  assert.deepEqual(order(p1), ["rawg:1"]);
  assert.deepEqual(order(p2), ["rawg:2"]);
  assert.equal(p2.data.records["rawg:1"], undefined);
});

test("two accounts never receive each other's rows", async () => {
  const cloud = fakeCloud();
  const mine = device(cloud);
  const theirs = device(cloud, { owner: { userId: "user-b", profileId: "p1" } });
  mine.change(saveGame, ref(1));
  await settle(mine, theirs);
  assert.deepEqual(order(theirs), []);
});

test("a pull that finishes after a profile switch is thrown away", async () => {
  const cloud = fakeCloud();
  const a = device(cloud);
  const b = device(cloud);
  a.change(saveGame, ref(1));
  await a.sync();

  let current = true;
  const realPull = cloud.pull;
  cloud.pull = async (...args) => {
    const result = await realPull(...args);
    current = false; // the user switched profile while this was in flight
    return result;
  };
  assert.equal(await b.sync(() => current), "stale");
  assert.deepEqual(order(b), []);
});

test("a switch before the pull skips it", async () => {
  const cloud = fakeCloud();
  const a = device(cloud);
  assert.equal(await a.sync(() => false), "stale");
  assert.equal(cloud.pulls, 0);
});

for (const code of ["PGRST205", "42P01", "42501"]) {
  test(`with the cloud unusable (${code}) the library keeps working locally`, async () => {
    const cloud = fakeCloud();
    const a = device(cloud);
    cloud.failWith = { code };
    a.change(saveGame, ref(1));
    a.change(setNotes, "rawg:1", "kept");

    assert.equal(await a.sync(), "blocked");
    assert.equal(a.queue.isBlocked(), true);
    assert.equal(a.queue.pendingCount(), 0);
    a.change(saveGame, ref(2));
    assert.deepEqual(order(a), ["rawg:1", "rawg:2"]);
    assert.equal(a.data.records["rawg:1"].notes, "kept");
  });
}

test("once the tables exist, a new session uploads what was kept locally", async () => {
  const cloud = fakeCloud();
  cloud.failWith = { code: "PGRST205" };
  const session1 = device(cloud);
  session1.change(saveGame, ref(1));
  session1.change(setNotes, "rawg:1", "from before the migration");
  await session1.sync();

  cloud.failWith = null;
  const session2 = device(cloud);
  // Same disk contents: the blob is what carries across a restart.
  session2.store.merge("p1", structuredClone(session1.data));
  assert.equal(await session2.sync(), "synced");
  const [row] = cloud.tables[GAME_TABLE.library].values();
  assert.equal(row.notes, "from before the migration");
});

// ── sign-out and profile cleanup ────────────────────────────────────────────

function fakeStorage(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    has: (key) => map.has(key),
  };
}

const blob = (updatedAt) =>
  JSON.stringify({
    v: 1,
    records: {},
    queue: {
      "g:rawg:1": {
        entryId: "g:rawg:1",
        parentId: "",
        kind: "game",
        gameId: "rawg:1",
        position: "U1",
        updatedAt,
      },
    },
  });

test("someone who never used the Game Library can always sign out cleanly", () => {
  assert.equal(gamesBackedUp(USER, fakeStorage()), true);
  assert.equal(gamesBackedUp(USER, fakeStorage({ "harbor.watchlist.v1": "[]" })), true);
});

test("an empty library counts as backed up", () => {
  const storage = fakeStorage({
    [libraryKey("p1")]: JSON.stringify({ v: 1, records: {}, queue: {} }),
  });
  assert.equal(gamesBackedUp(USER, storage), true);
});

test("a library newer than the last sync is not backed up", () => {
  const storage = fakeStorage({ [libraryKey("p1")]: blob(500) });
  assert.equal(gamesBackedUp(USER, storage), false);
  markGamesSynced(USER, "p1", 499, storage);
  assert.equal(gamesBackedUp(USER, storage), false);
  markGamesSynced(USER, "p1", 500, storage);
  assert.equal(gamesBackedUp(USER, storage), true);
});

test("every profile on the device is checked, not just the active one", () => {
  const storage = fakeStorage({ [libraryKey("p1")]: blob(500), [libraryKey("p2")]: blob(700) });
  markGamesSynced(USER, "p1", 500, storage);
  assert.equal(gamesBackedUp(USER, storage), false);
  markGamesSynced(USER, "p2", 700, storage);
  assert.equal(gamesBackedUp(USER, storage), true);
});

test("a sync mark from another account doesn't count", () => {
  const storage = fakeStorage({ [libraryKey("p1")]: blob(500) });
  markGamesSynced("someone-else", "p1", 900, storage);
  assert.equal(gamesBackedUp(USER, storage), false);
});

test("queued rows mean not backed up, but only the signed-in user's", () => {
  const queued = (userId) =>
    fakeStorage({
      [GAME_QUEUE_KEY]: JSON.stringify([{ owner: { userId, profileId: "p1" } }]),
    });
  assert.equal(gamesBackedUp(USER, queued(USER)), false);
  assert.equal(gamesBackedUp(USER, queued("someone-else")), true);
});

test("a library counts as backed up only after a hydrate has compared both sides", async () => {
  const cloud = fakeCloud();
  const a = device(cloud);
  a.change(saveGame, ref(1));
  await a.queue.drain();
  // Uploaded, but an empty queue can't prove nothing was missed before it.
  assert.equal(gamesBackedUp(USER, a.storage), false);

  await a.sync();
  assert.equal(gamesBackedUp(USER, a.storage), true);
});

test("edits after a hydrate stay backed up as each upload lands", async () => {
  const cloud = fakeCloud();
  const a = device(cloud);
  await a.sync();
  a.change(saveGame, ref(1));
  assert.equal(gamesBackedUp(USER, a.storage), false, "still queued");
  await a.queue.drain();
  assert.equal(gamesBackedUp(USER, a.storage), true);
});

test("an upload that fails leaves the library not backed up", async () => {
  const cloud = fakeCloud();
  const a = device(cloud);
  await a.sync();
  cloud.failWith = { message: "Failed to fetch" };
  a.change(saveGame, ref(1));
  await a.queue.drain();
  assert.equal(gamesBackedUp(USER, a.storage), false);
});

test("a row the server keeps rejecting leaves the library not backed up", async () => {
  const cloud = fakeCloud();
  const a = device(cloud);
  await a.sync();
  cloud.failWith = { code: "23514" };
  a.change(saveGame, ref(1));
  assert.equal(await a.queue.drain(), "held");
  assert.equal(gamesBackedUp(USER, a.storage), false);
});

test("while the tables are missing, game data is never treated as backed up", async () => {
  const cloud = fakeCloud();
  cloud.failWith = { code: "PGRST205" };
  const a = device(cloud);
  a.change(saveGame, ref(1));
  assert.equal(await a.sync(), "blocked");
  // The queue is empty here, so only the content check protects this data.
  assert.equal(a.queue.pendingCount(), 0);
  assert.equal(gamesBackedUp(USER, a.storage), false);
});

test("with the tables missing, an account with no game data still signs out normally", async () => {
  const cloud = fakeCloud();
  cloud.failWith = { code: "PGRST205" };
  const a = device(cloud);
  assert.equal(await a.sync(), "blocked");
  assert.equal(gamesBackedUp(USER, a.storage), true);
});

test("the shell waits for game data at sign-out and on close, without chaining", () => {
  const source = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

  const session = source("lib/cloud/session.tsx");
  assert.match(session, /await flush\(\)[\s\S]*?await flushGames\(\)[\s\S]*?gamesBackedUp\(uid\)/);

  const app = source("App.tsx");
  assert.match(app, /Promise\.allSettled\(\[flushCloud\(\), flushGames\(\)\]\)/);
  assert.match(app, /<GameLibrarySync \/>/);

  const mirror = source("lib/cloud/mirror.ts");
  assert.match(mirror, /TABLE\.settings,\s+"game_library",\s+"game_queue",\s+\]/);
});

test("a deleted profile's queued rows go before the cloud purge", () => {
  const profiles = readFileSync(new URL("../src/lib/profiles.tsx", import.meta.url), "utf8");
  assert.match(profiles, /forgetGameProfile\(id\);[\s\S]*?purgeProfileFromCloud\(id\);/);
});

test("the shell loads only leaf helpers, so Games adds nothing to startup", () => {
  const leaf = readFileSync(
    new URL("../src/lib/game-library/backup-state.ts", import.meta.url),
    "utf8",
  );
  const imports = leaf.split(/\r?\n/).filter((line) => /^import /.test(line));
  assert.deepEqual(imports, [
    'import { emptyLibrary, maxStamp, sanitizeLibrary } from "./sanitize.ts";',
    'import type { GameLibraryData } from "./types.ts";',
  ]);
  const sync = readFileSync(
    new URL("../src/lib/game-library/cloud/sync.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(sync, /^import .*(client|queue|hydrate|store)/m);
});

test("deleting a profile removes its blob, queued rows and sync mark", () => {
  const storage = fakeStorage({
    [libraryKey("p1")]: blob(500),
    [libraryKey("p2")]: blob(600),
    [GAME_QUEUE_KEY]: JSON.stringify([
      { owner: { userId: USER, profileId: "p1" } },
      { owner: { userId: USER, profileId: "p2" } },
    ]),
  });
  markGamesSynced(USER, "p1", 500, storage);
  forgetGameProfile("p1", storage);

  assert.deepEqual(libraryProfiles(storage), ["p2"]);
  assert.equal(JSON.parse(storage.getItem(GAME_QUEUE_KEY)).length, 1);
  assert.equal(storage.has(`harbor.cloud.games.synced.v1.${USER}.p1`), false);
});

test("a corrupt queue never blocks sign-out or crashes it", () => {
  const storage = fakeStorage({ [GAME_QUEUE_KEY]: "{bad" });
  assert.equal(hasQueuedGameOps(storage), false);
  assert.equal(gamesBackedUp(USER, storage), true);
});

test("game data follows the same wipe and backup rules as other user data", () => {
  const source = readFileSync(new URL("../src/lib/backup.ts", import.meta.url), "utf8");
  assert.match(source, /key\.startsWith\("harbor\.cloud\."\)\) return false/);
  assert.ok(GAME_QUEUE_KEY.startsWith("harbor.cloud."), "the queue stays on this device");
  assert.ok(libraryKey("p1").startsWith("harbor.games."), "the library travels with backups");
  assert.ok(!libraryKey("p1").startsWith("harbor.cloud."));
});
