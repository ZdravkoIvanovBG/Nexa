// @ts-nocheck -- Node's test modules are not included in the application tsconfig.
import assert from "node:assert/strict";
import test from "node:test";
import { libraryKey } from "../src/lib/game-library/backup-state.ts";
import {
  moveEntry,
  newRecord,
  saveCollection,
  saveGame,
  setNotes,
  setStatus,
  wishlistView,
} from "../src/lib/game-library/rules.ts";
import { sanitizeEntry, sanitizeRecord } from "../src/lib/game-library/sanitize.ts";
import { createGameStore } from "../src/lib/game-library/store-core.ts";

const ref = (rawgId) => ({
  provider: "rawg",
  rawgId,
  slug: `game-${rawgId}`,
  name: `Game ${rawgId}`,
  released: null,
  image: null,
});

function device({ disk = new Map(), placeholder = () => false } = {}) {
  let now = 1000;
  const deps = {
    read: (key) => disk.get(key) ?? null,
    write: (key, value) => {
      if (deps.full) return false;
      disk.set(key, value);
      return true;
    },
    remove: (key) => disk.delete(key),
    now: () => (now += 10),
    random: Math.random,
    isPlaceholderProfile: placeholder,
    full: false,
  };
  const store = createGameStore(deps);
  const run = (profileId, change, ...args) =>
    store.apply(profileId, (data, ctx) => change(data, ...args, ctx));
  return { disk, deps, store, run };
}

const order = (store, profile) =>
  wishlistView(store.snapshot(profile)).map((i) =>
    i.kind === "game" ? i.record.gameId : i.entry.entryId,
  );

test("the library survives a restart, order and notes included", () => {
  const first = device();
  first.run("p1", saveGame, ref(1));
  first.run("p1", saveGame, ref(2));
  first.run("p1", moveEntry, "g:rawg:2", 0);
  first.run("p1", setNotes, "rawg:1", "Exploring Rome.");

  const restarted = device({ disk: first.disk });
  assert.deepEqual(order(restarted.store, "p1"), ["rawg:2", "rawg:1"]);
  assert.equal(restarted.store.snapshot("p1").records["rawg:1"].notes, "Exploring Rome.");
});

test("collections and their inner order survive a restart", () => {
  const first = device();
  const ac = { franchiseId: "ac", title: "AC", image: null };
  first.run("p1", saveCollection, ac, [ref(10), ref(11), ref(12)], ["s"]);
  first.run("p1", moveEntry, "c:ac|rawg:12", 0);

  const restarted = device({ disk: first.disk });
  const [item] = wishlistView(restarted.store.snapshot("p1"));
  assert.deepEqual(
    item.members.map((m) => m.record.gameId),
    ["rawg:12", "rawg:10", "rawg:11"],
  );
  assert.deepEqual(item.entry.catalogSeen, ["s"]);
});

test("profiles never share a library", () => {
  const { store, run, disk } = device();
  run("p1", saveGame, ref(1));
  run("p2", saveGame, ref(2));
  run("p1", setNotes, "rawg:1", "p1 only");

  assert.deepEqual(order(store, "p1"), ["rawg:1"]);
  assert.deepEqual(order(store, "p2"), ["rawg:2"]);
  assert.equal(store.snapshot("p2").records["rawg:1"], undefined);
  assert.ok(disk.has(libraryKey("p1")) && disk.has(libraryKey("p2")));
  assert.doesNotMatch(disk.get(libraryKey("p2")), /p1 only/);
});

test("a change returns exactly the rows it touched", () => {
  const { run } = device();
  const patch = run("p1", saveGame, ref(1));
  assert.deepEqual(
    patch.records.map((r) => r.gameId),
    ["rawg:1"],
  );
  assert.deepEqual(
    patch.queue.map((e) => e.entryId),
    ["g:rawg:1"],
  );
});

