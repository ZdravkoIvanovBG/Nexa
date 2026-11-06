// @ts-nocheck -- Node's test modules are not included in the application tsconfig.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { afterEach, beforeEach } from "node:test";
import {
  GAME_QUEUE_KEY,
  forgetGameProfile,
  gameSyncState,
  gameSyncSummary,
  gamesBackedUp,
  hasQueuedGameOps,
  libraryKey,
  libraryProfiles,
  parseLibraryBlob,
  prepareGameHold,
  restoreHeldGames,
} from "../src/lib/game-library/backup-state.ts";
import {
  createSyncTracker,
  hydrateGameLibrary,
  pullLibrary,
} from "../src/lib/game-library/cloud/hydrate.ts";
import { createGameQueue } from "../src/lib/game-library/cloud/queue.ts";
import { GAME_TABLE, patchToOps } from "../src/lib/game-library/cloud/rows.ts";
import {
  addCatalogGames,
  addMember,
  catalogAdditions,
  collectionSummary,
  moveEntry,
  refreshSnapshot,
  removeEntry,
  restoreEntries,
  saveCollection,
  saveGame,
  setNotes,
  setProgress,
  setProgressEnabled,
  setStatus,
  startGame,
  tierBoard,
  moveToTier,
  wishlistView,
} from "../src/lib/game-library/rules.ts";
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
          continue;
        }
        const next = structuredClone(incoming);
        const keepOlder = (stamp, fields) => {
          if (next[stamp] < stored[stamp]) for (const f of fields) next[f] = stored[f];
        };
        if (table === GAME_TABLE.queue) {
          keepOlder("updated_at", [
            "parent_id",
            "kind",
            "game_id",
            "franchise_id",
            "title",
            "image",
            "catalog_seen",
            "position",
            "added_at",
            "updated_at",
          ]);
          keepOlder("live_at", ["deleted_at", "live_at"]);
        } else {
          keepOlder("meta_at", ["slug", "name", "released", "image", "meta_at"]);
          keepOlder("state_at", ["status", "started_at", "completed_at", "state_at"]);
          keepOlder("progress_at", ["progress_enabled", "progress", "progress_at"]);
          keepOlder("notes_at", ["notes", "notes_at"]);
          keepOlder("tier_at", ["tier", "tier_position", "tier_at"]);
        }
        tables[table].set(key, next);
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
  const tracker = createSyncTracker((o) => store.markSynced(o.profileId));
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

test("progress on one device survives a later status change on another", async () => {
  const cloud = fakeCloud();
  const a = device(cloud);
  const b = device(cloud);
  a.change(startGame, ref(1));
  a.change(setProgressEnabled, "rawg:1", true);
  a.change(setProgress, "rawg:1", 10);
  await settle(a, b);

  a.change(setProgress, "rawg:1", 50);
  b.change(setStatus, "rawg:1", "paused");
  await settle(a, b);

  for (const d of [a, b]) {
    assert.equal(d.data.records["rawg:1"].progress, 50);
    assert.equal(d.data.records["rawg:1"].status, "paused");
  }
});

test("starting a game on a device that hasn't pulled it keeps its progress and notes", async () => {
  const cloud = fakeCloud();
  const a = device(cloud);
  const b = device(cloud);
  a.change(startGame, ref(1));
  a.change(setProgressEnabled, "rawg:1", true);
  a.change(setProgress, "rawg:1", 35);
  a.change(setNotes, "rawg:1", "Sequence 4");
  await a.sync();

  b.change(startGame, ref(1));
  await settle(b, a);

  for (const d of [a, b]) {
    assert.equal(d.data.records["rawg:1"].progress, 35);
    assert.equal(d.data.records["rawg:1"].progressEnabled, true);
    assert.equal(d.data.records["rawg:1"].notes, "Sequence 4");
  }
});

test("an edit from a stale device can't restore an older snapshot", async () => {
  const cloud = fakeCloud();
  const a = device(cloud);
  const b = device(cloud);
  a.change(saveGame, ref(1));
  await settle(a, b);

  const newer = { ...ref(1), name: "Game 1: Remastered", image: "https://media.rawg.io/new.jpg" };
  a.change(refreshSnapshot, newer);
  await a.sync();
  b.change(setNotes, "rawg:1", "edited without pulling first");
  await b.queue.drain();
  await settle(a, b);

  for (const d of [a, b]) {
    assert.equal(d.data.records["rawg:1"].name, "Game 1: Remastered");
    assert.equal(d.data.records["rawg:1"].notes, "edited without pulling first");
  }
});

