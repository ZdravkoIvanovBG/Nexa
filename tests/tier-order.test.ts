// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import {
  bucketByTier,
  countsByKind,
  mergeWatchedMovies,
  nextOrderFor,
  placeInTier,
  type MediaKind,
} from "../src/lib/tier-order.ts";
import { ALL_TIERS, type Tier } from "../src/lib/tracking-tiers.ts";

type Entry = {
  id: string;
  type: MediaKind;
  tier: Tier;
  order: number;
  finishedAt: number;
};

function e(id: string, type: MediaKind, tier: Tier, order: number, finishedAt = 0): Entry {
  return { id, type, tier, order, finishedAt };
}

const ids = (list: readonly Entry[]) => list.map((x) => x.id);
const orderOf = (list: readonly Entry[], id: string) => list.find((x) => x.id === id)!.order;

test("bucketByTier returns only the requested kind", () => {
  const items = [e("m1", "movie", "S", 0), e("s1", "series", "S", 1), e("m2", "movie", "A", 0)];
  assert.deepEqual(ids(bucketByTier(items, "movie", ALL_TIERS).S), ["m1"]);
  assert.deepEqual(ids(bucketByTier(items, "series", ALL_TIERS).S), ["s1"]);
  assert.deepEqual(ids(bucketByTier(items, "series", ALL_TIERS).A), []);
});

test("bucketByTier gives every tier a row", () => {
  const board = bucketByTier([], "movie", ALL_TIERS);
  assert.deepEqual(Object.keys(board).sort(), [...ALL_TIERS].sort());
});

test("bucketByTier preserves relative order of legacy interleaved ranks", () => {
  // Pre-split data: one dense sequence per tier shared by both kinds.
  const items = [
    e("m1", "movie", "S", 0),
    e("s1", "series", "S", 1),
    e("m2", "movie", "S", 2),
    e("s2", "series", "S", 3),
    e("m3", "movie", "S", 5),
  ];
  assert.deepEqual(ids(bucketByTier(items, "movie", ALL_TIERS).S), ["m1", "m2", "m3"]);
  assert.deepEqual(ids(bucketByTier(items, "series", ALL_TIERS).S), ["s1", "s2"]);
});

test("bucketByTier breaks order ties the same way for any input permutation", () => {
  const a = e("bbb", "movie", "S", 4, 100);
  const b = e("aaa", "movie", "S", 4, 100);
  const c = e("ccc", "movie", "S", 4, 50);
  const forward = ids(bucketByTier([a, b, c], "movie", ALL_TIERS).S);
  const reversed = ids(bucketByTier([c, b, a], "movie", ALL_TIERS).S);
  assert.deepEqual(forward, reversed);
  // finishedAt wins over id; id only settles a full tie.
  assert.deepEqual(forward, ["ccc", "aaa", "bbb"]);
});

test("MAX_SAFE_INTEGER fallback ranks sort last and deterministically", () => {
  const max = Number.MAX_SAFE_INTEGER;
  const items = [
    e("legacy-b", "movie", "S", max, 0),
    e("ranked", "movie", "S", 1, 0),
    e("legacy-a", "movie", "S", max, 0),
  ];
  assert.deepEqual(ids(bucketByTier(items, "movie", ALL_TIERS).S), [
    "ranked",
    "legacy-a",
    "legacy-b",
  ]);
});

test("nextOrderFor ignores the other kind", () => {
  const items = [e("s1", "series", "unranked", 7), e("m1", "movie", "unranked", 2)];
  assert.equal(nextOrderFor(items, "unranked", "movie"), 3);
  assert.equal(nextOrderFor(items, "unranked", "series"), 8);
});

test("nextOrderFor starts at 0 for an empty scope", () => {
  assert.equal(nextOrderFor([], "unranked", "movie"), 0);
  assert.equal(nextOrderFor([e("s1", "series", "S", 4)], "S", "movie"), 0);
});

test("nextOrderFor stays a safe integer next to a MAX_SAFE_INTEGER rank", () => {
  const next = nextOrderFor([e("m1", "movie", "S", Number.MAX_SAFE_INTEGER)], "S", "movie");
  assert.ok(Number.isSafeInteger(next), `${next} is not a safe integer`);
  assert.ok(next <= 1_000_000);
});

test("reordering within a tier leaves the other kind's ranks untouched", () => {
  const items = [
    e("m1", "movie", "S", 0),
    e("m2", "movie", "S", 1),
    e("m3", "movie", "S", 2),
    e("s1", "series", "S", 0),
    e("s2", "series", "S", 1),
  ];
  const seriesBefore = items.filter((x) => x.type === "series").map((x) => ({ ...x }));

  assert.equal(placeInTier(items, "m3", "S", 0), true);

  assert.deepEqual(ids(bucketByTier(items, "movie", ALL_TIERS).S), ["m3", "m1", "m2"]);
  assert.deepEqual([orderOf(items, "m3"), orderOf(items, "m1"), orderOf(items, "m2")], [0, 1, 2]);
  // Every series entry is byte-identical.
  assert.deepEqual(
    items.filter((x) => x.type === "series"),
    seriesBefore,
  );
});

