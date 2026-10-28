// @ts-nocheck -- Node's test modules are not included in the application tsconfig.
import assert from "node:assert/strict";
import test from "node:test";
import {
  missingCuratedSlugs,
  resolveFranchise,
  sortGames,
} from "../src/lib/game-discovery/franchise-resolve.ts";
import { FRANCHISES } from "../src/lib/game-discovery/franchises.ts";

function game(rawgId: number, slug: string, name: string, released: string | null, extra = {}) {
  return {
    rawgId,
    slug,
    name,
    released,
    tba: released === null,
    image: null,
    metacritic: null,
    rating: null,
    ratingsCount: 0,
    added: 0,
    genres: [],
    platformFamilies: [],
    esrb: null,
    shortScreenshots: [],
    ...extra,
  };
}

const names = (games) => games.map((g) => `${g.name} (${g.released?.slice(0, 4) ?? "TBA"})`);

test("same-named God of War games from different eras stay separate, in release order", () => {
  const def = {
    id: "god-of-war",
    name: "God of War",
    artwork: "god-of-war-2",
    mainline: ["god-of-war", "god-of-war-ii", "god-of-war-2"],
  };
  const resolved = resolveFranchise(def, [
    game(58175, "god-of-war-2", "God of War", "2018-04-20"),
    game(2001, "god-of-war", "God of War", "2005-03-22"),
    game(2002, "god-of-war-ii", "God of War II", "2007-03-13"),
  ]);
  assert.deepEqual(names(resolved.groups.main), [
    "God of War (2005)",
    "God of War II (2007)",
    "God of War (2018)",
  ]);
  assert.equal(resolved.mainCount, 3);
  assert.equal(resolved.firstYear, 2005);
  assert.equal(resolved.lastYear, 2018);
});

test("Tomb Raider 1996 and the 2013 reboot are both kept", () => {
  const def = {
    id: "tomb-raider",
    name: "Tomb Raider",
    artwork: "tomb-raider",
    mainline: ["tomb-raider-1996", "tomb-raider"],
  };
  const resolved = resolveFranchise(def, [
    game(5286, "tomb-raider", "Tomb Raider", "2013-03-05"),
    game(4001, "tomb-raider-1996", "Tomb Raider", "1996-10-25"),
  ]);
  assert.deepEqual(names(resolved.groups.main), ["Tomb Raider (1996)", "Tomb Raider (2013)"]);
});

test("deduplicates only by RAWG id", () => {
  const def = { id: "x", name: "X", artwork: "a", mainline: ["a", "b"] };
  const a = game(1, "a", "Alpha", "2001-01-01");
  const resolved = resolveFranchise(def, [
    a,
    a,
    { ...a },
    game(2, "b", "Beta", "2002-01-01"),
    null,
  ]);
  assert.equal(resolved.groups.main.length, 2);
});

test("classifies only by curated slugs: variants, excludes and unclassified", () => {
  const def = {
    id: "dark-souls",
    name: "Dark Souls",
    artwork: "dark-souls-iii",
    mainline: ["dark-souls", "dark-souls-iii"],
    variants: {
      "dark-souls-remastered": "remaster",
      "dark-souls-ii-scholar-of-the-first-sin": "edition",
      "demons-souls": "spinoff",
    },
    exclude: ["dark-souls-iii-ashes-of-ariandel"],
  };
  const resolved = resolveFranchise(def, [
    game(1, "dark-souls", "Dark Souls", "2011-09-22"),
    game(2, "dark-souls-iii", "Dark Souls III", "2016-03-24"),
    game(3, "dark-souls-remastered", "Dark Souls: Remastered", "2018-05-24"),
    game(4, "dark-souls-ii-scholar-of-the-first-sin", "Dark Souls II: Scholar", "2015-04-01"),
    game(5, "demons-souls", "Demon's Souls", "2009-02-05"),
    game(6, "dark-souls-iii-ashes-of-ariandel", "Ashes of Ariandel", "2016-10-24"),
    // Name looks like an edition, but runtime never guesses: it lands in "other".
    game(7, "dark-souls-ii", "Dark Souls II", "2014-03-11"),
  ]);
  assert.deepEqual(
    resolved.groups.main.map((g) => g.slug),
    ["dark-souls", "dark-souls-iii"],
  );
  assert.deepEqual(
    resolved.groups.remakes.map((g) => g.slug),
    ["dark-souls-remastered"],
  );
  assert.deepEqual(
    resolved.groups.editions.map((g) => g.slug),
    ["dark-souls-ii-scholar-of-the-first-sin"],
  );
  assert.deepEqual(
    resolved.groups.spinoffs.map((g) => g.slug),
    ["demons-souls"],
  );
  assert.deepEqual(
    resolved.groups.other.map((g) => g.slug),
    ["dark-souls-ii"],
  );
  const all = Object.values(resolved.groups)
    .flat()
    .map((g) => g.slug);
  assert.ok(!all.includes("dark-souls-iii-ashes-of-ariandel"));
});

