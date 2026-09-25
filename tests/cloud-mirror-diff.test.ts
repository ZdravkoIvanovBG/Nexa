// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import { diffWatched, diffWatching, diffWatchlist } from "../src/lib/cloud/diff.ts";
import type { LocalEntry } from "../src/lib/watchlist.ts";
import type { WatchedEntry, WatchingEntry } from "../src/lib/library-tracking.ts";

function wl(id: string, over: Partial<LocalEntry> = {}): LocalEntry {
  return { id, type: "movie", name: id, addedAt: 1000, ...over };
}

function watching(id: string, over: Partial<WatchingEntry> = {}): WatchingEntry {
  return {
    id,
    type: "series",
    name: id,
    season: 1,
    episode: 1,
    addedAt: 1000,
    updatedAt: 1000,
    ...over,
  };
}

function watched(id: string, over: Partial<WatchedEntry> = {}): WatchedEntry {
  return { id, type: "movie", name: id, tier: "unranked", order: 0, finishedAt: 1000, ...over };
}

function ids<T extends { id: string }>(list: T[]): string[] {
  return list.map((e) => e.id).sort();
}

test("an unchanged watchlist produces no writes", () => {
  const snap = [wl("tt1"), wl("tt2")];
  const d = diffWatchlist(
    snap,
    snap.map((e) => ({ ...e })),
  );
  assert.deepEqual(d.upserts, []);
  assert.deepEqual(d.deletes, []);
});

test("adding and removing a watchlist entry", () => {
  const d = diffWatchlist([wl("tt1")], [wl("tt2")]);
  assert.deepEqual(ids(d.upserts), ["tt2"]);
  assert.deepEqual(d.deletes, ["tt1"]);
});

test("a renamed watchlist entry is upserted, untouched siblings are not", () => {
  const prev = [wl("tt1"), wl("tt2")];
  const next = [wl("tt1", { name: "Hydrated Title" }), wl("tt2")];
  const d = diffWatchlist(prev, next);
  assert.deepEqual(ids(d.upserts), ["tt1"]);
  assert.equal(d.upserts[0].name, "Hydrated Title");
  assert.deepEqual(d.deletes, []);
});

test("a setProgress season and episode bump emits one upsert", () => {
  const prev = [watching("tt9"), watching("tt8")];
  const next = [watching("tt9", { season: 2, episode: 4, updatedAt: 2000 }), watching("tt8")];
  const d = diffWatching(prev, next);
  assert.deepEqual(ids(d.upserts), ["tt9"]);
  assert.equal(d.upserts[0].season, 2);
  assert.equal(d.upserts[0].episode, 4);
  assert.deepEqual(d.deletes, []);
});

test("moveToTier emits an upsert for every row whose tier or order moved, and nothing else", () => {
  // Two tiers: S holds a,b and B holds x,y. Drag x to the front of S.
  const prev = [
    watched("a", { tier: "S", order: 0 }),
    watched("b", { tier: "S", order: 1 }),
    watched("x", { tier: "B", order: 0 }),
    watched("y", { tier: "B", order: 1 }),
    watched("z", { tier: "F", order: 0 }),
  ];
  const next = [
    watched("a", { tier: "S", order: 1 }),
    watched("b", { tier: "S", order: 2 }),
    watched("x", { tier: "S", order: 0 }),
    watched("y", { tier: "B", order: 0 }),
    watched("z", { tier: "F", order: 0 }),
  ];
  const d = diffWatched(prev, next);
  // a and b shifted down, x changed tier, y closed the gap in B. z is untouched.
  assert.deepEqual(ids(d.upserts), ["a", "b", "x", "y"]);
  assert.deepEqual(d.deletes, []);
});

test("markWatched moving an item out of watching deletes its watching row", () => {
  const d = diffWatching([watching("tt5"), watching("tt6")], [watching("tt6")]);
  assert.deepEqual(d.upserts, []);
  assert.deepEqual(d.deletes, ["tt5"]);
});

test("removeFromWatched deletes only that tier row", () => {
  const prev = [watched("a", { tier: "S" }), watched("b", { tier: "S", order: 1 })];
  const next = [watched("a", { tier: "S" })];
  const d = diffWatched(prev, next);
  assert.deepEqual(d.upserts, []);
  assert.deepEqual(d.deletes, ["b"]);
});

test("a tier drag uploads only the dragged item's own media kind", () => {
  // Ranking is dense per (tier, kind), so dropping a movie at the front of S
  // renumbers the three movies there and must leave the four series alone.
  // A regression to whole-tier renumbering would make this seven upserts.
  const series = [
    watched("s1", { type: "series", tier: "S", order: 0 }),
    watched("s2", { type: "series", tier: "S", order: 1 }),
    watched("s3", { type: "series", tier: "S", order: 2 }),
    watched("s4", { type: "series", tier: "S", order: 3 }),
  ];
  const prev = [
    watched("m1", { tier: "S", order: 0 }),
    watched("m2", { tier: "S", order: 1 }),
    watched("m3", { tier: "unranked", order: 0 }),
    ...series,
  ];
  const next = [
    watched("m1", { tier: "S", order: 1 }),
    watched("m2", { tier: "S", order: 2 }),
    watched("m3", { tier: "S", order: 0 }),
    ...series,
  ];
  const d = diffWatched(prev, next);
  assert.deepEqual(ids(d.upserts).sort(), ["m1", "m2", "m3"]);
  assert.deepEqual(d.deletes, []);
});

test("an item becoming both watching and watched syncs to both tables, with no cross deletes", () => {
  // A returning series: previously finished (already in `watched`, tiered),
  // now a new season starts and it's added back to `watching`. currently_watching
  // and tier_list are independent Supabase tables, so this must produce an
  // upsert into `watching` and NOT a delete from `watched` -- see
  // addToWatching() in library-tracking.ts.
  const prevWatching: WatchingEntry[] = [];
  const nextWatching = [watching("tt1")];
  const watchingDelta = diffWatching(prevWatching, nextWatching);
  assert.deepEqual(ids(watchingDelta.upserts), ["tt1"]);
  assert.deepEqual(watchingDelta.deletes, []);

  const prevWatched = [watched("tt1", { tier: "S", order: 0 })];
  const nextWatched = [watched("tt1", { tier: "S", order: 0 })];
  const watchedDelta = diffWatched(prevWatched, nextWatched);
  assert.deepEqual(watchedDelta.upserts, []);
  assert.deepEqual(watchedDelta.deletes, []);
});