test("a reorder on another device doesn't bring a removed game back", async () => {
  const cloud = fakeCloud();
  const a = device(cloud);
  const b = device(cloud);
  for (const id of [1, 2, 3]) a.change(saveGame, ref(id));
  await settle(a, b);

  a.change(removeEntry, "g:rawg:1");
  await a.sync();
  b.change(moveEntry, "g:rawg:1", 2);
  await settle(b, a);

  assert.deepEqual(order(a), ["rawg:2", "rawg:3"]);
  assert.deepEqual(order(b), ["rawg:2", "rawg:3"]);
});

test("moving a collection on another device doesn't bring it back empty", async () => {
  const cloud = fakeCloud();
  const a = device(cloud);
  const b = device(cloud);
  a.change(saveGame, ref(1));
  a.change(saveCollection, AC, [ref(10), ref(11)], []);
  await settle(a, b);

  a.change(removeEntry, "c:ac");
  await a.sync();
  b.change(moveEntry, "c:ac", 0);
  await settle(b, a);

  assert.deepEqual(order(a), ["rawg:1"]);
  assert.deepEqual(order(b), ["rawg:1"]);
});

test("reordering inside a removed collection doesn't bring it back", async () => {
  const cloud = fakeCloud();
  const a = device(cloud);
  const b = device(cloud);
  a.change(saveCollection, AC, [ref(10), ref(11), ref(12)], []);
  await settle(a, b);

  a.change(removeEntry, "c:ac");
  await a.sync();
  b.change(moveEntry, "c:ac|rawg:12", 0);
  await settle(b, a);

  assert.deepEqual(order(a), []);
  assert.deepEqual(order(b), []);
});