test("release sort puts TBA last and breaks ties by name", () => {
  const sorted = sortGames(
    [
      game(1, "c", "Charlie", null),
      game(2, "b", "Bravo", "2010-05-01"),
      game(3, "a", "Alpha", "2010-05-01"),
      game(4, "d", "Delta", "2001-01-01"),
    ],
    "release",
  );
  assert.deepEqual(
    sorted.map((g) => g.name),
    ["Delta", "Alpha", "Bravo", "Charlie"],
  );
});

test("Metacritic sort puts unscored games last", () => {
  const sorted = sortGames(
    [
      game(1, "a", "A", "2001-01-01"),
      game(2, "b", "B", "2002-01-01", { metacritic: 70 }),
      game(3, "c", "C", "2003-01-01", { metacritic: 95 }),
    ],
    "metacritic",
  );
  assert.deepEqual(
    sorted.map((g) => g.name),
    ["C", "B", "A"],
  );
});

test("story order is offered and used only with curated chronology", () => {
  const games = [
    game(1, "first-released", "First Released", "2000-01-01"),
    game(2, "prequel", "Prequel", "2010-01-01"),
  ];
  const plain = { id: "x", name: "X", artwork: "a", mainline: ["first-released", "prequel"] };
  const plainResolved = resolveFranchise(plain, games, "story");
  assert.equal(plainResolved.hasStoryOrder, false);
  assert.deepEqual(
    plainResolved.groups.main.map((g) => g.slug),
    ["first-released", "prequel"],
  );

  const withStory = { ...plain, chronology: ["prequel", "first-released"] };
  const storyResolved = resolveFranchise(withStory, games, "story");
  assert.equal(storyResolved.hasStoryOrder, true);
  assert.deepEqual(
    storyResolved.groups.main.map((g) => g.slug),
    ["prequel", "first-released"],
  );
});

test("missingCuratedSlugs lists curated games absent from fetched data", () => {
  const def = {
    id: "x",
    name: "X",
    artwork: "a",
    mainline: ["a", "b"],
    variants: { c: "spinoff" },
  };
  assert.deepEqual(missingCuratedSlugs(def, ["a"]), ["b", "c"]);
  assert.deepEqual(missingCuratedSlugs(def, ["a", "b", "c"]), []);
});

test("catalog entries are well-formed and ids are unique", () => {
  const ids = new Set();
  for (const f of FRANCHISES) {
    assert.ok(!ids.has(f.id), `duplicate id ${f.id}`);
    ids.add(f.id);
    assert.ok(f.mainline.length > 0, `${f.id} has no mainline`);
    const curated = [...f.mainline, ...Object.keys(f.variants ?? {})];
    assert.equal(new Set(curated).size, curated.length, `${f.id} lists a slug twice`);
    for (const slug of curated) assert.match(slug, /^[a-z0-9-]+$/, `${f.id}: bad slug ${slug}`);
    assert.ok(curated.includes(f.artwork), `${f.id}: artwork must be a curated game`);
    assert.equal(f.chronology, undefined, "no story order ships until it is curated reliably");
    for (const slug of f.exclude ?? []) {
      assert.ok(!curated.includes(slug), `${f.id}: ${slug} is both curated and excluded`);
    }
  }
  assert.equal(FRANCHISES.length, 11);
});

