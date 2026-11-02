// @ts-nocheck -- Node's test modules are not included in the application tsconfig.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { mergeEntry, mergeLibrary, mergeRecord } from "../src/lib/game-library/merge.ts";
import { newRecord } from "../src/lib/game-library/rules.ts";

// The same cases are checked against the SQL trigger in
// supabase/tests/game_library_checks.sql.
const cases = JSON.parse(
  readFileSync(new URL("./fixtures/game-merge-cases.json", import.meta.url), "utf8"),
);

const ref = {
  provider: "rawg",
  rawgId: 1,
  slug: "game",
  name: "Game",
  released: null,
  image: null,
};

const record = (fields = {}) => ({ ...newRecord(ref, 1), ...fields });

const entry = (fields = {}) => ({
  entryId: "g:rawg:1",
  parentId: "",
  kind: "game",
  gameId: "rawg:1",
  franchiseId: null,
  title: "",
  image: null,
  catalogSeen: [],
  position: "U1",
  addedAt: 1,
  updatedAt: 1,
  deletedAt: null,
  liveAt: 1,
  ...fields,
});

const library = (records = [], queue = []) => ({
  records: Object.fromEntries(records.map((r) => [r.gameId, r])),
  queue: Object.fromEntries(queue.map((e) => [e.entryId, e])),
});

for (const c of cases.records) {
  test(`record: ${c.name}`, () => {
    const { merged } = mergeRecord(record(c.incoming), record(c.stored));
    for (const [field, value] of Object.entries(c.expected)) {
      assert.deepEqual(merged[field], value, field);
    }
  });
}

for (const c of cases.queue) {
  test(`queue: ${c.name}`, () => {
    const { merged } = mergeEntry(entry(c.incoming), entry(c.stored));
    for (const [field, value] of Object.entries(c.expected)) {
      assert.deepEqual(merged[field], value, field);
    }
  });
}

test("upload is requested only when this device has something newer", () => {
  const remote = record({ stateAt: 10, notesAt: 10, tierAt: 10 });
  assert.equal(mergeRecord(record({ stateAt: 10, notesAt: 10, tierAt: 10 }), remote).upload, false);
  assert.equal(mergeRecord(record({ stateAt: 5, notesAt: 5, tierAt: 5 }), remote).upload, false);
  assert.equal(mergeRecord(record({ stateAt: 5, notesAt: 11, tierAt: 5 }), remote).upload, true);
});

test("a tie adopts the cloud copy and uploads nothing, so devices can't ping-pong", () => {
  const local = record({ notes: "mine", notesAt: 10 });
  const remote = record({ notes: "theirs", notesAt: 10 });
  const { merged, upload } = mergeRecord(local, remote);
  assert.equal(merged.notes, "theirs");
  assert.equal(upload, false);
  assert.equal(mergeEntry(entry({ position: "a" }), entry({ position: "b" })).merged.position, "b");
});

test("merging is idempotent once both sides agree", () => {
  const local = library([record({ notes: "n", notesAt: 20 })], [entry({ updatedAt: 9 })]);
  const remote = library([record({ status: "playing", stateAt: 30 })], [entry({ updatedAt: 3 })]);
  const first = mergeLibrary(local, remote, 100);
  const second = mergeLibrary(first.data, first.data, 100);
  assert.deepEqual(second.data, first.data);
  assert.deepEqual(second.uploads, { records: [], queue: [] });
  assert.equal(second.changed, false);
});

test("devices converge whichever order they merge in", () => {
  const a = record({ notes: "from A", notesAt: 50, status: "paused", stateAt: 10 });
  const b = record({ notes: "from B", notesAt: 20, status: "playing", stateAt: 40 });
  const onA = mergeRecord(a, b).merged;
  const onB = mergeRecord(b, a).merged;
  assert.equal(onA.notes, onB.notes);
  assert.equal(onA.status, onB.status);
  assert.equal(onA.notes, "from A");
  assert.equal(onA.status, "playing");
});

test("rows only the cloud has are adopted without an upload", () => {
  const result = mergeLibrary(library(), library([record()], [entry()]), 100);
  assert.ok(result.data.records["rawg:1"]);
  assert.ok(result.data.queue["g:rawg:1"]);
  assert.deepEqual(result.uploads, { records: [], queue: [] });
  assert.equal(result.changed, true);
});

test("rows only this device has are kept and uploaded, not dropped", () => {
  const result = mergeLibrary(library([record()], [entry()]), library(), 100);
  assert.ok(result.data.records["rawg:1"]);
  assert.equal(result.uploads.records.length, 1);
  assert.equal(result.uploads.queue.length, 1);
  assert.equal(result.changed, false);
});