test("a no-op change writes nothing and doesn't wake subscribers", () => {
  const { store, run, disk } = device();
  run("p1", saveGame, ref(1));
  const before = disk.get(libraryKey("p1"));
  let wakes = 0;
  store.subscribe(() => wakes++);
  run("p1", saveGame, ref(1));
  assert.equal(wakes, 0);
  assert.equal(disk.get(libraryKey("p1")), before);
});

test("snapshots are stable until something changes, for useSyncExternalStore", () => {
  const { store, run } = device();
  run("p1", saveGame, ref(1));
  const first = store.snapshot("p1");
  assert.equal(store.snapshot("p1"), first);
  run("p1", saveGame, ref(2));
  assert.notEqual(store.snapshot("p1"), first);
});

test("unsubscribing stops notifications", () => {
  const { store, run } = device();
  let wakes = 0;
  const stop = store.subscribe(() => wakes++);
  run("p1", saveGame, ref(1));
  stop();
  run("p1", saveGame, ref(2));
  assert.equal(wakes, 1);
});

test("a full disk keeps the change in memory", () => {
  const { store, run, deps } = device();
  deps.full = true;
  run("p1", saveGame, ref(1));
  assert.deepEqual(order(store, "p1"), ["rawg:1"]);
});

test("a corrupt blob starts empty instead of crashing", () => {
  const disk = new Map([[libraryKey("p1"), "{not json"]]);
  assert.deepEqual(order(device({ disk }).store, "p1"), []);
});

test("forgetting a profile removes its blob and memory", () => {
  const { store, run, disk } = device();
  run("p1", saveGame, ref(1));
  store.forget("p1");
  assert.equal(disk.has(libraryKey("p1")), false);
  assert.deepEqual(order(store, "p1"), []);
});

test("merge reads local state at apply time, so an in-flight edit is kept", () => {
  const { store, run } = device();
  run("p1", saveGame, ref(1));
  // The pull was taken before this edit.
  const pulled = structuredClone(store.snapshot("p1"));
  run("p1", setNotes, "rawg:1", "typed while the pull was in flight");
  const uploads = store.merge("p1", pulled);
  assert.equal(store.snapshot("p1").records["rawg:1"].notes, "typed while the pull was in flight");
  assert.equal(uploads.records.length, 1);
});

test("a merge that changes nothing doesn't rewrite the blob", () => {
  const { store, run, deps } = device();
  run("p1", saveGame, ref(1));
  let writes = 0;
  const write = deps.write;
  deps.write = (...args) => (writes++, write(...args));
  store.merge("p1", structuredClone(store.snapshot("p1")));
  assert.equal(writes, 0);
});

test("a change marks the library unsynced in the same write that saves it", () => {
  const { store, run, disk } = device();
  assert.equal(store.isUnsynced("p1"), false);
  run("p1", saveGame, ref(1));
  assert.equal(store.isUnsynced("p1"), true);
  assert.equal(JSON.parse(disk.get(libraryKey("p1"))).unsynced, true);
  assert.equal(device({ disk }).store.isUnsynced("p1"), true, "and a restart still knows");
});

test("a change that writes nothing doesn't mark the library unsynced", () => {
  const { store, run } = device();
  run("p1", saveGame, ref(1));
  store.markSynced("p1");
  run("p1", saveGame, ref(1));
  assert.equal(store.isUnsynced("p1"), false);
});

test("marking a library synced is saved, and the next change marks it unsynced again", () => {
  const { store, run, disk } = device();
  run("p1", saveGame, ref(1));
  store.markSynced("p1");
  assert.equal(device({ disk }).store.isUnsynced("p1"), false);
  run("p1", setNotes, "rawg:1", "again");
  assert.equal(store.isUnsynced("p1"), true);
});

test("adopting rows from the cloud doesn't count as an unsynced change", () => {
  const { store, run } = device();
  run("p1", saveGame, ref(1));
  const pulled = structuredClone(store.snapshot("p1"));
  const other = device();
  other.store.merge("p1", pulled);
  assert.equal(other.store.isUnsynced("p1"), false);
  assert.ok(other.store.snapshot("p1").records["rawg:1"]);
});

