// @ts-nocheck -- Node's test modules are not included in the application tsconfig.
// Mocked: hand-written fixtures in tests/fixtures/igdb, no network.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  IGDB_IMAGE_BASE,
  igdbImage,
  pickArt,
  resizeIgdbImage,
  validImageId,
} from "../src/lib/providers/igdb/image.ts";
import {
  igdbGameId,
  isErotic,
  isoDate,
  normalizeIgdbDetail,
  normalizeIgdbGame,
  normalizeIgdbGames,
  platformFamilyOf,
} from "../src/lib/providers/igdb/normalize.ts";

const fixtures = JSON.parse(
  readFileSync(new URL("./fixtures/igdb/games.json", import.meta.url), "utf8"),
);

test("image URLs use the public CDN and validated ids only", () => {
  assert.equal(igdbImage("coaarl", "cover_big"), `${IGDB_IMAGE_BASE}/t_cover_big/coaarl.jpg`);
  assert.equal(
    igdbImage("ar5ap", "1080p", { retina: true }),
    `${IGDB_IMAGE_BASE}/t_1080p_2x/ar5ap.jpg`,
  );
  for (const bad of ["../etc", "a/b", "a.jpg", "", "x".repeat(65), null, 5, "co?x=1"]) {
    assert.equal(igdbImage(bad, "cover_big"), null, String(bad));
    assert.equal(validImageId(bad), false);
  }
  assert.equal(igdbImage("ok1", "t_original"), null);
});

test("resizeIgdbImage rewrites only IGDB CDN URLs", () => {
  const url = igdbImage("ar5ap", "screenshot_big");
  assert.equal(resizeIgdbImage(url, "720p"), `${IGDB_IMAGE_BASE}/t_720p/ar5ap.jpg`);
  assert.equal(resizeIgdbImage(url, "720p", true), `${IGDB_IMAGE_BASE}/t_720p_2x/ar5ap.jpg`);
  const other = "https://media.rawg.io/media/games/abc.jpg";
  assert.equal(resizeIgdbImage(other, "720p"), other);
});

test("art prefers artwork, then screenshot, then a blurred portrait cover", () => {
  assert.deepEqual(
    pickArt({
      artworks: [{ image_id: "bad/id" }, { image_id: "art1" }],
      screenshots: [{ image_id: "s1" }],
      cover: { image_id: "c1" },
    }),
    {
      url: `${IGDB_IMAGE_BASE}/t_screenshot_big/art1.jpg`,
      kind: "artwork",
      blur: false,
    },
  );
  assert.deepEqual(pickArt({ screenshots: [{ image_id: "s1" }], cover: { image_id: "c1" } }), {
    url: `${IGDB_IMAGE_BASE}/t_screenshot_big/s1.jpg`,
    kind: "screenshot",
    blur: false,
  });
  assert.deepEqual(pickArt({ cover: { image_id: "c1" } }), {
    url: `${IGDB_IMAGE_BASE}/t_cover_big/c1.jpg`,
    kind: "cover",
    blur: true,
  });
  assert.equal(pickArt({}), null);
});

test("normalizes a list: provider-qualified ids, no rawgId, malformed and duplicate items dropped", () => {
  const games = normalizeIgdbGames(fixtures.list);
  assert.deepEqual(
    games.map((g) => g.id),
    ["igdb:1942", "igdb:7346", "igdb:99001"],
  );
  for (const game of games) {
    assert.ok(!("rawgId" in game), "IGDB records must never carry a rawgId");
    assert.match(game.id, /^igdb:[1-9]\d*$/);
    assert.equal(game.id, igdbGameId(game.igdbId));
  }
  assert.equal(games[0].name, "The Witcher 3: Wild Hunt", "first occurrence wins");
});

test("Erotic-themed games are dropped from public lists only", () => {
  assert.ok(isErotic(fixtures.list[3]));
  assert.ok(isErotic({ themes: [42] }), "bare theme ids count too");
  assert.ok(!normalizeIgdbGames(fixtures.list).some((g) => g.slug === "adult-title"));
  assert.ok(
    normalizeIgdbGames(fixtures.list, { publicList: false }).some((g) => g.slug === "adult-title"),
  );
});