test("an identical pull changes nothing, so the store can skip a write", () => {
  const local = library([record()], [entry()]);
  const result = mergeLibrary(local, structuredClone(local), 100);
  assert.equal(result.changed, false);
  assert.deepEqual(result.uploads, { records: [], queue: [] });
});

test("a tombstone reaches a device that still has the row", () => {
  const local = library([], [entry({ liveAt: 1 })]);
  const remote = library([], [entry({ liveAt: 5, deletedAt: 5 })]);
  const result = mergeLibrary(local, remote, 100);
  assert.equal(result.data.queue["g:rawg:1"].deletedAt, 5);
});

test("a later reorder neither revives a removed row nor is lost", () => {
  const local = entry({ position: "V1", updatedAt: 9, liveAt: 1 });
  const remote = entry({ position: "U1", updatedAt: 1, liveAt: 5, deletedAt: 5 });
  const { merged, upload } = mergeEntry(local, remote);
  assert.equal(merged.deletedAt, 5);
  assert.equal(merged.position, "V1");
  assert.equal(upload, true);
});

test("a queue row uploads when either of its stamps is ahead", () => {
  const remote = entry({ updatedAt: 5, liveAt: 5 });
  assert.equal(mergeEntry(entry({ updatedAt: 5, liveAt: 5 }), remote).upload, false);
  assert.equal(mergeEntry(entry({ updatedAt: 6, liveAt: 1 }), remote).upload, true);
  assert.equal(mergeEntry(entry({ updatedAt: 1, liveAt: 6 }), remote).upload, true);
  assert.equal(mergeEntry(entry({ updatedAt: 1, liveAt: 1 }), remote).upload, false);
});

test("a stale snapshot doesn't win, and a newer one uploads", () => {
  const remote = record({ name: "New", metaAt: 20 });
  assert.equal(mergeRecord(record({ name: "Old", metaAt: 10 }), remote).merged.name, "New");
  const newer = mergeRecord(record({ name: "Newest", metaAt: 30 }), remote);
  assert.equal(newer.merged.name, "Newest");
  assert.equal(newer.upload, true);
});

test("an edit made during a pull is not lost", () => {
  // The pull started before this edit, so the cloud copy is older than local.
  const local = library([record({ notes: "typed during pull", notesAt: 200 })]);
  const remote = library([record({ notes: "", notesAt: 100, status: "playing", stateAt: 150 })]);
  const result = mergeLibrary(local, remote, 300);
  assert.equal(result.data.records["rawg:1"].notes, "typed during pull");
  assert.equal(result.data.records["rawg:1"].status, "playing");
  assert.equal(result.uploads.records.length, 1);
});

test("a member added after its collection was removed revives the collection", () => {
  const parent = entry({
    entryId: "c:ac",
    kind: "collection",
    gameId: null,
    franchiseId: "ac",
    liveAt: 50,
    deletedAt: 50,
  });
  const member = entry({
    entryId: "c:ac|rawg:1",
    parentId: "c:ac",
    liveAt: 60,
  });
  const result = mergeLibrary(library([], [member]), library([], [parent]), 100);
  const revived = result.data.queue["c:ac"];
  assert.equal(revived.deletedAt, null);
  assert.ok(revived.liveAt > parent.liveAt);
  assert.ok(result.uploads.queue.some((e) => e.entryId === "c:ac"));
});

test("reordering a member doesn't bring back a removed collection", () => {
  const parent = entry({
    entryId: "c:ac",
    kind: "collection",
    gameId: null,
    liveAt: 50,
    deletedAt: 50,
  });
  const member = entry({ entryId: "c:ac|rawg:1", parentId: "c:ac", updatedAt: 60, liveAt: 40 });
  const result = mergeLibrary(library([], [member]), library([], [parent]), 100);
  assert.equal(result.data.queue["c:ac"].deletedAt, 50);
});

test("a member older than the removal stays hidden with its collection", () => {
  const parent = entry({
    entryId: "c:ac",
    kind: "collection",
    gameId: null,
    liveAt: 50,
    deletedAt: 50,
  });
  const member = entry({ entryId: "c:ac|rawg:1", parentId: "c:ac", liveAt: 40 });
  const result = mergeLibrary(library([], [member]), library([], [parent]), 100);
  assert.equal(result.data.queue["c:ac"].deletedAt, 50);
});

test("createdAt keeps the earliest known time", () => {
  const { merged } = mergeRecord(record({ createdAt: 500 }), record({ createdAt: 100 }));
  assert.equal(merged.createdAt, 100);
  assert.equal(
    mergeRecord(record({ createdAt: 500 }), record({ createdAt: 0 })).merged.createdAt,
    500,
  );
});