test("a cross-tier move renumbers the source tier only within its own kind", () => {
  const items = [
    e("m1", "movie", "S", 0),
    e("m2", "movie", "S", 1),
    e("m3", "movie", "S", 2),
    e("s1", "series", "S", 0),
    e("s2", "series", "S", 1),
    e("s3", "series", "A", 0),
  ];
  const seriesBefore = items.filter((x) => x.type === "series").map((x) => ({ ...x }));

  assert.equal(placeInTier(items, "m1", "A", 0), true);

  // Source tier S closes the gap for movies; the moved entry is excluded.
  assert.deepEqual(ids(bucketByTier(items, "movie", ALL_TIERS).S), ["m2", "m3"]);
  assert.deepEqual([orderOf(items, "m2"), orderOf(items, "m3")], [0, 1]);
  assert.deepEqual(ids(bucketByTier(items, "movie", ALL_TIERS).A), ["m1"]);
  assert.equal(orderOf(items, "m1"), 0);
  assert.deepEqual(
    items.filter((x) => x.type === "series"),
    seriesBefore,
  );
});

test("an index past the end lands at the end of the same-kind list", () => {
  const items = [
    e("m1", "movie", "S", 0),
    e("m2", "movie", "S", 1),
    e("s1", "series", "S", 0),
    e("s2", "series", "S", 1),
    e("s3", "series", "S", 2),
    e("m3", "movie", "A", 0),
  ];
  // 99 and 5 both exceed the two movies already in S.
  assert.equal(placeInTier(items, "m3", "S", 99), true);
  assert.deepEqual(ids(bucketByTier(items, "movie", ALL_TIERS).S), ["m1", "m2", "m3"]);
  assert.equal(orderOf(items, "m3"), 2);
});

test("a negative index lands at the front", () => {
  const items = [e("m1", "movie", "S", 0), e("m2", "movie", "A", 0)];
  assert.equal(placeInTier(items, "m2", "S", -3), true);
  assert.deepEqual(ids(bucketByTier(items, "movie", ALL_TIERS).S), ["m2", "m1"]);
});

test("an unknown id is a no-op", () => {
  const items = [e("m1", "movie", "S", 0)];
  const before = items.map((x) => ({ ...x }));
  assert.equal(placeInTier(items, "nope", "A", 0), false);
  assert.deepEqual(items, before);
});

test("moving into the Unranked row works like any other tier", () => {
  const items = [
    e("m1", "movie", "unranked", 0),
    e("m2", "movie", "S", 0),
    e("s1", "series", "unranked", 1),
  ];
  assert.equal(placeInTier(items, "m2", "unranked", 0), true);
  assert.deepEqual(ids(bucketByTier(items, "movie", ALL_TIERS).unranked), ["m2", "m1"]);
  assert.equal(orderOf(items, "s1"), 1);
});

test("countsByKind totals both kinds", () => {
  assert.deepEqual(countsByKind([]), { movie: 0, series: 0 });
  assert.deepEqual(
    countsByKind([
      e("m1", "movie", "S", 0),
      e("m2", "movie", "unranked", 0),
      e("s1", "series", "A", 0),
    ]),
    { movie: 2, series: 1 },
  );
});

const noAlias = () => undefined;
const make = (id: string, order: number) => e(id, "movie", "unranked", order);

test("mergeWatchedMovies adds local-only movies unranked after existing ones", () => {
  const items = [e("m1", "movie", "unranked", 0), e("m2", "movie", "S", 0)];
  const merged = mergeWatchedMovies(items, ["m3"], noAlias, make);
  assert.deepEqual(ids(merged), ["m1", "m2", "m3"]);
  assert.equal(orderOf(merged, "m3"), 1);
  assert.equal(merged.find((x) => x.id === "m3")!.tier, "unranked");
});

test("mergeWatchedMovies keeps a movie in both stores once, with its tier", () => {
  const items = [e("m1", "movie", "A", 2)];
  const merged = mergeWatchedMovies(items, ["m1"], noAlias, make);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].tier, "A");
  assert.equal(merged[0].order, 2);
});

test("mergeWatchedMovies dedupes across tt and tmdb aliases", () => {
  const alias = (id: string) =>
    id === "tt1" ? "tmdb:movie:1" : id === "tmdb:movie:1" ? "tt1" : undefined;
  const items = [e("tmdb:movie:1", "movie", "B", 0)];
  assert.deepEqual(ids(mergeWatchedMovies(items, ["tt1"], alias, make)), ["tmdb:movie:1"]);
});

test("mergeWatchedMovies collapses duplicate local ids", () => {
  const merged = mergeWatchedMovies([], ["m1", "m1", "m2"], noAlias, make);
  assert.deepEqual(ids(merged), ["m1", "m2"]);
  assert.deepEqual(
    merged.map((x) => x.order),
    [0, 1],
  );
});

test("mergeWatchedMovies leaves series and the input untouched", () => {
  const items = [e("s1", "series", "S", 0), e("s2", "series", "unranked", 0)];
  const snapshot = JSON.stringify(items);
  const merged = mergeWatchedMovies(items, ["m1"], noAlias, make);
  assert.equal(JSON.stringify(items), snapshot);
  assert.deepEqual(
    bucketByTier(merged, "series", ALL_TIERS),
    bucketByTier(items, "series", ALL_TIERS),
  );
  assert.deepEqual(countsByKind(merged), { movie: 1, series: 2 });
});
