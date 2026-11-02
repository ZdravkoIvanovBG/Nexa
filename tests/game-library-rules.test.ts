// @ts-nocheck -- Node's test modules are not included in the application tsconfig.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  addMember,
  addToBoard,
  applyPatch,
  backToWishlist,
  boardTier,
  catalogAdditions,
  clearStatus,
  collectionSummary,
  gameStage,
  isEmptyPatch,
  markCatalogSeen,
  moveEntry,
  moveToTier,
  moveToTop,
  notesPreview,
  placementsOf,
  playNext,
  playingView,
  refreshSnapshot,
  removeEntry,
  removeFromBoard,
  restoreEntries,
  saveCollection,
  saveGame,
  setNotes,
  setProgress,
  setProgressEnabled,
  setStatus,
  shiftEntry,
  startGame,
  tierBoard,
  wishlistView,
} from "../src/lib/game-library/rules.ts";
import { MAX_NOTES_LENGTH } from "../src/lib/game-library/types.ts";

const ref = (rawgId, name = `Game ${rawgId}`) => ({
  provider: "rawg",
  rawgId,
  slug: `game-${rawgId}`,
  name,
  released: "2010-01-01",
  image: `https://media.rawg.io/${rawgId}.jpg`,
});

const AC = { franchiseId: "ac", title: "Assassin's Creed Collection", image: null };

/** Applies changes in sequence with a clock that always moves forward. */
function library() {
  let now = 1000;
  let data = { records: {}, queue: {} };
  const ctx = () => ({ now: (now += 10) });
  return {
    get data() {
      return data;
    },
    run(change, ...args) {
      const patch = change(data, ...args, ctx());
      data = applyPatch(data, patch);
      return patch;
    },
  };
}

const order = (lib) =>
  wishlistView(lib.data).map((i) => (i.kind === "game" ? i.record.gameId : i.entry.entryId));

const memberOrder = (lib, id) =>
  collectionSummary(lib.data, id).members.map((m) => m.record.gameId);

function seededQueue(lib, ...ids) {
  for (const id of ids) lib.run(saveGame, ref(id));
}

test("saving a game adds one record and one row at the end of the queue", () => {
  const lib = library();
  seededQueue(lib, 1, 2);
  assert.deepEqual(order(lib), ["rawg:1", "rawg:2"]);
  assert.equal(wishlistView(lib.data)[1].rank, 2);
});

test("saving a game twice writes nothing", () => {
  const lib = library();
  seededQueue(lib, 1);
  assert.ok(isEmptyPatch(lib.run(saveGame, ref(1))));
});

test("a move writes only the moved row", () => {
  const lib = library();
  seededQueue(lib, 1, 2, 3, 4);
  const patch = lib.run(moveEntry, "g:rawg:4", 1);
  assert.equal(patch.queue.length, 1);
  assert.deepEqual(order(lib), ["rawg:1", "rawg:4", "rawg:2", "rawg:3"]);
});

test("dropping an entry where it already is writes nothing", () => {
  const lib = library();
  seededQueue(lib, 1, 2, 3);
  assert.ok(isEmptyPatch(lib.run(moveEntry, "g:rawg:2", 1)));
});

test("moving down past a neighbour lands after it", () => {
  const lib = library();
  seededQueue(lib, 1, 2, 3, 4);
  lib.run(moveEntry, "g:rawg:1", 2);
  assert.deepEqual(order(lib), ["rawg:2", "rawg:3", "rawg:1", "rawg:4"]);
});

test("move up and down step one place and stop at the ends", () => {
  const lib = library();
  seededQueue(lib, 1, 2, 3);
  lib.run(shiftEntry, "g:rawg:3", -1);
  assert.deepEqual(order(lib), ["rawg:1", "rawg:3", "rawg:2"]);
  lib.run(shiftEntry, "g:rawg:3", 1);
  assert.deepEqual(order(lib), ["rawg:1", "rawg:2", "rawg:3"]);
  assert.ok(isEmptyPatch(lib.run(shiftEntry, "g:rawg:3", 1)));
  assert.ok(isEmptyPatch(lib.run(shiftEntry, "g:rawg:1", -1)));
});

