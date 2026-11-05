// @ts-nocheck -- Node's test modules are not included in the application tsconfig.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  addCatalogGames,
  catalogAdditions,
  chainChanges,
  collectionSummary,
  liveCollections,
  moveEntry,
  removeEntry,
  restoreEntries,
  saveCollection,
  saveGame,
  savedCollection,
  wishlistView,
  applyPatch,
} from "../src/lib/game-library/rules.ts";
import { snapshotSummary } from "../src/lib/game-library/snapshot.ts";
import { createGameStore } from "../src/lib/game-library/store-core.ts";
import { emptyLibrary } from "../src/lib/game-library/sanitize.ts";
import { arrange } from "../src/views/game-library/sort-geometry.ts";

const ref = (rawgId, slug = `game-${rawgId}`) => ({
  provider: "rawg",
  rawgId,
  slug,
  name: `Game ${rawgId}`,
  released: "2020-01-01",
  image: null,
});

let now = 1_000;
const ctx = () => ({ now: (now += 10), random: () => 0.5 });

function apply(data, change) {
  return applyPatch(data, change(data, ctx()));
}

const names = (data) =>
  wishlistView(data).map((i) => (i.kind === "game" ? i.record.name : i.entry.title));

const memberNames = (data, id) => collectionSummary(data, id).members.map((m) => m.record.name);

const source = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

// ── catalog changes ─────────────────────────────────────────────────────────

const SAGA = { franchiseId: "saga", title: "Saga", image: null };
const V1 = ["saga-1", "saga-2", "saga-3"];

function savedSaga() {
  let data = emptyLibrary();
  data = apply(data, (d, c) =>
    saveCollection(d, SAGA, [ref(1, "saga-1"), ref(2, "saga-2"), ref(3, "saga-3")], V1, c),
  );
  return data;
}

test("a newer catalog never changes a saved collection's games or order", () => {
  let data = savedSaga();
  data = apply(data, (d, c) => moveEntry(d, "c:saga|rawg:3", 0, c));
  data = apply(data, (d, c) => removeEntry(d, "c:saga|rawg:2", c));
  const before = memberNames(data, "c:saga");

  // The bundled catalog gains a game and reorders its list.
  const v2 = ["saga-3", "saga-4", "saga-1", "saga-2"];
  const entry = savedCollection(data, "saga");
  assert.deepEqual(catalogAdditions(entry, v2), ["saga-4"]);
  assert.deepEqual(memberNames(data, "c:saga"), before);
  assert.deepEqual(before, ["Game 3", "Game 1"]);
});

test("adding the new catalog games appends them and offers them only once", () => {
  let data = savedSaga();
  data = apply(data, (d, c) => moveEntry(d, "c:saga|rawg:3", 0, c));
  const v2 = [...V1, "saga-4", "saga-5"];
  data = apply(data, (d, c) =>
    addCatalogGames(d, "c:saga", [ref(5, "saga-5"), ref(4, "saga-4")], ["saga-5", "saga-4"], c),
  );
  assert.deepEqual(memberNames(data, "c:saga"), ["Game 3", "Game 1", "Game 2", "Game 5", "Game 4"]);
  assert.deepEqual(catalogAdditions(savedCollection(data, "saga"), v2), []);
});

test("a game the user removed stays removed when new catalog games are added", () => {
  let data = savedSaga();
  data = apply(data, (d, c) => removeEntry(d, "c:saga|rawg:2", c));
  data = apply(data, (d, c) => addCatalogGames(d, "c:saga", [ref(4, "saga-4")], ["saga-4"], c));
  assert.deepEqual(memberNames(data, "c:saga"), ["Game 1", "Game 3", "Game 4"]);
});

test("catalog games can't be added to a collection that has been removed", () => {
  let data = savedSaga();
  data = apply(data, (d, c) => removeEntry(d, "c:saga", c));
  const patch = addCatalogGames(data, "c:saga", [ref(4, "saga-4")], ["saga-4"], ctx());
  assert.deepEqual(patch, { records: [], queue: [] });
});

// ── several changes as one ──────────────────────────────────────────────────

test("chained changes stack up in order and send each row once", () => {
  const data = emptyLibrary();
  const patch = chainChanges(data, ctx(), [
    (d, c) => saveGame(d, ref(1), c),
    (d, c) => saveGame(d, ref(2), c),
    (d, c) => moveEntry(d, "g:rawg:2", 0, c),
  ]);
  const ids = patch.queue.map((e) => e.entryId);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(names(applyPatch(data, patch)), ["Game 2", "Game 1"]);
});

test("saved collections are listed in queue order", () => {
  let data = savedSaga();
  data = apply(data, (d, c) => saveGame(d, ref(9), c));
  data = apply(data, (d, c) =>
    saveCollection(d, { franchiseId: "other", title: "Other", image: null }, [ref(7)], [], c),
  );
  data = apply(data, (d, c) => moveEntry(d, "c:other", 0, c));
  assert.deepEqual(
    liveCollections(data).map((e) => e.title),
    ["Other", "Saga"],
  );
  data = apply(data, (d, c) => removeEntry(d, "c:other", c));
  assert.deepEqual(
    liveCollections(data).map((e) => e.title),
    ["Saga"],
  );
  assert.equal(savedCollection(data, "other"), null);
});

