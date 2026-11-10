// @ts-nocheck -- Node's test modules are not included in the application tsconfig.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  addMember,
  addToBoard,
  applyPatch,
  backToWishlist,
  beginPlaying,
  boardCandidates,
  boardDropIndex,
  boardPlace,
  chainChanges,
  isPlaced,
  playAgain,
  playDates,
  playStateOf,
  restoreState,
  restoreTier,
  stepOnBoard,
  tierStateOf,
  wishlistNextUp,
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
import { ALL_TIERS } from "../src/lib/tracking-tiers.ts";

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
  assert.ok(restored.liveAt > removed.liveAt);
  assert.equal(restored.deletedAt, null);
});

test("moving a row changes where it sits, and removing it changes only whether it exists", () => {
  const lib = library();
  seededQueue(lib, 1, 2);
  const start = lib.data.queue["g:rawg:2"];
  const moved = lib.run(moveEntry, "g:rawg:2", 0).queue[0];
  assert.ok(moved.updatedAt > start.updatedAt);
  assert.equal(moved.liveAt, start.liveAt);
  const removed = lib.run(removeEntry, "g:rawg:2").queue[0];
  assert.ok(removed.liveAt > moved.liveAt);
  assert.equal(removed.updatedAt, moved.updatedAt);
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

test("starting again from the Wishlist is a new playthrough; resuming is not", () => {
  const lib = library();
  seededQueue(lib, 1);
  lib.run(beginPlaying, "rawg:1");
  const first = lib.data.records["rawg:1"].startedAt;
  lib.run(setStatus, "rawg:1", "paused");
  lib.run(beginPlaying, "rawg:1");
  assert.equal(lib.data.records["rawg:1"].startedAt, first, "resume keeps the start");
  lib.run(backToWishlist, "rawg:1");
  lib.run(beginPlaying, "rawg:1");
  assert.ok(lib.data.records["rawg:1"].startedAt > first, "a new start starts now");
});

test("playing a completed game again starts now and keeps the last finish as history", () => {
  const lib = library();
  lib.run(startGame, ref(1));
  lib.run(setStatus, "rawg:1", "completed");
  const finished = lib.data.records["rawg:1"].completedAt;
  assert.deepEqual(playDates(lib.data.records["rawg:1"]).completed, finished);

  lib.run(playAgain, "rawg:1");
  const record = lib.data.records["rawg:1"];
  assert.equal(record.status, "playing");
  assert.ok(record.startedAt > finished);
  assert.equal(record.completedAt, finished);
  const dates = playDates(record);
  assert.equal(dates.completed, null, "the old finish is not this run's");
  assert.equal(dates.lastCompleted, finished);
  assert.equal(dates.started, record.startedAt);

  assert.ok(isEmptyPatch(lib.run(playAgain, "rawg:1")), "only a completed game is replayed");
  lib.run(setStatus, "rawg:1", "completed");
  assert.ok(lib.data.records["rawg:1"].completedAt > finished);
});

test("undo restores the exact status and dates, under a newer stamp", () => {
  const lib = library();
  lib.run(startGame, ref(1));
  lib.run(setStatus, "rawg:1", "completed");
  const before = lib.data.records["rawg:1"];
  const previous = playStateOf(before);

  for (const change of [
    (d, c) => setStatus(d, "rawg:1", "dropped", c),
    (d, c) => playAgain(d, "rawg:1", c),
    (d, c) => clearStatus(d, "rawg:1", c),
  ]) {
    lib.run(change);
    const changedAt = lib.data.records["rawg:1"].stateAt;
    lib.run(restoreState, "rawg:1", previous);
    const after = lib.data.records["rawg:1"];
    assert.deepEqual(playStateOf(after), previous);
    assert.ok(after.stateAt > changedAt, "an undo must beat the change on every device");
  }
  assert.ok(isEmptyPatch(lib.run(restoreState, "rawg:1", previous)));
});

test("undoing Back to Wishlist takes away the row it added and keeps an existing one", () => {
  const lib = library();
  seededQueue(lib, 1);
  lib.run(startGame, ref(2));
  const previous = playStateOf(lib.data.records["rawg:2"]);
  const patch = lib.run(backToWishlist, "rawg:2");
  const added = patch.queue.filter((e) => e.deletedAt === null).map((e) => e.entryId);
  assert.deepEqual(added, ["g:rawg:2"]);
  lib.run((d, c) =>
    chainChanges(d, c, [
      (dd, cc) => restoreState(dd, "rawg:2", previous, cc),
      ...added.map((id) => (dd, cc) => removeEntry(dd, id, cc)),
    ]),
  );
  assert.deepEqual(order(lib), ["rawg:1"]);
  assert.equal(lib.data.records["rawg:2"].status, "playing");

  // A started Wishlist game comes back to its own row, so nothing is added.
  lib.run(setStatus, "rawg:1", "playing");
  const again = lib.run(backToWishlist, "rawg:1");
  assert.equal(again.queue.length, 0);
});

test("starting a game keeps its place, collections, notes, progress, rank and identity", () => {
  const lib = library();
  seededQueue(lib, 1, 2, 3);
  lib.run(saveCollection, AC, [ref(2), ref(10)], []);
  lib.run(setNotes, "rawg:2", "Remember the side quests.");
  lib.run(setProgressEnabled, "rawg:2", true);
  lib.run(setProgress, "rawg:2", 20);
  lib.run(moveToTier, "rawg:2", "B", 0);
  const queueBefore = structuredClone(lib.data.queue);
  const record = structuredClone(lib.data.records["rawg:2"]);

  const patch = lib.run(beginPlaying, "rawg:2");
  assert.equal(patch.queue.length, 0, "no queue row is written");
  assert.equal(patch.records.length, 1);
  assert.deepEqual(lib.data.queue, queueBefore);
  const after = lib.data.records["rawg:2"];
  for (const field of [
    "gameId",
    "provider",
    "rawgId",
    "notes",
    "notesAt",
    "progress",
    "progressEnabled",
    "progressAt",
    "tier",
    "tierPosition",
    "tierAt",
    "metaAt",
    "createdAt",
  ]) {
    assert.deepEqual(after[field], record[field], field);
  }
  assert.deepEqual(order(lib), ["rawg:1", "rawg:3", "c:ac"]);
  assert.deepEqual(memberOrder(lib, "c:ac"), ["rawg:2", "rawg:10"], "still in its collection");
  lib.run(backToWishlist, "rawg:2");
  assert.deepEqual(order(lib), ["rawg:1", "rawg:2", "rawg:3", "c:ac"], "back in its old place");
});

test("starting the same game from another route never adds a second record", () => {
  const lib = library();
  seededQueue(lib, 1);
  lib.run(startGame, ref(1));
  lib.run(startGame, ref(1));
  assert.deepEqual(Object.keys(lib.data.records), ["rawg:1"]);
});

test("a game counts as placed while it is on the Wishlist or in a collection", () => {
  const lib = library();
  lib.run(startGame, ref(1));
  assert.equal(isPlaced(lib.data, "rawg:1"), false);
  lib.run(saveCollection, AC, [ref(1)], []);
  assert.equal(isPlaced(lib.data, "rawg:1"), true);
  lib.run(removeEntry, "c:ac");
  lib.run(saveGame, ref(1));
  assert.equal(isPlaced(lib.data, "rawg:1"), true);
});

test("the Wishlist's next game is its first game or a collection's next up", () => {
  const lib = library();
  assert.equal(wishlistNextUp(lib.data), null);
  lib.run(saveCollection, AC, [ref(10), ref(11)], []);
  lib.run(setStatus, "rawg:10", "playing");
  seededQueue(lib, 1);
  assert.equal(wishlistNextUp(lib.data).gameId, "rawg:11");
  lib.run(moveToTop, "g:rawg:1");
  assert.equal(wishlistNextUp(lib.data).gameId, "rawg:1");
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
  assert.equal(c.progressAt, b.progressAt);
  lib.run(setProgress, "rawg:1", 40);
  const d = lib.data.records["rawg:1"];
  assert.ok(d.progressAt > c.progressAt);
  assert.equal(d.stateAt, c.stateAt);
  lib.run(setProgressEnabled, "rawg:1", true);
  const e = lib.data.records["rawg:1"];
  assert.ok(e.progressAt > d.progressAt);
  assert.equal(e.stateAt, d.stateAt);
  assert.equal(e.metaAt, a.metaAt);
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
  assert.ok(after.metaAt > before.metaAt);
  const ctx = { now: 1 };
  assert.ok(
    isEmptyPatch(refreshSnapshot(lib.data, { ...ref(1, "Renamed"), image: after.image }, ctx)),
  );
  assert.ok(isEmptyPatch(refreshSnapshot(lib.data, ref(99), ctx)));
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

// ── Stage 2: the board ──────────────────────────────────────────────────────

function finished(lib, ...ids) {
  for (const id of ids) {
    lib.run(saveGame, ref(id));
    lib.run(startGame, ref(id));
    lib.run(setStatus, `rawg:${id}`, "completed");
  }
}

test("removing from the board can be undone exactly, back to the derived Unranked", () => {
  const lib = library();
  finished(lib, 1, 2);
  const derived = tierStateOf(lib.data.records["rawg:1"]);
  lib.run(removeFromBoard, "rawg:1");
  assert.deepEqual(tierIds(lib, "unranked"), ["rawg:2"]);
  const removedAt = lib.data.records["rawg:1"].tierAt;
  lib.run(restoreTier, "rawg:1", derived);
  assert.equal(lib.data.records["rawg:1"].tier, null);
  assert.ok(lib.data.records["rawg:1"].tierAt > removedAt, "the undo beats the removal everywhere");
  assert.deepEqual(tierIds(lib, "unranked"), ["rawg:1", "rawg:2"]);

  lib.run(moveToTier, "rawg:2", "S", 0);
  const ranked = tierStateOf(lib.data.records["rawg:2"]);
  lib.run(removeFromBoard, "rawg:2");
  lib.run(restoreTier, "rawg:2", ranked);
  assert.deepEqual(tierIds(lib, "S"), ["rawg:2"]);
  assert.equal(lib.data.records["rawg:2"].tierPosition, ranked.tierPosition);
  assert.ok(isEmptyPatch(lib.run(restoreTier, "rawg:2", ranked)));
});

test("Add games offers saved games that aren't on the board, finished ones first", () => {
  const lib = library();
  lib.run(saveGame, ref(5, "Zelda"));
  lib.run(saveGame, ref(6, "Alan Wake"));
  finished(lib, 7);
  lib.run(removeFromBoard, "rawg:7");
  finished(lib, 8);
  lib.run(startGame, ref(9, "Started from its page"));
  lib.run(startGame, ref(10, "Left everywhere"));
  lib.run(clearStatus, "rawg:10");
  const offered = boardCandidates(lib.data).map((r) => r.gameId);
  assert.deepEqual(offered, ["rawg:7", "rawg:6", "rawg:9", "rawg:5"]);
  assert.ok(!offered.includes("rawg:8"), "already in Unranked");
  assert.ok(!offered.includes("rawg:10"), "on no list and not started");
  lib.run(addToBoard, "rawg:7");
  assert.ok(!boardCandidates(lib.data).some((r) => r.gameId === "rawg:7"));
});

test("a drop among Unranked's waiting games lands after the placed ones", () => {
  const lib = library();
  finished(lib, 1, 2, 3);
  lib.run(moveToTier, "rawg:3", "unranked", 0); // placed
  const board = tierBoard(lib.data);
  assert.deepEqual(tierIds(lib, "unranked"), ["rawg:3", "rawg:1", "rawg:2"]);
  assert.equal(boardDropIndex(board, "rawg:2", "unranked", 2), 1);
  assert.equal(boardDropIndex(board, "rawg:3", "unranked", 2), 0, "the moving tile isn't counted");
  assert.equal(boardDropIndex(board, "rawg:1", "S", 5), 0);
  assert.equal(boardDropIndex(board, "rawg:1", "S", -3), 0);
});

test("dragging lands at the marked slot, counted without the dragged tile", () => {
  const lib = library();
  finished(lib, 1, 2, 3, 4);
  for (const id of [1, 2, 3, 4]) lib.run(moveToTier, `rawg:${id}`, "A", 99);
  // Forward: the slot after rawg:3 among the others [1, 3, 4] is 2.
  lib.run(moveToTier, "rawg:2", "A", boardDropIndex(tierBoard(lib.data), "rawg:2", "A", 2));
  assert.deepEqual(tierIds(lib, "A"), ["rawg:1", "rawg:3", "rawg:2", "rawg:4"]);
  // Backward to the front.
  lib.run(moveToTier, "rawg:4", "A", boardDropIndex(tierBoard(lib.data), "rawg:4", "A", 0));
  assert.deepEqual(tierIds(lib, "A"), ["rawg:4", "rawg:1", "rawg:3", "rawg:2"]);
});

test("keyboard steps move along a tier and between tiers, and stop at the edges", () => {
  const lib = library();
  finished(lib, 1, 2, 3);
  lib.run(moveToTier, "rawg:1", "S", 0);
  lib.run(moveToTier, "rawg:2", "S", 1);
  lib.run(stepOnBoard, "rawg:1", "right");
  assert.deepEqual(tierIds(lib, "S"), ["rawg:2", "rawg:1"]);
  assert.ok(isEmptyPatch(lib.run(stepOnBoard, "rawg:1", "right")), "already last");
  lib.run(stepOnBoard, "rawg:1", "left");
  assert.deepEqual(tierIds(lib, "S"), ["rawg:1", "rawg:2"]);
  assert.ok(isEmptyPatch(lib.run(stepOnBoard, "rawg:1", "left")), "already first");
  assert.ok(isEmptyPatch(lib.run(stepOnBoard, "rawg:1", "up")), "nothing above S");
  lib.run(stepOnBoard, "rawg:2", "down");
  assert.deepEqual(boardPlace(tierBoard(lib.data), "rawg:2"), { tier: "A", index: 0, count: 1 });
  for (let i = 0; i < 5; i++) lib.run(stepOnBoard, "rawg:2", "down");
  assert.equal(boardPlace(tierBoard(lib.data), "rawg:2").tier, "unranked");
  assert.equal(lib.data.records["rawg:2"].tier, "unranked", "a deliberate placement now");
  assert.ok(isEmptyPatch(lib.run(stepOnBoard, "rawg:2", "down")), "nothing below Unranked");
  // A waiting completed game can't step right: it can only join the placed tiles.
  assert.deepEqual(tierIds(lib, "unranked"), ["rawg:2", "rawg:3"]);
  assert.ok(isEmptyPatch(lib.run(stepOnBoard, "rawg:3", "right")));
  assert.ok(isEmptyPatch(lib.run(stepOnBoard, "rawg:9", "up")), "not on the board");
});

test("ranking never changes status, dates, notes, progress or the Wishlist", () => {
  const lib = library();
  seededQueue(lib, 1, 2);
  lib.run(startGame, ref(1));
  lib.run(setNotes, "rawg:1", "Boss rush next.");
  lib.run(setProgressEnabled, "rawg:1", true);
  lib.run(setProgress, "rawg:1", 70);
  const queue = structuredClone(lib.data.queue);
  const before = structuredClone(lib.data.records["rawg:1"]);
  const steps = [
    () => lib.run(addToBoard, "rawg:1"),
    () => lib.run(moveToTier, "rawg:1", "S", 0),
    () => lib.run(stepOnBoard, "rawg:1", "down"),
    () => lib.run(removeFromBoard, "rawg:1"),
    () => lib.run(restoreTier, "rawg:1", { tier: "B", tierPosition: null }),
  ];
  const fields = ["status", "startedAt", "completedAt", "stateAt", "notes", "notesAt", "progress"];
  fields.push("progressEnabled", "progressAt", "metaAt", "gameId", "provider");
  for (const step of steps) {
    const patch = step();
    assert.equal(patch.queue.length, 0, "no Wishlist row is written");
    const after = lib.data.records["rawg:1"];
    for (const field of fields) assert.deepEqual(after[field], before[field], field);
  }
  assert.deepEqual(lib.data.queue, queue);
});

test("a game in two collections and on the Wishlist has one tile and one rank", () => {
  const lib = library();
  lib.run(saveCollection, AC, [ref(10), ref(11)], []);
  lib.run(saveCollection, { franchiseId: "ezio", title: "Ezio", image: null }, [ref(11)], []);
  lib.run(saveGame, ref(11));
  lib.run(startGame, ref(11));
  lib.run(setStatus, "rawg:11", "completed");
  lib.run(moveToTier, "rawg:11", "S", 0);
  const all = ALL_TIERS.flatMap((tier) => tierIds(lib, tier));
  assert.deepEqual(all, ["rawg:11"]);
  assert.equal(placementsOf(lib.data, "rawg:11").collections.length, 2);
  assert.equal(placementsOf(lib.data, "rawg:11").standalone, true);
});

test("RAWG and IGDB games rank side by side under their own ids", () => {
  const lib = library();
  finished(lib, 1);
  const igdb = {
    provider: "igdb",
    igdbId: 77,
    slug: "x",
    name: "IGDB game",
    released: null,
    image: null,
  };
  lib.run(startGame, igdb);
  lib.run(setStatus, "igdb:77", "completed");
  lib.run(moveToTier, "igdb:77", "S", 0);
  lib.run(moveToTier, "rawg:1", "S", 1);
  assert.deepEqual(tierIds(lib, "S"), ["igdb:77", "rawg:1"]);
  assert.equal(lib.data.records["igdb:77"].provider, "igdb");
});

test("a status change never moves a tile, and replaying keeps a rank", () => {
  const lib = library();
  finished(lib, 1, 2);
  lib.run(moveToTier, "rawg:1", "A", 0);
  lib.run(playAgain, "rawg:1");
  assert.deepEqual(tierIds(lib, "A"), ["rawg:1"]);
  assert.equal(tierBoard(lib.data).A[0].notCompleted, true);
  lib.run(playAgain, "rawg:2");
  assert.deepEqual(tierIds(lib, "unranked"), [], "an unranked replay leaves the derived Unranked");
  lib.run(setStatus, "rawg:2", "completed");
  assert.deepEqual(tierIds(lib, "unranked"), ["rawg:2"]);
  lib.run(setStatus, "rawg:2", "dropped");
  assert.deepEqual(tierIds(lib, "unranked"), []);
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