test("move to top takes first place, play next goes right behind it", () => {
  const lib = library();
  seededQueue(lib, 1, 2, 3, 4);
  lib.run(playNext, "g:rawg:4");
  assert.deepEqual(order(lib), ["rawg:1", "rawg:4", "rawg:2", "rawg:3"]);
  lib.run(moveToTop, "g:rawg:3");
  assert.deepEqual(order(lib), ["rawg:3", "rawg:1", "rawg:4", "rawg:2"]);
});

test("positions are relative to what the user can see", () => {
  const lib = library();
  seededQueue(lib, 1, 2, 3);
  lib.run(setStatus, "rawg:1", "playing");
  lib.run(startGame, ref(2));
  assert.deepEqual(order(lib), ["rawg:3"]);
  seededQueue(lib, 4);
  lib.run(moveEntry, "g:rawg:4", 0);
  assert.deepEqual(order(lib), ["rawg:4", "rawg:3"]);
});

test("removing and undoing brings the row back in the same place", () => {
  const lib = library();
  seededQueue(lib, 1, 2, 3);
  lib.run(removeEntry, "g:rawg:2");
  assert.deepEqual(order(lib), ["rawg:1", "rawg:3"]);
  lib.run(restoreEntries, ["g:rawg:2"]);
  assert.deepEqual(order(lib), ["rawg:1", "rawg:2", "rawg:3"]);
});

test("undo is a forward write, so it beats the tombstone everywhere", () => {
  const lib = library();
  seededQueue(lib, 1);
  const removed = lib.run(removeEntry, "g:rawg:1").queue[0];
  const restored = lib.run(restoreEntries, ["g:rawg:1"]).queue[0];
  assert.ok(restored.updatedAt > removed.updatedAt);
  assert.equal(restored.deletedAt, null);
});

test("saving a removed game revives its row at the end", () => {
  const lib = library();
  seededQueue(lib, 1, 2);
  lib.run(removeEntry, "g:rawg:1");
  const patch = lib.run(saveGame, ref(1));
  assert.equal(patch.records.length, 0);
  assert.deepEqual(order(lib), ["rawg:2", "rawg:1"]);
});

test("removing a row keeps the personal record", () => {
  const lib = library();
  seededQueue(lib, 1);
  lib.run(setNotes, "rawg:1", "Sequence 4");
  lib.run(removeEntry, "g:rawg:1");
  lib.run(saveGame, ref(1));
  assert.equal(lib.data.records["rawg:1"].notes, "Sequence 4");
});

// ── collections ─────────────────────────────────────────────────────────────

test("a saved collection is one queue entry beside standalone games", () => {
  const lib = library();
  seededQueue(lib, 1);
  lib.run(saveCollection, AC, [ref(10), ref(11)], ["a", "b"]);
  seededQueue(lib, 2);
  assert.deepEqual(order(lib), ["rawg:1", "c:ac", "rawg:2"]);
  assert.deepEqual(memberOrder(lib, "c:ac"), ["rawg:10", "rawg:11"]);
});

test("the two orderings are independent", () => {
  const lib = library();
  seededQueue(lib, 1);
  lib.run(saveCollection, AC, [ref(10), ref(11), ref(12)], []);
  seededQueue(lib, 2);

  lib.run(moveEntry, "c:ac|rawg:12", 0);
  assert.deepEqual(memberOrder(lib, "c:ac"), ["rawg:12", "rawg:10", "rawg:11"]);
  assert.deepEqual(order(lib), ["rawg:1", "c:ac", "rawg:2"]);

  lib.run(moveEntry, "c:ac", 0);
  assert.deepEqual(order(lib), ["c:ac", "rawg:1", "rawg:2"]);
  assert.deepEqual(memberOrder(lib, "c:ac"), ["rawg:12", "rawg:10", "rawg:11"]);
});

test("duplicate catalog games collapse to one member", () => {
  const lib = library();
  lib.run(saveCollection, AC, [ref(10), ref(10), ref(11)], []);
  assert.deepEqual(memberOrder(lib, "c:ac"), ["rawg:10", "rawg:11"]);
});