test("Undo of a collection restores it and all its games in their order", () => {
  let data = savedSaga();
  data = apply(data, (d, c) => moveEntry(d, "c:saga|rawg:3", 0, c));
  const removal = removeEntry(data, "c:saga", ctx());
  data = applyPatch(data, removal);
  assert.deepEqual(names(data), []);
  const removed = removal.queue.filter((e) => e.deletedAt !== null).map((e) => e.entryId);
  data = apply(data, (d, c) => restoreEntries(d, removed, c));
  assert.deepEqual(names(data), ["Saga"]);
  assert.deepEqual(memberNames(data, "c:saga"), ["Game 3", "Game 1", "Game 2"]);
});

// ── opening details from the library ───────────────────────────────────────

test("a saved game opens details with every field the page reads", () => {
  let data = emptyLibrary();
  data = apply(data, (d, c) => saveGame(d, ref(42), c));
  const summary = snapshotSummary(data.records["rawg:42"]);
  assert.equal(summary.id, "rawg:42");
  assert.equal(summary.name, "Game 42");
  for (const list of ["genres", "platformFamilies", "shortScreenshots"]) {
    assert.ok(Array.isArray(summary[list]), list);
  }
  // game-detail.tsx calls these without checking.
  assert.doesNotThrow(() => summary.genres.slice(0, 3));
  assert.match(source("views/game-discovery/game-detail.tsx"), /game\.genres\.slice/);
});

// ── a full disk ─────────────────────────────────────────────────────────────

function memoryStore({ full = () => false } = {}) {
  const disk = new Map();
  return createGameStore({
    read: (k) => disk.get(k) ?? null,
    write: (k, v) => {
      if (full()) return false;
      disk.set(k, v);
      return true;
    },
    remove: (k) => disk.delete(k),
    now: () => (now += 10),
    random: () => 0.5,
    isPlaceholderProfile: () => false,
  });
}

test("a change the disk refuses is reported, and kept in memory", () => {
  const original = console.warn;
  console.warn = () => {};
  try {
    let full = true;
    const store = memoryStore({ full: () => full });
    let notified = 0;
    store.subscribe(() => notified++);
    store.apply("p1", (d, c) => saveGame(d, ref(1), c));
    assert.equal(store.isUnsaved("p1"), true);
    assert.equal(notified, 1);
    assert.deepEqual(names(store.snapshot("p1")), ["Game 1"]);
    assert.equal(store.isUnsaved("p2"), false);

    full = false;
    store.apply("p1", (d, c) => saveGame(d, ref(2), c));
    assert.equal(store.isUnsaved("p1"), false);
  } finally {
    console.warn = original;
  }
});

test("the Game Library warns when changes aren't saved on this device", () => {
  const shell = source("views/game-library.tsx");
  assert.match(shell, /useGameLibraryUnsaved\(\)/);
  assert.match(shell, /role="alert"/);
});

// ── Undo and profiles ───────────────────────────────────────────────────────

test("Undo only applies to the profile it was offered on", () => {
  assert.match(
    source("lib/game-library/store.ts"),
    /options\.profileId !== undefined && options\.profileId !== activeId\) return null/,
  );
  const actions = source("views/game-library/wishlist-actions.ts");
  assert.match(actions, /const profileId = activeGameProfile\(\);/);
  assert.match(actions, /restoreEntries\(data, removed, ctx\), \{\s*profileId,\s*\}/);
});

// ── dragging ────────────────────────────────────────────────────────────────

// Five 80px rows with 10px gaps.
const ROWS = { tops: [0, 90, 180, 270, 360], heights: [80, 80, 80, 80, 80] };

test("a drag lands where the pointer is", () => {
  const from = 0;
  const start = 40;
  assert.equal(arrange({ ...ROWS, from }, start, 0).target, 0);
  assert.equal(arrange({ ...ROWS, from }, start, 95).target, 1);
  assert.equal(arrange({ ...ROWS, from }, start, 300).target, 3);
  assert.equal(arrange({ ...ROWS, from }, start, 2000).target, 4);
});

test("rows between the old and new place make room, the rest stay put", () => {
  const { target, shifts, offset } = arrange({ ...ROWS, from: 0 }, 40, 200);
  assert.equal(target, 2);
  assert.deepEqual(shifts, [0, -90, -90, 0, 0]);
  assert.equal(offset, 200);
});

test("the dragged row can't be pulled outside its list", () => {
  assert.equal(arrange({ ...ROWS, from: 2 }, 220, -5000).offset, -180);
  assert.equal(arrange({ ...ROWS, from: 2 }, 220, 5000).offset, 180);
});

test("an open collection moves as soon as the pointer passes a row", () => {
  // Row 1 is a 400px open collection, held by its header.
  const geo = { tops: [0, 90, 500, 590], heights: [80, 400, 80, 80], from: 1 };
  assert.equal(arrange(geo, 130, -100).target, 0);
  assert.equal(arrange(geo, 130, 0).target, 1);
});

test("each list sorts only its own rows, so members can't move their collection", () => {
  const hook = source("views/game-library/use-pointer-sort.ts");
  assert.match(hook, /item\.parentElement !== container/);
  assert.match(source("views/game-library/collection-members.tsx"), /usePointerSort\(/);
  assert.match(source("views/game-library/wishlist-list.tsx"), /usePointerSort\(/);
});
