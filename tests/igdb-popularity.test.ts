// @ts-nocheck -- Node's test modules are not included in the application tsconfig.
// Mocked: hand-written popularity lists; no network.
import assert from "node:assert/strict";
import test from "node:test";
import { blendPopularity, orderByRanking } from "../src/lib/providers/igdb/popularity.ts";
import {
  POPULARITY_TYPE,
  buildMultiquery,
  buildQuery,
  sectionQuery,
  popularSubqueries,
} from "../src/lib/providers/igdb/query.ts";

const list = (...ids) => ids.map((game_id, i) => ({ game_id, value: 1 - i * 0.01 }));

test("a game high on both lists beats one that tops only one", () => {
  const playing = list(10, 20, 30);
  const want = list(40, 20, 50);
  const ranked = blendPopularity([playing, want]);
  assert.equal(ranked[0], 20, "second on both lists wins");
  assert.deepEqual(new Set(ranked), new Set([10, 20, 30, 40, 50]));
});

test("the blend is deterministic: ties break on best rank, then id", () => {
  const ranked = blendPopularity([list(7, 8), list(8, 7)]);
  assert.deepEqual(ranked, [7, 8], "equal scores and ranks: lower id first");
  const a = blendPopularity([list(1, 2, 3), list(4, 5, 6)]);
  const b = blendPopularity([[...list(4, 5, 6)].reverse(), [...list(1, 2, 3)].reverse()]);
  assert.deepEqual(a, b, "neither list order nor response order changes the result");
});

test("malformed primitives are ignored and duplicates count once", () => {
  const ranked = blendPopularity([
    [
      { game_id: 1, value: 5 },
      { game_id: 1, value: 4 },
      { game_id: "2", value: 3 },
      { game_id: 0, value: 2 },
      null,
      { game_id: 3 },
    ],
    "not a list",
    null,
  ]);
  assert.deepEqual(ranked, [1]);
  assert.deepEqual(blendPopularity([]), []);
  assert.deepEqual(blendPopularity([list(1, 2, 3)], { limit: 2 }), [1, 2]);
});

test("orderByRanking reorders fetched games and keeps unknowns last", () => {
  const games = [{ igdbId: 3 }, { igdbId: 1 }, { igdbId: 9 }, { igdbId: 2 }];
  assert.deepEqual(
    orderByRanking(games, [2, 3, 1]).map((g) => g.igdbId),
    [2, 3, 1, 9],
  );
});

test("Popular uses Playing and Want to Play, never Visits", () => {
  assert.deepEqual(POPULARITY_TYPE, { wantToPlay: 2, playing: 3 });
  const body = buildMultiquery(popularSubqueries(50));
  assert.ok(body.includes("where popularity_type = 3"));
  assert.ok(body.includes("where popularity_type = 2"));
  assert.ok(!body.includes("popularity_type = 1;"), "Visits (1) is not used");
});

test("New releases rank by hypes with a light floor and require a cover", () => {
  const body = buildQuery(sectionQuery("new", 1_762_300_800));
  assert.ok(body.includes("cover != null"));
  assert.ok(body.includes("(hypes >= 1 | total_rating_count >= 1)"));
  assert.ok(body.includes("sort hypes desc"));
  assert.ok(!body.includes("sort first_release_date"));
  assert.ok(buildQuery(sectionQuery("upcoming", 1_762_300_800)).includes("cover != null"));
});