test("saving a collection that is already saved writes nothing", () => {
  const lib = library();
  lib.run(saveCollection, AC, [ref(10)], []);
  assert.ok(isEmptyPatch(lib.run(saveCollection, AC, [ref(10), ref(11)], [])));
  assert.deepEqual(memberOrder(lib, "c:ac"), ["rawg:10"]);
});

test("a game can be standalone and in a collection, sharing one record", () => {
  const lib = library();
  seededQueue(lib, 10);
  lib.run(saveCollection, AC, [ref(10), ref(11)], []);
  assert.equal(Object.keys(lib.data.records).length, 2);
  assert.deepEqual(order(lib), ["rawg:10", "c:ac"]);
  lib.run(setNotes, "rawg:10", "Exploring Rome.");
  const member = collectionSummary(lib.data, "c:ac").members[0];
  assert.equal(member.record.notes, "Exploring Rome.");
  const placed = placementsOf(lib.data, "rawg:10");
  assert.equal(placed.standalone, true);
  assert.equal(placed.collections[0].entryId, "c:ac");
});

test("removing a member leaves the rest and undo restores it in place", () => {
  const lib = library();
  lib.run(saveCollection, AC, [ref(10), ref(11), ref(12)], []);
  lib.run(removeEntry, "c:ac|rawg:11");
  assert.deepEqual(memberOrder(lib, "c:ac"), ["rawg:10", "rawg:12"]);
  lib.run(restoreEntries, ["c:ac|rawg:11"]);
  assert.deepEqual(memberOrder(lib, "c:ac"), ["rawg:10", "rawg:11", "rawg:12"]);
});

test("removing a collection tombstones every live member with it", () => {
  const lib = library();
  lib.run(saveCollection, AC, [ref(10), ref(11)], []);
  const patch = lib.run(removeEntry, "c:ac");
  assert.equal(patch.queue.length, 3);
  assert.ok(patch.queue.every((e) => e.deletedAt !== null));
  assert.deepEqual(order(lib), []);
  assert.equal(gameStage(lib.data, "rawg:10"), "none");
});

test("undo restores exactly the removed set, not members removed earlier", () => {
  const lib = library();
  lib.run(saveCollection, AC, [ref(10), ref(11), ref(12)], []);
  lib.run(moveEntry, "c:ac|rawg:12", 0);
  lib.run(removeEntry, "c:ac|rawg:11");
  const removed = lib.run(removeEntry, "c:ac").queue.map((e) => e.entryId);
  lib.run(restoreEntries, removed);
  assert.deepEqual(memberOrder(lib, "c:ac"), ["rawg:12", "rawg:10"]);
});

test("saving a removed collection starts fresh from the catalog", () => {
  const lib = library();
  lib.run(saveCollection, AC, [ref(10), ref(11), ref(12)], []);
  lib.run(moveEntry, "c:ac|rawg:12", 0);
  lib.run(removeEntry, "c:ac");
  lib.run(saveCollection, AC, [ref(10), ref(11)], ["x"]);
  assert.deepEqual(memberOrder(lib, "c:ac"), ["rawg:10", "rawg:11"]);
  assert.deepEqual(lib.data.queue["c:ac"].catalogSeen, ["x"]);
});

test("saving again clears a stale live member left under a removed collection", () => {
  const lib = library();
  lib.run(saveCollection, AC, [ref(10), ref(11)], []);
  lib.run(removeEntry, "c:ac");
  // Another device's member, still live under the removed parent.
  const stale = { ...lib.data.queue["c:ac|rawg:11"], deletedAt: null };
  lib.run(() => ({ records: [], queue: [stale] }));
  lib.run(saveCollection, AC, [ref(10)], []);
  assert.deepEqual(memberOrder(lib, "c:ac"), ["rawg:10"]);
});

test("adding a game to a collection appends it, once", () => {
  const lib = library();
  lib.run(saveCollection, AC, [ref(10)], []);
  lib.run(addMember, "c:ac", ref(11));
  assert.deepEqual(memberOrder(lib, "c:ac"), ["rawg:10", "rawg:11"]);
  assert.ok(isEmptyPatch(lib.run(addMember, "c:ac", ref(11))));
  assert.ok(isEmptyPatch(lib.run(addMember, "c:missing", ref(12))));
});