test("every curated slug has an expected release year, and mainline is in release order", () => {
  for (const f of FRANCHISES) {
    const curated = [...f.mainline, ...Object.keys(f.variants ?? {})];
    assert.deepEqual(
      Object.keys(f.years).sort(),
      [...curated].sort(),
      `${f.id}: years must cover exactly the curated slugs`,
    );
    for (const [slug, year] of Object.entries(f.years)) {
      assert.ok(Number.isInteger(year) && year >= 1980 && year <= 2030, `${f.id}: ${slug} ${year}`);
    }
    const mainYears = f.mainline.map((slug) => f.years[slug]);
    assert.deepEqual(
      mainYears,
      [...mainYears].sort((a, b) => a - b),
      `${f.id} mainline order`,
    );
  }
});

test("same-named games are pinned to different years so the dev check can tell them apart", () => {
  const year = (franchise, slug) => FRANCHISES.find((f) => f.id === franchise).years[slug];
  assert.equal(year("god-of-war", "god-of-war"), 2005);
  assert.equal(year("god-of-war", "god-of-war-2"), 2018);
  assert.equal(year("tomb-raider", "tomb-raider-1996"), 1996);
  assert.equal(year("tomb-raider", "tomb-raider"), 2013);
  assert.equal(year("call-of-duty", "call-of-duty-4-modern-warfare"), 2007);
  assert.equal(year("call-of-duty", "call-of-duty-modern-warfare"), 2019);
  assert.equal(year("call-of-duty", "call-of-duty-modern-warfare-2"), 2009);
  assert.equal(year("call-of-duty", "call-of-duty-modern-warfare-ii"), 2022);
  assert.equal(year("battlefield", "battlefield-6"), 2021);
  assert.equal(year("battlefield", "battlefield-6-2"), 2025);
});

test("slugs the RAWG check showed to be wrong are no longer curated", () => {
  const all = FRANCHISES.flatMap((f) => [...f.mainline, ...Object.keys(f.variants ?? {})]);
  for (const bad of [
    "god-of-war-2005", // 404; the 2005 game is `god-of-war`
    "battlefield-2042", // redirects; the 2021 record is `battlefield-6`
    "grand-theft-auto-the-trilogy-the-definitive-edition", // 404
    "resident-evil-revelations-2", // resolves to Resident Evil (2002)
    "tomb-raider-iii-adventures-of-lara-croft", // 404
  ]) {
    assert.ok(!all.includes(bad), bad);
  }
});

test("a curated game reached through a slug redirect keeps its curated classification", () => {
  const def = {
    id: "far-cry",
    name: "Far Cry",
    artwork: "far-cry-5",
    mainline: ["far-cry", "far-cry-2", "far-cry-5"],
    variants: { "far-cry-primal": "spinoff" },
  };
  const fortunes = game(
    42,
    "far-cry-2-fortunes-edition",
    "Far Cry 2: Fortune's Edition",
    "2008-10-21",
  );
  const resolved = resolveFranchise(
    def,
    [
      game(1, "far-cry", "Far Cry", "2004-03-23"),
      fortunes, // listed by RAWG's series under its canonical slug...
      { ...fortunes }, // ...and fetched again through the curated `far-cry-2` redirect
      game(5, "far-cry-5", "Far Cry 5", "2018-03-27"),
      game(7, "primal-renamed", "Far Cry Primal", "2016-02-23"),
    ],
    "release",
    new Map([
      [42, "far-cry-2"],
      [7, "far-cry-primal"],
    ]),
  );
  assert.deepEqual(
    resolved.groups.main.map((g) => g.rawgId),
    [1, 42, 5],
  );
  assert.deepEqual(
    resolved.groups.spinoffs.map((g) => g.rawgId),
    [7],
  );
  assert.equal(resolved.groups.other.length, 0);
});

test("excludes match either the curated or the canonical slug", () => {
  const def = {
    id: "dark-souls",
    name: "Dark Souls",
    artwork: "dark-souls-iii",
    mainline: ["dark-souls-iii"],
    exclude: ["bloodborne", "old-dlc-slug"],
  };
  const resolved = resolveFranchise(
    def,
    [
      game(3, "dark-souls-iii", "Dark Souls III", "2016-03-24"),
      game(8, "bloodborne", "Bloodborne", "2015-03-24"),
      game(9, "dlc-canonical", "Some DLC", "2016-10-24"),
    ],
    "release",
    new Map([[9, "old-dlc-slug"]]),
  );
  assert.deepEqual(
    Object.values(resolved.groups)
      .flat()
      .map((g) => g.slug),
    ["dark-souls-iii"],
  );
});