test("summary fields: dates, scores, art, platforms, ESRB", () => {
  const [witcher, zelda, coverOnly] = normalizeIgdbGames(fixtures.list);
  assert.equal(witcher.released, "2015-05-19");
  assert.equal(witcher.tba, false);
  assert.equal(witcher.criticScore, 93);
  assert.equal(witcher.criticCount, 31);
  assert.equal(witcher.userScore, 93);
  assert.equal(witcher.userCount, 4120);
  assert.equal(witcher.art.kind, "artwork");
  assert.equal(witcher.cover, `${IGDB_IMAGE_BASE}/t_cover_big/coaarl.jpg`);
  assert.deepEqual(witcher.platformFamilies, ["pc", "playstation", "xbox", "nintendo"]);
  assert.equal(witcher.esrb, "M", "ESRB is picked by organization, not PEGI");
  assert.equal(witcher.screenshots.length, 2);
  assert.deepEqual(
    witcher.genres.map((g) => g.slug),
    ["role-playing-rpg", "adventure"],
  );
  assert.equal(witcher.gameType, 0);
  assert.equal(witcher.versionParent, null);

  assert.equal(zelda.userScore, null, "a 0 rating means unrated");
  assert.equal(zelda.art.kind, "screenshot");
  assert.equal(zelda.esrb, null);

  assert.equal(coverOnly.released, null);
  assert.equal(coverOnly.tba, true);
  assert.equal(coverOnly.art.kind, "cover");
  assert.equal(coverOnly.art.blur, true);
  assert.deepEqual(coverOnly.platformFamilies, ["ios", "android", "other"]);
});

test("platform families", () => {
  assert.equal(platformFamilyOf({ id: 6 }), "pc");
  assert.equal(platformFamilyOf({ id: 167, platform_family: 1 }), "playstation");
  assert.equal(platformFamilyOf({ id: 169, platform_family: { id: 2 } }), "xbox");
  assert.equal(platformFamilyOf({ id: 500, platform_family: 3 }), "other");
  assert.equal(platformFamilyOf({}), null);
});

test("scores are clamped and rounded; bad values are null", () => {
  const g = normalizeIgdbGame({
    id: 1,
    name: "x",
    slug: "x",
    aggregated_rating: 100.4,
    rating: -3,
    rating_count: -1,
  });
  assert.equal(g.criticScore, 100);
  assert.equal(g.userScore, null);
  assert.equal(g.userCount, 0);
  assert.equal(isoDate("1431993600"), null);
  assert.equal(isoDate(Number.NaN), null);
});

test("non-array list responses normalize to an empty list", () => {
  assert.deepEqual(normalizeIgdbGames(null), []);
  assert.deepEqual(normalizeIgdbGames({ results: [] }), []);
});

test("detail: description, companies, alternative names, videos, relations", () => {
  const d = normalizeIgdbDetail(fixtures.detail);
  assert.equal(d.id, "igdb:1942");
  assert.ok(!("rawgId" in d));
  assert.equal(d.description, "RPG and sequel to the 2011 game The Witcher 2.");
  assert.equal(d.storyline, "Geralt searches for Ciri.");
  assert.equal(d.igdbUrl, "https://www.igdb.com/games/the-witcher-3-wild-hunt");
  assert.deepEqual(
    d.developers.map((c) => c.name),
    ["CD Projekt RED"],
  );
  assert.deepEqual(
    d.publishers.map((c) => c.name),
    ["CD Projekt"],
    "deduped; bare ids skipped",
  );
  assert.deepEqual(d.platforms, ["PC (Microsoft Windows)", "PlayStation 4"]);
  assert.deepEqual(
    d.alternativeNames,
    ["Wiedźmin 3: Dziki Gon"],
    "the primary name is not repeated",
  );
  assert.deepEqual(d.videos, ["c0i88t0Kacs"], "invalid video ids are dropped");
  assert.deepEqual(
    d.collections.map((c) => c.slug),
    ["the-witcher"],
  );
  assert.deepEqual(
    d.franchises.map((c) => c.slug),
    ["the-witcher"],
  );
  assert.deepEqual(d.related, {
    parent: null,
    remakes: [],
    remasters: [],
    dlcs: [12503, 12505],
    expansions: [12503, 12505],
    standaloneExpansions: [],
    similar: [472, 1877],
  });
});

test("detail keeps only https igdb.com page URLs", () => {
  assert.equal(normalizeIgdbDetail(fixtures.detailBadUrl).igdbUrl, null);
  assert.equal(
    normalizeIgdbDetail({ id: 1, name: "a", slug: "a", url: "https://evil.example/games/a" })
      .igdbUrl,
    null,
  );
  assert.equal(normalizeIgdbDetail(null), null);
});