test("a catalog change never alters a customized collection", () => {
  const lib = library();
  lib.run(saveCollection, AC, [ref(10), ref(11), ref(12)], ["a", "b", "c"]);
  lib.run(moveEntry, "c:ac|rawg:12", 0);
  lib.run(removeEntry, "c:ac|rawg:11");
  const before = memberOrder(lib, "c:ac");

  const entry = lib.data.queue["c:ac"];
  assert.deepEqual(catalogAdditions(entry, ["a", "b", "c", "d"]), ["d"]);
  assert.deepEqual(catalogAdditions(entry, ["a", "c"]), []);
  assert.deepEqual(memberOrder(lib, "c:ac"), before);
});

test("reviewing a catalog addition only records it as seen", () => {
  const lib = library();
  lib.run(saveCollection, AC, [ref(10)], ["a"]);
  lib.run(markCatalogSeen, "c:ac", ["a", "d"]);
  assert.deepEqual(catalogAdditions(lib.data.queue["c:ac"], ["a", "d"]), []);
  assert.ok(isEmptyPatch(lib.run(markCatalogSeen, "c:ac", ["a", "d"])));
  assert.deepEqual(memberOrder(lib, "c:ac"), ["rawg:10"]);
});

test("next up skips started games and completion is counted", () => {
  const lib = library();
  lib.run(saveCollection, AC, [ref(10), ref(11), ref(12)], []);
  lib.run(setStatus, "rawg:10", "completed");
  lib.run(setStatus, "rawg:11", "playing");
  const summary = collectionSummary(lib.data, "c:ac");
  assert.equal(summary.completed, 1);
  assert.equal(summary.nextUp.gameId, "rawg:12");
});

test("collection members stay in the collection whatever their status", () => {
  const lib = library();
  lib.run(saveCollection, AC, [ref(10), ref(11)], []);
  lib.run(setStatus, "rawg:10", "playing");
  assert.deepEqual(memberOrder(lib, "c:ac"), ["rawg:10", "rawg:11"]);
});

// ── stages ──────────────────────────────────────────────────────────────────

test("a game's stage follows its status first, then its placement", () => {
  const lib = library();
  assert.equal(gameStage(lib.data, "rawg:1"), "none");
  seededQueue(lib, 1);
  assert.equal(gameStage(lib.data, "rawg:1"), "wishlist");
  lib.run(setStatus, "rawg:1", "playing");
  assert.equal(gameStage(lib.data, "rawg:1"), "playing");
  lib.run(saveCollection, AC, [ref(2)], []);
  assert.equal(gameStage(lib.data, "rawg:2"), "collection");
});

test("starting a game hides its row, and going back restores its place", () => {
  const lib = library();
  seededQueue(lib, 1, 2, 3);
  const patch = lib.run(setStatus, "rawg:2", "playing");
  assert.equal(patch.queue.length, 0);
  assert.deepEqual(order(lib), ["rawg:1", "rawg:3"]);
  lib.run(backToWishlist, "rawg:2");
  assert.deepEqual(order(lib), ["rawg:1", "rawg:2", "rawg:3"]);
});

test("a game started directly can be sent to the Wishlist", () => {
  const lib = library();
  seededQueue(lib, 1);
  lib.run(startGame, ref(2));
  assert.equal(lib.data.queue["g:rawg:2"], undefined);
  lib.run(backToWishlist, "rawg:2");
  assert.deepEqual(order(lib), ["rawg:1", "rawg:2"]);
});

test("back to Wishlist adds no duplicate for a collection member", () => {
  const lib = library();
  lib.run(saveCollection, AC, [ref(10)], []);
  lib.run(setStatus, "rawg:10", "playing");
  lib.run(backToWishlist, "rawg:10");
  assert.equal(lib.data.queue["g:rawg:10"], undefined);
  assert.equal(gameStage(lib.data, "rawg:10"), "collection");
});

