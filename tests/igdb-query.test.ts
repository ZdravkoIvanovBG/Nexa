// @ts-nocheck -- Node's test modules are not included in the application tsconfig.
// Mocked: pure query construction, no network.
import assert from "node:assert/strict";
import test from "node:test";
import {
  GAME_TYPE,
  IGDB_ENDPOINTS,
  IgdbQueryError,
  LISTABLE_GAME_TYPES,
  THEME_EROTIC,
  buildMultiquery,
  buildQuery,
  gameBySlug,
  gamesByIds,
  idList,
  isIgdbEndpoint,
  plainText,
  popularityQuery,
  publicFilters,
  searchQuery,
  sectionQuery,
  validSlug,
  where,
} from "../src/lib/providers/igdb/query.ts";

test("builds an Apicalypse body in a stable order", () => {
  const body = buildQuery({
    fields: ["name", "cover.image_id", "genres.*"],
    exclude: ["storyline"],
    where: [where.eq("game_type", 0), where.gte("aggregated_rating", 80)],
    sort: { field: "first_release_date", dir: "desc" },
    limit: 20,
    offset: 40,
  });
  assert.equal(
    body,
    "fields name,cover.image_id,genres.*; exclude storyline; where game_type = 0 & aggregated_rating >= 80; sort first_release_date desc; limit 20; offset 40;",
  );
});

test("plainText strips everything that could end a string literal", () => {
  assert.equal(plainText('zelda"; fields *; where id = 1; "'), "zelda ; fields *; where id = 1;");
  assert.equal(plainText('a\\"b'), "a b");
  assert.equal(plainText("line\nbreak\ttab\u0000nul sep"), "line break tab nul sep");
  assert.equal(plainText("   "), null);
  assert.equal(plainText(""), null);
  assert.equal(plainText(42), null);
  assert.equal(plainText(null), null);
  // Fullwidth quote folds to an ASCII quote under NFKC and is then removed.
  assert.equal(plainText("ｚｅｌｄａ＂"), "zelda");
});

test("plainText caps length on a code point boundary", () => {
  const long = "😀".repeat(150);
  const out = plainText(long);
  assert.equal(Array.from(out).length, 100);
  assert.ok(!/[\ud800-\udbff]$/.test(out), "must not end in a lone high surrogate");
});

