// @ts-nocheck -- Node's test modules are not included in the application tsconfig.
// Keeps tests/fixtures/igdb-query-bodies.json equal to what the TypeScript
// query builder emits. The Rust validator (src-tauri/src/igdb/validate.rs)
// must accept every body in that fixture, so the two can't drift apart.
// Regenerate with: UPDATE_IGDB_FIXTURE=1 node --test tests/igdb-query-bodies.test.ts
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import test from "node:test";
import {
  buildMultiquery,
  buildQuery,
  DETAIL_FIELDS,
  gameBySlug,
  gamesByIds,
  popularSubqueries,
  publicFilters,
  searchQuery,
  sectionQuery,
  where,
} from "../src/lib/providers/igdb/query.ts";

const FIXTURE = new URL("./fixtures/igdb-query-bodies.json", import.meta.url);
const NOW = 1_793_836_800; // 2026-11-05T00:00:00Z

function cases() {
  const out = [];
  const add = (name, endpoint, body) => out.push({ name, endpoint, body });
  for (const id of ["new", "upcoming", "acclaimed", "classics"]) {
    add(`section ${id}`, "games", buildQuery(sectionQuery(id, NOW)));
  }
  add("popular", "multiquery", buildMultiquery(popularSubqueries()));
  add("games by ids", "games", buildQuery(gamesByIds([1942, 1020, 7346])));
  add("game by slug", "games", buildQuery(gameBySlug("the-witcher-3-wild-hunt")));
  add("search", "games", buildQuery(searchQuery('Zelda: "Breath" \\ of\nthe Wild')));
  add(
    "count",
    "games/count",
    buildQuery({ fields: [], where: [...publicFilters(), where.anyOf("genres", [12, 31])] }),
  );
  add(
    "collection",
    "collections",
    buildQuery({ fields: ["name", "slug", "games"], where: [where.eq("id", 106)], limit: 1 }),
  );
  add(
    "memberships",
    "collection_memberships",
    buildQuery({
      fields: ["game", "type", "collection"],
      where: [where.eq("collection", 106), where.eq("type", 1)],
      limit: 500,
      offset: 0,
    }),
  );
  add(
    "name contains",
    "games",
    buildQuery({
      fields: ["name", "artworks.*"],
      exclude: ["checksum"],
      where: [where.contains("name", "assassin's creed"), where.gte("first_release_date", -1)],
      sort: { field: "first_release_date", dir: "asc" },
      limit: 50,
      offset: 100,
    }),
  );
  add(
    "detail and related",
    "multiquery",
    buildMultiquery([
      { name: "detail", endpoint: "games", query: gameBySlug("hades", DETAIL_FIELDS) },
      {
        name: "screens",
        endpoint: "screenshots",
        query: { fields: ["image_id"], where: [where.eq("game", 113112)], limit: 20 },
      },
      {
        name: "devs",
        endpoint: "involved_companies",
        query: { fields: ["company.name"], where: [where.eq("developer", true)], limit: 10 },
      },
    ]),
  );
  return out;
}

test("the query-body fixture matches the TypeScript builder", () => {
  const built = cases();
  if (process.env.UPDATE_IGDB_FIXTURE === "1") {
    writeFileSync(FIXTURE, JSON.stringify(built, null, 2) + "\n");
  }
  const fixture = JSON.parse(readFileSync(FIXTURE, "utf8"));
  assert.deepEqual(fixture, built);
});