test("leaving Currently Playing keeps the record but no placement", () => {
  const lib = library();
  lib.run(startGame, ref(1));
  lib.run(setNotes, "rawg:1", "Stopped before the final boss.");
  lib.run(clearStatus, "rawg:1");
  assert.equal(gameStage(lib.data, "rawg:1"), "none");
  assert.equal(lib.data.records["rawg:1"].notes, "Stopped before the final boss.");
});

test("every status change preserves notes, progress and the tier group", () => {
  const lib = library();
  lib.run(startGame, ref(1));
  lib.run(setNotes, "rawg:1", "Currently on Sequence 4.");
  lib.run(setProgressEnabled, "rawg:1", true);
  lib.run(setProgress, "rawg:1", 35);
  lib.run(moveToTier, "rawg:1", "A", 0);
  const before = lib.data.records["rawg:1"];

  const steps = [
    () => lib.run(setStatus, "rawg:1", "paused"),
    () => lib.run(setStatus, "rawg:1", "dropped"),
    () => lib.run(setStatus, "rawg:1", "completed"),
    () => lib.run(setStatus, "rawg:1", "playing"),
    () => lib.run(clearStatus, "rawg:1"),
    () => lib.run(backToWishlist, "rawg:1"),
  ];
  for (const step of steps) {
    step();
    const after = lib.data.records["rawg:1"];
    assert.equal(after.notes, before.notes);
    assert.equal(after.notesAt, before.notesAt);
    assert.equal(after.progress, 35);
    assert.equal(after.progressEnabled, true);
    assert.equal(after.tier, "A");
    assert.equal(after.tierPosition, before.tierPosition);
    assert.equal(after.tierAt, before.tierAt);
  }
});

test("startedAt keeps the first start and completedAt survives playing again", () => {
  const lib = library();
  lib.run(startGame, ref(1));
  const started = lib.data.records["rawg:1"].startedAt;
  lib.run(setStatus, "rawg:1", "completed");
  const completed = lib.data.records["rawg:1"].completedAt;
  lib.run(setStatus, "rawg:1", "playing");
  assert.equal(lib.data.records["rawg:1"].startedAt, started);
  assert.equal(lib.data.records["rawg:1"].completedAt, completed);
});

test("setting the same status again writes nothing", () => {
  const lib = library();
  lib.run(startGame, ref(1));
  assert.ok(isEmptyPatch(lib.run(setStatus, "rawg:1", "playing")));
  assert.ok(isEmptyPatch(lib.run(setStatus, "rawg:9", "playing")));
});

test("each edit advances only its own group's stamp", () => {
  const lib = library();
  lib.run(startGame, ref(1));
  const a = lib.data.records["rawg:1"];
  lib.run(setNotes, "rawg:1", "note");
  const b = lib.data.records["rawg:1"];
  assert.ok(b.notesAt > a.notesAt);
  assert.equal(b.stateAt, a.stateAt);
  assert.equal(b.tierAt, a.tierAt);
  lib.run(setStatus, "rawg:1", "paused");
  const c = lib.data.records["rawg:1"];
  assert.ok(c.stateAt > b.stateAt);
  assert.equal(c.notesAt, b.notesAt);
});

test("stamps beat a stamp from a device whose clock runs ahead", () => {
  const lib = library();
  lib.run(startGame, ref(1));
  const ahead = { ...lib.data.records["rawg:1"], stateAt: 9_000_000 };
  lib.run(() => ({ records: [ahead], queue: [] }));
  lib.run(setStatus, "rawg:1", "paused");
  assert.equal(lib.data.records["rawg:1"].stateAt, 9_000_001);
});

test("progress is optional, clamped, and survives being switched off", () => {
  const lib = library();
  lib.run(startGame, ref(1));
  assert.equal(lib.data.records["rawg:1"].progress, null);
  lib.run(setProgress, "rawg:1", 134.6);
  assert.equal(lib.data.records["rawg:1"].progress, 100);
  lib.run(setProgress, "rawg:1", -3);
  assert.equal(lib.data.records["rawg:1"].progress, 0);
  lib.run(setProgress, "rawg:1", 35.4);
  assert.equal(lib.data.records["rawg:1"].progress, 35);
  assert.ok(isEmptyPatch(lib.run(setProgress, "rawg:1", Number.NaN)));
  lib.run(setProgressEnabled, "rawg:1", true);
  lib.run(setProgressEnabled, "rawg:1", false);
  assert.equal(lib.data.records["rawg:1"].progress, 35);
});