test("search terms can never break out of the search string", () => {
  const body = buildQuery({ fields: ["name"], search: 'x"; fields *; limit 500; "' });
  assert.equal(body, 'fields name; search "x ; fields *; limit 500;";');
  assert.equal((body.match(/"/g) ?? []).length, 2);
});

test("contains() filters are reduced to plain text too", () => {
  assert.equal(where.contains("name", 'Halo" | id > 0').clause, 'name ~ *"Halo | id > 0"*');
  assert.throws(() => where.contains("name", '"""'), IgdbQueryError);
});

test("rejects search combined with sort, as IGDB does", () => {
  assert.throws(
    () => buildQuery({ fields: ["name"], search: "halo", sort: { field: "rating", dir: "desc" } }),
    IgdbQueryError,
  );
  assert.throws(() => buildQuery({ fields: ["name"], search: '  "  ' }), IgdbQueryError);
});

test("rejects malformed field names, sort directions and limits", () => {
  for (const bad of ["name;", "Name", "na me", "a..b", "1abc", "name,slug", "", "a.*.b"]) {
    assert.throws(() => buildQuery({ fields: [bad] }), IgdbQueryError, bad);
  }
  assert.throws(() => buildQuery({ fields: ["name"], sort: { field: "x", dir: "up" } }));
  for (const limit of [0, 501, 1.5, -1, Number.NaN, "10"]) {
    assert.throws(() => buildQuery({ fields: ["name"], limit }), IgdbQueryError, String(limit));
  }
  assert.throws(() => buildQuery({ fields: ["name"], offset: -1 }), IgdbQueryError);
  assert.throws(() => buildQuery({ fields: [] }), IgdbQueryError);
});

test("conditions only accept numbers, booleans and null", () => {
  assert.equal(where.eq("version_parent", null).clause, "version_parent = null");
  assert.equal(where.eq("checksum_ok", true).clause, "checksum_ok = true");
  assert.throws(() => where.eq("name", "x"), IgdbQueryError);
  assert.throws(() => where.gt("rating", Number.POSITIVE_INFINITY), IgdbQueryError);
  assert.throws(() => where.gt("rating", "1; fields *"), IgdbQueryError);
  assert.throws(() => buildQuery({ fields: ["name"], where: [{ clause: "" }] }), IgdbQueryError);
});

test("or/and group conditions", () => {
  const c = where.or(where.gte("hypes", 5), where.and(where.eq("a", 1), where.eq("b", 2)));
  assert.equal(c.clause, "(hypes >= 5 | (a = 1 & b = 2))");
  assert.throws(() => where.or(), IgdbQueryError);
});

test("id lists are validated, deduped and capped", () => {
  assert.deepEqual(idList([3, 1, 3, 2]), [3, 1, 2]);
  for (const bad of [[0], [-1], [1.5], ["1"], [Number.MAX_SAFE_INTEGER + 1], [], "1,2"]) {
    assert.throws(() => idList(bad), IgdbQueryError, JSON.stringify(bad));
  }
  assert.throws(() => idList(Array.from({ length: 501 }, (_, i) => i + 1)), IgdbQueryError);
  assert.equal(where.anyOf("id", [5, 6]).clause, "id = (5,6)");
  // Enum filters accept 0 (game_type 0 = main game); game id lists never do.
  assert.equal(where.anyOf("game_type", [0, 8]).clause, "game_type = (0,8)");
  assert.throws(() => where.anyOf("game_type", [-1]), IgdbQueryError);
  assert.throws(() => gamesByIds([0]), IgdbQueryError);
  assert.equal(where.noneOf("themes", [THEME_EROTIC]).clause, "themes != (42)");
});

test("slugs must be lowercase dash words", () => {
  assert.ok(validSlug("the-witcher-3-wild-hunt"));
  for (const bad of ["The-Witcher", "a--b", "-a", "a-", 'a"b', "a b", "", "a/b", 5]) {
    assert.equal(validSlug(bad), false, String(bad));
  }
  assert.equal(gameBySlug("halo", ["name"]).where[0].clause, 'slug = "halo"');
  assert.throws(() => gameBySlug('halo"; fields *'), IgdbQueryError);
});

test("multiquery: names, endpoints and size are validated", () => {
  const body = buildMultiquery([
    { name: "top", endpoint: "games", query: { fields: ["name"], limit: 5 } },
    {
      name: "total",
      endpoint: "games/count",
      query: { fields: [], where: [where.eq("game_type", 0)] },
    },
  ]);
  assert.equal(
    body,
    'query games "top" { fields name; limit 5; }; query games/count "total" { where game_type = 0; };',
  );
  const q = { name: "a", endpoint: "games", query: { fields: ["name"] } };
  assert.throws(() => buildMultiquery([]), IgdbQueryError);
  assert.throws(
    () => buildMultiquery(Array.from({ length: 11 }, (_, i) => ({ ...q, name: `q${i}` }))),
    IgdbQueryError,
  );
  assert.throws(() => buildMultiquery([q, q]), IgdbQueryError);
  assert.throws(() => buildMultiquery([{ ...q, name: 'a" }; query' }]), IgdbQueryError);
  assert.throws(() => buildMultiquery([{ ...q, endpoint: "multiquery" }]), IgdbQueryError);
  assert.throws(() => buildMultiquery([{ ...q, endpoint: "users" }]), IgdbQueryError);
});

test("endpoint allowlist", () => {
  assert.ok(isIgdbEndpoint("games"));
  assert.ok(isIgdbEndpoint("games/count"));
  for (const bad of ["users", "games/../x", "GAMES", "", null, "games?x=1"]) {
    assert.equal(isIgdbEndpoint(bad), false, String(bad));
  }
  assert.equal(new Set(IGDB_ENDPOINTS).size, IGDB_ENDPOINTS.length);
});

test("public lists exclude editions, non-standalone types and the Erotic theme", () => {
  const clauses = publicFilters().map((c) => c.clause);
  assert.deepEqual(clauses, [
    `game_type = (${LISTABLE_GAME_TYPES.join(",")})`,
    "version_parent = null",
    "themes != (42)",
  ]);
  assert.ok(!LISTABLE_GAME_TYPES.includes(GAME_TYPE.dlc));
  assert.ok(!LISTABLE_GAME_TYPES.includes(GAME_TYPE.bundle));
  for (const id of ["new", "upcoming", "acclaimed", "classics"]) {
    const body = buildQuery(sectionQuery(id, 1_762_300_800));
    assert.ok(body.includes("themes != (42)"), id);
    assert.ok(body.includes("version_parent = null"), id);
  }
  assert.ok(buildQuery(searchQuery("halo")).includes("themes != (42)"));
});

test("section windows are computed from the given clock", () => {
  const now = 1_762_300_800; // 2025-11-05T00:00:00Z
  const body = buildQuery(sectionQuery("new", now));
  assert.ok(body.includes(`first_release_date >= ${now - 90 * 86400}`));
  assert.ok(body.includes(`first_release_date <= ${now}`));
  assert.ok(body.includes("sort hypes desc"), "new releases rank by interest, not just date");
  const up = buildQuery(sectionQuery("upcoming", now));
  assert.ok(up.includes(`first_release_date > ${now}`));
  assert.ok(up.includes("sort hypes desc"));
  const acclaimed = buildQuery(sectionQuery("acclaimed", now));
  assert.ok(acclaimed.includes("aggregated_rating >= 85"));
});

test("popularity and id lookups", () => {
  assert.equal(
    buildQuery(popularityQuery(1, 10)),
    "fields game_id,value,popularity_type; where popularity_type = 1; sort value desc; limit 10;",
  );
  assert.throws(() => popularityQuery(0), IgdbQueryError);
  const byIds = gamesByIds([10, 20, 10], ["name"]);
  assert.equal(buildQuery(byIds), "fields name; where id = (10,20); limit 2;");
});