test("a merge that leaves rows to upload marks the library unsynced", () => {
  const { store, run } = device();
  run("p1", saveGame, ref(1));
  store.markSynced("p1");
  const uploads = store.merge("p1", { records: {}, queue: {} });
  assert.equal(uploads.records.length, 1);
  assert.equal(store.isUnsynced("p1"), true);
});

test("a merge never clears unsynced on its own", () => {
  const { store, run } = device();
  run("p1", saveGame, ref(1));
  store.merge("p1", structuredClone(store.snapshot("p1")));
  assert.equal(store.isUnsynced("p1"), true);
});

test("a replaced placeholder profile's games move across and upload", () => {
  const placeholder = (id) => id === "temp";
  const { store, run, disk } = device({ placeholder });
  run("temp", saveGame, ref(1));
  run("real", saveGame, ref(2));
  assert.equal(store.isPlaceholderBlob("temp"), true);
  assert.equal(store.isPlaceholderBlob("real"), false);

  const uploads = store.adopt("temp", "real");
  assert.deepEqual(order(store, "real").sort(), ["rawg:1", "rawg:2"]);
  assert.ok(uploads.records.some((r) => r.gameId === "rawg:1"));
  assert.equal(disk.has(libraryKey("temp")), false);
});

test("the placeholder flag survives a restart", () => {
  const first = device({ placeholder: () => true });
  first.run("temp", saveGame, ref(1));
  const restarted = device({ disk: first.disk, placeholder: () => false });
  assert.equal(restarted.store.isPlaceholderBlob("temp"), true);
});

// ── sanitizing ──────────────────────────────────────────────────────────────

test("a valid record passes through unchanged", () => {
  const record = { ...newRecord(ref(1), 5), status: "playing", notes: "x", tier: "A" };
  record.tierPosition = "U1";
  assert.deepEqual(sanitizeRecord(record), record);
});

test("records without a valid game id are rejected", () => {
  assert.equal(sanitizeRecord(null), null);
  assert.equal(sanitizeRecord({ gameId: "steam:1" }), null);
  assert.equal(sanitizeRecord({ gameId: "rawg:0" }), null);
  assert.equal(sanitizeRecord({ gameId: "rawg:abc" }), null);
});

test("bad field values fall back to safe ones", () => {
  const record = sanitizeRecord({
    gameId: "rawg:1",
    status: "winning",
    tier: "Z",
    tierPosition: "U1",
    progress: 900,
    stateAt: -5,
    notesAt: "not a number",
    notes: 42,
    progressEnabled: "yes",
  });
  assert.equal(record.status, null);
  assert.equal(record.tier, null);
  assert.equal(record.tierPosition, null);
  assert.equal(record.progress, 100);
  assert.equal(record.stateAt, 0);
  assert.equal(record.notesAt, 0);
  assert.equal(record.notes, "");
  assert.equal(record.progressEnabled, false);
  assert.equal(record.rawgId, 1);
});

test("a Postgres bigint delivered as a string keeps its value", () => {
  assert.equal(
    sanitizeRecord({ gameId: "rawg:1", stateAt: "1730000000000" }).stateAt,
    1730000000000,
  );
});

test("queue rows need a kind, and game rows need a game", () => {
  const entry = { entryId: "g:rawg:1", kind: "game", gameId: "rawg:1", position: "U1" };
  assert.equal(sanitizeEntry(entry).gameId, "rawg:1");
  assert.equal(sanitizeEntry({ ...entry, kind: "movie" }), null);
  assert.equal(sanitizeEntry({ ...entry, gameId: null }), null);
  assert.equal(sanitizeEntry({ ...entry, entryId: "" }), null);
  assert.equal(
    sanitizeEntry({ entryId: "c:ac", kind: "collection", gameId: null, position: "U1" }).kind,
    "collection",
  );
  assert.deepEqual(sanitizeEntry({ ...entry, catalogSeen: ["a", 1] }).catalogSeen, ["a"]);
});