test("notes are capped, unchanged notes write nothing, and previews skip blank lines", () => {
  const lib = library();
  lib.run(startGame, ref(1));
  lib.run(setNotes, "rawg:1", "x".repeat(MAX_NOTES_LENGTH + 50));
  assert.equal(lib.data.records["rawg:1"].notes.length, MAX_NOTES_LENGTH);
  lib.run(setNotes, "rawg:1", "same");
  assert.ok(isEmptyPatch(lib.run(setNotes, "rawg:1", "same")));
  assert.equal(
    notesPreview("\n  \n  Next objective: side missions\nMore"),
    "Next objective: side missions",
  );
  assert.equal(notesPreview("   "), "");
});

test("Currently Playing is grouped by status and doesn't reorder on edit", () => {
  const lib = library();
  lib.run(startGame, ref(1));
  lib.run(startGame, ref(2));
  lib.run(setNotes, "rawg:1", "edited after 2 started");
  assert.deepEqual(
    playingView(lib.data).playing.map((r) => r.gameId),
    ["rawg:2", "rawg:1"],
  );
  lib.run(setStatus, "rawg:1", "dropped");
  const view = playingView(lib.data);
  assert.equal(view.playing.length, 1);
  assert.equal(view.dropped[0].gameId, "rawg:1");
});

test("a snapshot refresh updates identity only and keeps a known image", () => {
  const lib = library();
  seededQueue(lib, 1);
  const before = lib.data.records["rawg:1"];
  lib.run(refreshSnapshot, { ...ref(1, "Renamed"), image: null });
  const after = lib.data.records["rawg:1"];
  assert.equal(after.name, "Renamed");
  assert.equal(after.image, before.image);
  assert.equal(after.stateAt, before.stateAt);
  assert.ok(isEmptyPatch(refreshSnapshot(lib.data, { ...ref(1, "Renamed"), image: after.image })));
  assert.ok(isEmptyPatch(refreshSnapshot(lib.data, ref(99))));
});

// ── tier list ───────────────────────────────────────────────────────────────

const tierIds = (lib, tier) => tierBoard(lib.data)[tier].map((t) => t.record.gameId);

test("completing a game assigns no rank and writes no tier data", () => {
  const lib = library();
  lib.run(startGame, ref(1));
  const before = lib.data.records["rawg:1"];
  const patch = lib.run(setStatus, "rawg:1", "completed");
  assert.equal(patch.records[0].tier, null);
  assert.equal(patch.records[0].tierAt, before.tierAt);
  assert.deepEqual(tierIds(lib, "unranked"), ["rawg:1"]);
  for (const tier of ["S", "A", "B", "C", "D", "F"]) assert.deepEqual(tierIds(lib, tier), []);
});

test("a game leaves Unranked if it stops being completed", () => {
  const lib = library();
  lib.run(startGame, ref(1));
  lib.run(setStatus, "rawg:1", "completed");
  lib.run(setStatus, "rawg:1", "playing");
  assert.equal(boardTier(lib.data.records["rawg:1"]), null);
  assert.deepEqual(tierIds(lib, "unranked"), []);
});

test("a rank stays when a completed game is played again", () => {
  const lib = library();
  lib.run(startGame, ref(1));
  lib.run(setStatus, "rawg:1", "completed");
  lib.run(moveToTier, "rawg:1", "S", 0);
  lib.run(setStatus, "rawg:1", "playing");
  assert.deepEqual(tierIds(lib, "S"), ["rawg:1"]);
  assert.equal(tierBoard(lib.data).S[0].notCompleted, true);
});

test("moving within a tier writes one row and lands at the requested index", () => {
  const lib = library();
  for (const id of [1, 2, 3, 4]) {
    lib.run(startGame, ref(id));
    lib.run(moveToTier, `rawg:${id}`, "A", 99);
  }
  const patch = lib.run(moveToTier, "rawg:1", "A", 2);
  assert.equal(patch.records.length, 1);
  assert.deepEqual(tierIds(lib, "A"), ["rawg:2", "rawg:3", "rawg:1", "rawg:4"]);
});