test("undo after an offline reorder restores the row where it was moved to", async () => {
  const cloud = fakeCloud();
  const a = device(cloud);
  const b = device(cloud);
  for (const id of [1, 2, 3]) a.change(saveGame, ref(id));
  await settle(a, b);

  const removed = a.change(removeEntry, "g:rawg:3");
  await a.sync();
  b.change(moveEntry, "g:rawg:3", 0);
  await settle(b, a);
  a.change(
    restoreEntries,
    removed.queue.map((e) => e.entryId),
  );
  await settle(a, b);

  assert.deepEqual(order(a), ["rawg:3", "rawg:1", "rawg:2"]);
  assert.deepEqual(order(b), ["rawg:3", "rawg:1", "rawg:2"]);
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

test("a first sync with nothing on either side only reads", async () => {
  const cloud = fakeCloud();
  const storage = fakeStorage();
  const writes = [];
  const setItem = storage.setItem;
  storage.setItem = (key, value) => {
    writes.push(key);
    return setItem(key, value);
  };
  let sends = 0;
  const send = cloud.send;
  cloud.send = (...args) => (sends++, send(...args));

  const a = device(cloud, { storage });
  assert.equal(await a.sync(), "synced");

  assert.equal(sends, 0, "nothing uploaded");
  assert.deepEqual(writes, [], "nothing written on this device");
  assert.equal(cloud.tables[GAME_TABLE.library].size, 0);
  assert.equal(cloud.tables[GAME_TABLE.queue].size, 0);
  assert.equal(cloud.pulls, 2, "one request per table, no more");
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

const blob = (unsynced) =>
  JSON.stringify({
    v: 1,
    unsynced,
    records: {},
    queue: {
      "g:rawg:1": {
        entryId: "g:rawg:1",
        parentId: "",
        kind: "game",
        gameId: "rawg:1",
        position: "U1",
        updatedAt: 500,
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

test("a library holding unsent changes is not backed up", () => {
  assert.equal(gamesBackedUp(USER, fakeStorage({ [libraryKey("p1")]: blob(true) })), false);
  assert.equal(gamesBackedUp(USER, fakeStorage({ [libraryKey("p1")]: blob(false) })), true);
});

test("every profile on the device is checked, not just the active one", () => {
  const storage = fakeStorage({
    [libraryKey("p1")]: blob(false),
    [libraryKey("p2")]: blob(true),
  });
  assert.equal(gamesBackedUp(USER, storage), false);
});

test("a change is marked unsent in the same write that saves it", () => {
  const storage = fakeStorage();
  const a = device(fakeCloud(), { storage });
  a.change(saveGame, ref(1));
  assert.equal(parseLibraryBlob(storage.getItem(libraryKey("p1"))).unsynced, true);
  // Nothing has been queued or sent yet, and a restart must still know.
  const restarted = device(fakeCloud(), { storage });
  assert.equal(restarted.store.isUnsynced("p1"), true);
});

test("an unsent edit can't hide behind a stamp from a device with a fast clock", async () => {
  const cloud = fakeCloud();
  const fast = device(cloud, { skew: 86_400_000 });
  const slow = device(cloud);
  fast.change(saveGame, ref(1));
  await settle(fast, slow);
  assert.equal(gamesBackedUp(USER, slow.storage), true);

  // Older than the stamp just pulled, and the cloud can't take it.
  cloud.failWith = { code: "PGRST205" };
  slow.change(saveGame, ref(2));
  await slow.queue.drain();
  assert.equal(slow.queue.pendingCount(), 0);
  assert.equal(gamesBackedUp(USER, slow.storage), false);
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
  // The queue is empty here, so only the unsynced flag protects this data.
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
    'import { mergeLibrary } from "./merge.ts";',
    'import { emptyLibrary, sanitizeLibrary } from "./sanitize.ts";',
    'import type { GameLibraryData } from "./types.ts";',
  ]);
  const sync = readFileSync(
    new URL("../src/lib/game-library/cloud/sync.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(sync, /^import .*(client|queue|hydrate|store)/m);
});

test("deleting a profile removes its blob, queued rows and held copy", () => {
  const storage = fakeStorage({
    [libraryKey("p1")]: blob(true),
    [libraryKey("p2")]: blob(false),
    [GAME_QUEUE_KEY]: JSON.stringify([
      { owner: { userId: USER, profileId: "p1" } },
      { owner: { userId: USER, profileId: "p2" } },
    ]),
  });
  prepareGameHold(USER, storage)();
  assert.equal(heldKeys(storage).length, 1);
  forgetGameProfile("p1", storage);

  assert.deepEqual(libraryProfiles(storage), ["p2"]);
  assert.equal(JSON.parse(storage.getItem(GAME_QUEUE_KEY)).length, 1);
  assert.deepEqual(heldKeys(storage), []);
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

// ── switching accounts on one device ────────────────────────────────────────

const OWNER_KEY = "harbor.local.ownerUserId";
const ALICE = { userId: "alice", profileId: "alice-profile" };
const BOB = { userId: "bob", profileId: "bob-profile" };

/** The same rule as isPortable in backup.ts, which a test can't import. */
function isPortable(key) {
  return key.startsWith("harbor.") && !key.startsWith("harbor.cloud.") && key !== OWNER_KEY;
}

function portableKeys(storage) {
  return Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter(isPortable);
}

function heldKeys(storage) {
  return Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter((key) =>
    key.startsWith("harbor.cloud.games.held."),
  );
}

/** wipePortableLocalData, in the order the "same order" test below pins down. */
function wipe(storage) {
  const holdGames = prepareGameHold(storage.getItem(OWNER_KEY), storage);
  for (const key of portableKeys(storage)) storage.removeItem(key);
  holdGames();
}

/** claimLocalData, likewise. Returns whether the app reloads. */
function claim(storage, userId) {
  const owner = storage.getItem(OWNER_KEY);
  const mismatch = !!owner && owner !== userId;
  if (mismatch) wipe(storage);
  storage.setItem(OWNER_KEY, userId);
  const restoredGames = restoreHeldGames(userId, storage);
  return mismatch || restoredGames;
}

/** A device where Alice has signed in and made a change the cloud can't take yet. */
async function aliceWithUnsentNotes(cloud) {
  const storage = fakeStorage();
  claim(storage, ALICE.userId);
  cloud.failWith = { code: "PGRST205" };
  const alice = device(cloud, { owner: ALICE, storage });
  alice.change(startGame, ref(1));
  alice.change(setNotes, "rawg:1", "Alice's private note");
  assert.equal(await alice.sync(), "blocked");
  // The worst case: nothing queued, nothing uploaded, so only the disk has it.
  assert.equal(alice.queue.pendingCount(), 0);
  assert.equal(hasQueuedGameOps(storage), false);
  cloud.failWith = null;
  return storage;
}

test("edits the queue never saw survive another account signing in", async () => {
  const cloud = fakeCloud();
  const storage = await aliceWithUnsentNotes(cloud);
  assert.equal(gamesBackedUp(ALICE.userId, storage), false, "sign-out keeps it");

  assert.equal(claim(storage, BOB.userId), true);
  assert.deepEqual(libraryProfiles(storage), [], "the local library is gone for Bob");

  assert.equal(claim(storage, ALICE.userId), true, "Alice's return reloads");
  const alice = device(cloud, { owner: ALICE, storage });
  assert.equal(alice.data.records["rawg:1"].notes, "Alice's private note");
  assert.equal(await alice.sync(), "synced");

  const [row] = cloud.tables[GAME_TABLE.library].values();
  assert.equal(row.user_id, ALICE.userId);
  assert.equal(row.notes, "Alice's private note");
  assert.deepEqual(heldKeys(storage), [], "nothing left behind once it's home");
  assert.equal(gamesBackedUp(ALICE.userId, storage), true);
});

test("another account can't see, upload or back up games held for someone else", async () => {
  const cloud = fakeCloud();
  const storage = await aliceWithUnsentNotes(cloud);
  claim(storage, BOB.userId);

  const bob = device(cloud, { owner: BOB, storage });
  assert.deepEqual(wishlistView(bob.data), []);
  assert.equal(bob.data.records["rawg:1"], undefined);
  assert.equal(bob.store.snapshot(ALICE.profileId).records["rawg:1"], undefined);

  bob.change(saveGame, ref(2));
  await settle(bob);
  const owners = [...cloud.tables[GAME_TABLE.library].values()].map((row) => row.user_id);
  assert.deepEqual(owners, [BOB.userId]);

  for (const key of portableKeys(storage)) {
    assert.doesNotMatch(storage.getItem(key), /Alice's private note/, key);
  }
  assert.equal(gamesBackedUp(BOB.userId, storage), true, "Alice's copy doesn't hold Bob back");
  assert.equal(heldKeys(storage).length, 1, "and it's still there for her");
});

test("held games are only restored for the account that owns them", async () => {
  const cloud = fakeCloud();
  const storage = await aliceWithUnsentNotes(cloud);
  claim(storage, BOB.userId);
  assert.equal(restoreHeldGames(BOB.userId, storage), false);
  assert.equal(restoreHeldGames("carol", storage), false);
  assert.deepEqual(libraryProfiles(storage), []);
  assert.equal(heldKeys(storage).length, 1);
});

test("a library already in the cloud isn't kept on the device for no reason", async () => {
  const cloud = fakeCloud();
  const storage = fakeStorage();
  claim(storage, ALICE.userId);
  const alice = device(cloud, { owner: ALICE, storage });
  alice.change(setNotes, "rawg:1", "ignored, there's no game yet");
  alice.change(startGame, ref(1));
  alice.change(setNotes, "rawg:1", "Alice's private note");
  assert.equal(await alice.sync(), "synced");

  claim(storage, BOB.userId);
  assert.deepEqual(heldKeys(storage), []);
  for (let i = 0; i < storage.length; i++) {
    assert.doesNotMatch(storage.getItem(storage.key(i)), /Alice's private note/);
  }
});

test("queued edits and held copies don't fight when their owner returns", async () => {
  const cloud = fakeCloud();
  const storage = fakeStorage();
  claim(storage, ALICE.userId);
  const alice = device(cloud, { owner: ALICE, storage });
  await alice.sync();
  cloud.failWith = { message: "Failed to fetch" };
  alice.change(startGame, ref(1));
  alice.change(setNotes, "rawg:1", "queued while offline");
  await alice.queue.drain();
  assert.equal(alice.queue.pendingCount(), 1, "both edits are to one row");
  cloud.failWith = null;

  claim(storage, BOB.userId);
  claim(storage, ALICE.userId);
  const back = device(cloud, { owner: ALICE, storage });
  assert.equal(back.queue.pendingCount(), 1);
  await settle(back);
  assert.equal(cloud.tables[GAME_TABLE.library].size, 1);
  assert.equal([...cloud.tables[GAME_TABLE.library].values()][0].notes, "queued while offline");
  assert.equal(back.queue.pendingCount(), 0);
});

test("a newer edit from another device still wins over a held copy", async () => {
  const cloud = fakeCloud();
  const storage = await aliceWithUnsentNotes(cloud);
  claim(storage, BOB.userId);

  const laptop = device(cloud, { owner: ALICE });
  laptop.change(startGame, ref(1));
  laptop.change(setNotes, "rawg:1", "newer, from the laptop");
  laptop.change(setProgress, "rawg:1", 40);
  await laptop.sync();

  claim(storage, ALICE.userId);
  const alice = device(cloud, { owner: ALICE, storage });
  await settle(alice, laptop);
  for (const d of [alice, laptop]) {
    assert.equal(d.data.records["rawg:1"].notes, "newer, from the laptop");
    assert.equal(d.data.records["rawg:1"].progress, 40);
  }
});

test("repeated switching keeps every account's unsent games apart", async () => {
  const cloud = fakeCloud();
  const storage = await aliceWithUnsentNotes(cloud);
  cloud.failWith = { code: "PGRST205" };

  claim(storage, BOB.userId);
  const bob = device(cloud, { owner: BOB, storage });
  bob.change(startGame, ref(2));
  bob.change(setNotes, "rawg:2", "Bob's private note");

  claim(storage, ALICE.userId);
  const alice = device(cloud, { owner: ALICE, storage });
  assert.equal(alice.data.records["rawg:1"].notes, "Alice's private note");
  assert.equal(alice.data.records["rawg:2"], undefined);
  alice.change(setNotes, "rawg:1", "Alice's second thought");

  claim(storage, BOB.userId);
  const bobAgain = device(cloud, { owner: BOB, storage });
  assert.equal(bobAgain.data.records["rawg:2"].notes, "Bob's private note");
  assert.equal(bobAgain.data.records["rawg:1"], undefined);

  claim(storage, ALICE.userId);
  const aliceAgain = device(cloud, { owner: ALICE, storage });
  assert.equal(aliceAgain.data.records["rawg:1"].notes, "Alice's second thought");
  assert.equal(heldKeys(storage).length, 1, "only Bob's is still held");
});

test("each of an account's profiles is held and restored separately", async () => {
  const cloud = fakeCloud();
  cloud.failWith = { code: "PGRST205" };
  const storage = fakeStorage();
  claim(storage, ALICE.userId);
  const first = device(cloud, { owner: { userId: ALICE.userId, profileId: "p1" }, storage });
  const second = device(cloud, { owner: { userId: ALICE.userId, profileId: "p2" }, storage });
  first.change(saveGame, ref(1));
  second.change(saveGame, ref(2));

  claim(storage, BOB.userId);
  assert.equal(heldKeys(storage).length, 2);
  claim(storage, ALICE.userId);
  assert.deepEqual(libraryProfiles(storage).sort(), ["p1", "p2"]);
  const reopened = device(cloud, { owner: { userId: ALICE.userId, profileId: "p2" }, storage });
  assert.deepEqual(order(reopened), ["rawg:2"]);
});

test("a restored library stays marked unsent until it has really been uploaded", async () => {
  const cloud = fakeCloud();
  const storage = await aliceWithUnsentNotes(cloud);
  claim(storage, BOB.userId);
  claim(storage, ALICE.userId);
  assert.equal(gamesBackedUp(ALICE.userId, storage), false);

  cloud.failWith = { message: "Failed to fetch" };
  const alice = device(cloud, { owner: ALICE, storage });
  assert.equal(await alice.sync(), "failed");
  assert.equal(gamesBackedUp(ALICE.userId, storage), false);

  // Bob signs in again before it ever reached the cloud, and it's held again.
  cloud.failWith = null;
  claim(storage, BOB.userId);
  assert.equal(heldKeys(storage).length, 1);
});

test("a backup restore doesn't discard changes the cloud hasn't seen", async () => {
  const cloud = fakeCloud();
  const storage = await aliceWithUnsentNotes(cloud);
  const backup = { [libraryKey(ALICE.profileId)]: blob(false) };

  wipe(storage);
  for (const [key, value] of Object.entries(backup)) storage.setItem(key, value);
  assert.equal(claim(storage, ALICE.userId), true, "the restart after a restore reloads once");

  const alice = device(cloud, { owner: ALICE, storage });
  assert.equal(alice.data.records["rawg:1"].notes, "Alice's private note");
  assert.ok(alice.data.queue["g:rawg:1"], "and the backup's rows are there too");
  assert.equal(claim(storage, ALICE.userId), false, "no reload loop");
});

test("a failed restore keeps the held copy and doesn't reload", async () => {
  const cloud = fakeCloud();
  const storage = await aliceWithUnsentNotes(cloud);
  claim(storage, BOB.userId);

  const realSet = storage.setItem;
  storage.setItem = (key, value) => {
    if (key.startsWith("harbor.games.library.")) throw new Error("disk full");
    return realSet(key, value);
  };
  assert.equal(restoreHeldGames(ALICE.userId, storage), false);
  assert.equal(heldKeys(storage).length, 1);

  storage.setItem = realSet;
  assert.equal(restoreHeldGames(ALICE.userId, storage), true);
  assert.deepEqual(heldKeys(storage), []);
});

test("a device with no known owner holds nothing, rather than guessing", () => {
  const storage = fakeStorage({ [libraryKey("p1")]: blob(true) });
  prepareGameHold(null, storage)();
  assert.deepEqual(heldKeys(storage), []);
});

test("the wipe and sign-in code run these steps in this order", () => {
  const source = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

  const wipeBody = /export function wipePortableLocalData\(\): void \{([\s\S]*?)\n\}/.exec(
    source("lib/backup.ts"),
  )?.[1];
  assert.ok(wipeBody);
  assert.match(
    wipeBody,
    /prepareGameHold\(localStorage\.getItem\(LOCAL_OWNER_KEY\)\)[\s\S]*removeItem\(key\)[\s\S]*holdGames\(\);/,
  );
  assert.match(source("lib/backup.ts"), /const LOCAL_OWNER_KEY = "harbor\.local\.ownerUserId";/);

  const session = source("lib/cloud/session.tsx");
  assert.match(session, /const LOCAL_OWNER_KEY = "harbor\.local\.ownerUserId";/);
  const claimBody = /function claimLocalData\(userId: string\): boolean \{([\s\S]*?)\n\}/.exec(
    session,
  )?.[1];
  assert.ok(claimBody);
  assert.match(
    claimBody,
    /if \(mismatch\) wipePortableLocalData\(\);\s+writeLocalOwner\(userId\);\s+const restoredGames = restoreHeldGames\(userId\);\s+return mismatch \|\| restoredGames;/,
  );
  // Every path that claims data reloads when told to, so nothing reads stale state.
  const callers = session.match(/if \([^\n]*claimLocalData\(/g) ?? [];
  const reloading = session.match(/claimLocalData\([^)\n]*\)\) \{\s+window\.location\.reload/g);
  assert.equal(callers.length, 4);
  assert.equal(reloading?.length, callers.length);
});

test("every library change goes through one path, which queues it synchronously", () => {
  const store = readFileSync(new URL("../src/lib/game-library/store.ts", import.meta.url), "utf8");
  assert.doesNotMatch(store, /\bimport\(/, "the hand-off to the queue must not be asynchronous");
  assert.match(
    store,
    /const patch = gameStore\.apply\(activeId, change\);\s+if \(!isEmptyPatch\(patch\)\) queueLibraryChange\(activeId, patch\);/,
  );
});

// ── Wishlist actions from Stage 4 ───────────────────────────────────────────

test("new catalog games added on one device and a reorder on another both land", async () => {
  const cloud = fakeCloud();
  const a = device(cloud);
  const b = device(cloud);
  a.change(saveCollection, AC, [ref(10), ref(11)], ["s10", "s11"]);
  await settle(a, b);

  a.change(addCatalogGames, "c:ac", [ref(12)], ["s12"]);
  b.change(moveEntry, "c:ac|rawg:11", 0);
  await settle(a, b);

  assert.deepEqual(members(a, "c:ac"), ["rawg:11", "rawg:10", "rawg:12"]);
  assert.deepEqual(members(b, "c:ac"), members(a, "c:ac"));
  assert.deepEqual(catalogAdditions(b.data.queue["c:ac"], ["s10", "s11", "s12"]), []);
});

test("catalog games added while the collection moves elsewhere are never duplicated", async () => {
  const cloud = fakeCloud();
  const a = device(cloud);
  const b = device(cloud);
  a.change(saveGame, ref(1));
  a.change(saveCollection, AC, [ref(10)], ["s10"]);
  await settle(a, b);

  // Both write the collection row: the later one wins it whole.
  a.change(addCatalogGames, "c:ac", [ref(12)], ["s12"]);
  b.change(moveEntry, "c:ac", 0);
  await settle(a, b);
  a.change(addCatalogGames, "c:ac", [ref(12)], ["s12"]);
  await settle(a, b);

  assert.deepEqual(members(a, "c:ac"), ["rawg:10", "rawg:12"]);
  assert.deepEqual(members(b, "c:ac"), ["rawg:10", "rawg:12"]);
  assert.deepEqual(order(a), order(b));
});

test("the same franchise saved on two offline devices is one collection", async () => {
  const cloud = fakeCloud();
  const a = device(cloud);
  const b = device(cloud);
  a.change(saveCollection, AC, [ref(10), ref(11)], []);
  b.change(saveCollection, AC, [ref(10), ref(11)], []);
  await settle(a, b);

  assert.deepEqual(order(a), ["c:ac"]);
  assert.deepEqual(order(b), ["c:ac"]);
  assert.equal(members(a, "c:ac").length, 2);
  assert.deepEqual(members(a, "c:ac"), members(b, "c:ac"));
});

test("a game removed from a collection stays out while another device reorders it", async () => {
  const cloud = fakeCloud();
  const a = device(cloud);
  const b = device(cloud);
  a.change(saveCollection, AC, [ref(10), ref(11), ref(12)], []);
  await settle(a, b);

  a.change(removeEntry, "c:ac|rawg:11");
  b.change(moveEntry, "c:ac|rawg:11", 0);
  b.change(moveEntry, "c:ac|rawg:12", 0);
  await settle(a, b);

  assert.deepEqual(members(a, "c:ac"), ["rawg:12", "rawg:10"]);
  assert.deepEqual(members(b, "c:ac"), ["rawg:12", "rawg:10"]);
});

test("undoing a collection's removal brings back its games on every device", async () => {
  const cloud = fakeCloud();
  const a = device(cloud);
  const b = device(cloud);
  a.change(saveCollection, AC, [ref(10), ref(11), ref(12)], []);
  a.change(moveEntry, "c:ac|rawg:12", 0);
  await settle(a, b);

  const removal = a.change(removeEntry, "c:ac");
  await settle(a, b);
  assert.deepEqual(order(b), []);

  a.change(
    restoreEntries,
    removal.queue.map((e) => e.entryId),
  );
  await settle(a, b);
  assert.deepEqual(order(b), ["c:ac"]);
  assert.deepEqual(members(b, "c:ac"), ["rawg:12", "rawg:10", "rawg:11"]);
});

// ---------------------------------------------------------------------------
// Settings → Games sync status (IGDB Stage 7): the pre-update / pre-downgrade check

const igdbRef = (igdbId) => ({
  provider: "igdb",
  igdbId,
  slug: `igdb-${igdbId}`,
  name: `IGDB ${igdbId}`,
  released: "2020-01-01",
  image: null,
});

const stateOf = (storage, overrides = {}) =>
  gameSyncState({
    cloud: true,
    signedIn: true,
    offline: false,
    blocked: false,
    summary: gameSyncSummary(USER, storage),
    ...overrides,
  });

test("sync status: nothing on the device is 'empty', whoever is signed in", () => {
  assert.equal(stateOf(fakeStorage()), "empty");
  assert.equal(stateOf(fakeStorage(), { signedIn: false }), "empty");
  const emptyBlob = JSON.stringify({ v: 1, records: {}, queue: {} });
  assert.equal(stateOf(fakeStorage({ [libraryKey("p1")]: emptyBlob })), "empty");
});

test("sync status says 'synced' exactly when a sign-out wipe would be allowed", () => {
  for (const [entries, expected] of [
    [{ [libraryKey("p1")]: blob(false) }, "synced"],
    [{ [libraryKey("p1")]: blob(true) }, "pending"],
    [{ [libraryKey("p1")]: blob(false), [libraryKey("p2")]: blob(true) }, "pending"],
    [
      {
        [libraryKey("p1")]: blob(false),
        [GAME_QUEUE_KEY]: JSON.stringify([{ owner: { userId: USER, profileId: "p1" } }]),
      },
      "pending",
    ],
    [
      {
        [libraryKey("p1")]: blob(false),
        [GAME_QUEUE_KEY]: JSON.stringify([{ owner: { userId: "someone-else", profileId: "p1" } }]),
      },
      "synced",
    ],
  ]) {
    const storage = fakeStorage(entries);
    assert.equal(stateOf(storage), expected, JSON.stringify(Object.keys(entries)));
    assert.equal(stateOf(storage) === "synced", gamesBackedUp(USER, storage));
  }
  const summary = gameSyncSummary(
    USER,
    fakeStorage({ [libraryKey("p1")]: blob(false), [libraryKey("p2")]: blob(true) }),
  );
  assert.deepEqual(summary.profiles, ["p1", "p2"]);
  assert.deepEqual(summary.unsynced, ["p2"]);
});

test("sync status never calls unsafe data safe", () => {
  const pending = fakeStorage({ [libraryKey("p1")]: blob(true) });
  assert.equal(stateOf(pending, { signedIn: false }), "local-only");
  assert.equal(stateOf(pending, { cloud: false }), "local-only");
  assert.equal(stateOf(pending, { offline: true }), "offline");
  assert.equal(stateOf(pending, { blocked: true }), "blocked");
  // Synced stays synced offline: the cloud already has it.
  assert.equal(
    stateOf(fakeStorage({ [libraryKey("p1")]: blob(false) }), { offline: true }),
    "synced",
  );
  // Signed out with a synced library: still only on this device as far as a wipe goes.
  assert.equal(
    stateOf(fakeStorage({ [libraryKey("p1")]: blob(false) }), { signedIn: false }),
    "local-only",
  );
  const broken = {
    get length() {
      throw new Error("denied");
    },
    key: () => null,
    getItem: () => null,
  };
  assert.equal(gameSyncSummary(USER, broken).unreadable, true);
  assert.equal(stateOf(broken), "unreadable");
});

test("sync status counts held copies: this account's while signed in, any while signed out", () => {
  const held = (userId) => fakeStorage({ [`harbor.cloud.games.held.v1.${userId}.p1`]: blob(true) });
  assert.equal(stateOf(held(USER)), "pending");
  assert.equal(stateOf(held("someone-else")), "empty", "another account's copy isn't ours");
  assert.equal(
    gameSyncState({
      cloud: true,
      signedIn: false,
      offline: false,
      blocked: false,
      summary: gameSyncSummary(null, held("someone-else")),
    }),
    "local-only",
  );
});

test("downgrade drill: once synced, losing the local copy loses nothing, IGDB rows included", async () => {
  const cloud = fakeCloud();
  const storage = fakeStorage();
  const a = device(cloud, { storage });
  a.change(saveGame, ref(1));
  a.change(saveGame, igdbRef(119171));
  a.change(setNotes, "igdb:119171", "keep me");
  assert.equal(stateOf(storage), "pending");
  await a.sync();
  assert.equal(stateOf(storage), "synced");

  // An older Nexa then wipes this device's game data without asking (0.9.28's
  // sign-out does, and pre-IGDB builds drop igdb: rows when they read).
  for (const profileId of libraryProfiles(storage)) storage.removeItem(libraryKey(profileId));

  // Back on this build, or on any other device: everything comes back.
  const back = device(cloud, { storage: fakeStorage() });
  await back.sync();
  assert.deepEqual(Object.keys(back.data.records).sort(), ["igdb:119171", "rawg:1"]);
  assert.equal(back.data.records["igdb:119171"].notes, "keep me");
});