test("moving between tiers leaves both tiers ordered", () => {
  const lib = library();
  for (const id of [1, 2]) {
    lib.run(startGame, ref(id));
    lib.run(moveToTier, `rawg:${id}`, "A", 99);
  }
  lib.run(startGame, ref(3));
  lib.run(moveToTier, "rawg:3", "S", 0);
  lib.run(moveToTier, "rawg:1", "S", 0);
  assert.deepEqual(tierIds(lib, "S"), ["rawg:1", "rawg:3"]);
  assert.deepEqual(tierIds(lib, "A"), ["rawg:2"]);
});

test("dropping a tile where it already is writes nothing", () => {
  const lib = library();
  lib.run(startGame, ref(1));
  lib.run(moveToTier, "rawg:1", "A", 0);
  assert.ok(isEmptyPatch(lib.run(moveToTier, "rawg:1", "A", 0)));
});

test("removing from the board sticks, and adding back is deliberate", () => {
  const lib = library();
  lib.run(startGame, ref(1));
  lib.run(setStatus, "rawg:1", "completed");
  lib.run(removeFromBoard, "rawg:1");
  assert.deepEqual(tierIds(lib, "unranked"), []);
  lib.run(setStatus, "rawg:1", "playing");
  lib.run(setStatus, "rawg:1", "completed");
  assert.deepEqual(tierIds(lib, "unranked"), []);
  lib.run(addToBoard, "rawg:1");
  assert.deepEqual(tierIds(lib, "unranked"), ["rawg:1"]);
});

test("an unfinished game can be ranked deliberately and is marked as such", () => {
  const lib = library();
  seededQueue(lib, 1);
  lib.run(addToBoard, "rawg:1");
  const [tile] = tierBoard(lib.data).unranked;
  assert.equal(tile.notCompleted, true);
  assert.ok(isEmptyPatch(lib.run(addToBoard, "rawg:1")));
  assert.equal(gameStage(lib.data, "rawg:1"), "wishlist");
});

test("Unranked shows placed tiles first, then waiting games by finish time", () => {
  const lib = library();
  lib.run(startGame, ref(1));
  lib.run(startGame, ref(2));
  lib.run(startGame, ref(3));
  lib.run(setStatus, "rawg:1", "completed");
  lib.run(setStatus, "rawg:2", "completed");
  lib.run(addToBoard, "rawg:3");
  assert.deepEqual(tierIds(lib, "unranked"), ["rawg:3", "rawg:1", "rawg:2"]);
  lib.run(moveToTier, "rawg:2", "unranked", 0);
  assert.deepEqual(tierIds(lib, "unranked"), ["rawg:2", "rawg:3", "rawg:1"]);
});

test("a ranked tile with no position still shows and a move repairs it", () => {
  const lib = library();
  for (const id of [1, 2]) {
    lib.run(startGame, ref(id));
    lib.run(moveToTier, `rawg:${id}`, "A", 99);
  }
  const damaged = { ...lib.data.records["rawg:2"], tierPosition: null };
  lib.run(() => ({ records: [damaged], queue: [] }));
  assert.deepEqual(tierIds(lib, "A"), ["rawg:2", "rawg:1"]);
  lib.run(moveToTier, "rawg:2", "A", 1);
  assert.deepEqual(tierIds(lib, "A"), ["rawg:1", "rawg:2"]);
  assert.ok(lib.data.records["rawg:2"].tierPosition);
});

test("the library imports nothing from the movie stores or the movie sync", () => {
  for (const file of ["rules.ts", "merge.ts", "types.ts", "rank-key.ts"]) {
    const source = readFileSync(
      new URL(`../src/lib/game-library/${file}`, import.meta.url),
      "utf8",
    );
    const imports = source.split("\n").filter((line) => /^(import|} from)/.test(line));
    assert.doesNotMatch(imports.join("\n"), /library-tracking|tier-order|watchlist|cloud\//, file);
  }
});
