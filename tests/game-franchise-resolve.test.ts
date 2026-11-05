// @ts-nocheck -- Node's test modules are not included in the application tsconfig.
import assert from "node:assert/strict";
import test from "node:test";
import {
  missingCuratedSlugs,
  resolveFranchise,
  sortGames,
} from "../src/lib/game-discovery/franchise-resolve.ts";
import { FRANCHISES, franchiseForSlug } from "../src/lib/game-discovery/franchises.ts";
import { rawgIdOf } from "../src/lib/game-discovery/game-id.ts";

function game(rawgId: number, slug: string, name: string, released: string | null, extra = {}) {
  return {
    id: `rawg:${rawgId}`,
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
      if (year === null) continue; // unreleased, RAWG lists it as TBA
      assert.ok(Number.isInteger(year) && year >= 1980 && year <= 2030, `${f.id}: ${slug} ${year}`);
    }
    const mainYears = f.mainline.map((slug) => f.years[slug]);
    const dated = mainYears.filter((year) => year !== null);
    assert.deepEqual(
      dated,
      [...dated].sort((a, b) => a - b),
      `${f.id} mainline order`,
    );
    assert.deepEqual(
      mainYears.slice(0, dated.length),
      dated,
      `${f.id}: unreleased games come after released ones`,
    );
  }
});

test("no game is curated in two franchises, and franchise links follow the curated slugs", () => {
  const owners = new Map();
  for (const f of FRANCHISES) {
    for (const slug of [...f.mainline, ...Object.keys(f.variants ?? {})]) {
      assert.ok(!owners.has(slug), `${slug}: in ${owners.get(slug)} and ${f.id}`);
      owners.set(slug, f.id);
    }
  }
  assert.equal(franchiseForSlug("modern-warfare")?.id, "call-of-duty");
  assert.equal(franchiseForSlug("resident-evil-2-2019")?.id, "resident-evil");
  assert.equal(franchiseForSlug("bloodborne"), null);
  assert.equal(franchiseForSlug("little-nightmares-the-depths"), null);
});

test("same-named games are pinned to different years so the dev check can tell them apart", () => {
  const year = (franchise, slug) => FRANCHISES.find((f) => f.id === franchise).years[slug];
  assert.equal(year("god-of-war", "god-of-war"), 2005);
  assert.equal(year("god-of-war", "god-of-war-2"), 2018);
  assert.equal(year("tomb-raider", "tomb-raider-1996"), 1996);
  assert.equal(year("tomb-raider", "tomb-raider"), 2013);
  assert.equal(year("call-of-duty", "modern-warfare"), 2007);
  assert.equal(year("call-of-duty", "call-of-duty-modern-warfare"), 2019);
  assert.equal(year("call-of-duty", "modern-warfare-2"), 2009);
  assert.equal(year("call-of-duty", "call-of-duty-modern-warfare-ii"), 2022);
  assert.equal(year("battlefield", "battlefield-6"), 2021);
  assert.equal(year("battlefield", "battlefield-6-2"), 2025);
  assert.equal(year("resident-evil", "resident-evil-2"), 1998);
  assert.equal(year("resident-evil", "resident-evil-2-2019"), 2019);
  assert.equal(year("resident-evil", "resident-evil-4"), 2005);
  assert.equal(year("resident-evil", "resident-evil-4-2023"), 2023);
  assert.equal(year("the-witcher", "the-witcher"), 2007);
  assert.equal(year("the-witcher", "the-witcher-remake"), null);
});

// [slug, name, release date, expected group; null = hidden]
const CATALOG_CASES = {
  "resident-evil": [
    ["resident-evil-2", "Resident Evil 2", "1998-01-21", "main"],
    ["resident-evil-2-2019", "Resident Evil 2", "2019-01-25", "remakes"],
    ["resident-evil-3-nemesis", "Resident Evil 3: Nemesis", "1999-09-22", "main"],
    ["resident-evil-3", "Resident Evil 3", "2020-04-02", "remakes"],
    ["resident-evil-4", "Resident Evil 4", "2005-01-11", "main"],
    ["resident-evil-4-2023", "Resident Evil 4", "2023-03-24", "remakes"],
    ["resident-evil-zero", "Resident Evil Zero", "2002-11-12", "main"],
    ["resident-evil-0", "Resident Evil 0 / Biohazard 0 HD REMASTER", "2016-01-18", "remakes"],
    ["resident-evil-9-requiem", "Resident Evil 9: Requiem", "2026-02-27", "main"],
    ["re-revelations-2", "Resident Evil Revelations 2", "2015-02-24", "spinoffs"],
    ["resident-evil-directors-cut", "Resident Evil Director's Cut", "1997-09-25", "editions"],
    ["resident-evil-0-demake", "Resident Evil 0 Demake", "2023-06-01", null],
  ],
  "call-of-duty": [
    ["modern-warfare", "Call of Duty 4: Modern Warfare", "2007-11-05", "main"],
    ["call-of-duty-modern-warfare", "Call of Duty: Modern Warfare", "2019-10-25", "main"],
    ["call-of-duty-black-ops-7", "Call of Duty: Black Ops 7", "2025-11-13", "main"],
    ["call-of-duty-warzone", "Call of Duty: Warzone", "2020-03-10", "spinoffs"],
    ["call-of-duty-united-offensive", "Call of Duty: United Offensive", "2004-09-14", null],
    ["little-nightmares-the-depths", "Little Nightmares: The Depths", "2017-07-07", null],
  ],
  "dark-souls": [
    ["dark-souls", "Dark Souls", "2011-09-22", "main"],
    ["dark-souls-remastered", "Dark Souls Remastered", "2021-03-09", "remakes"],
    ["bloodborne", "Bloodborne", "2015-03-24", null],
    ["bloodborne-the-old-hunters", "Bloodborne: The Old Hunters", "2015-11-24", null],
    ["shadows-die-twice", "Sekiro: Shadows Die Twice", "2019-03-22", null],
    ["demons-souls", "Demon's Souls", "2009-02-05", null],
    ["dark-souls-artorias-of-the-abyss", "Dark Souls: Artorias of the Abyss", "2012-08-24", null],
  ],
  "tomb-raider": [
    ["tomb-raider-3-adventures-of-lara-croft", "Tomb Raider 3", "1998-11-21", "main"],
    ["tomb-raider-legend", "Tomb Raider: Legend", "2006-04-07", "main"],
    ["lara-croft-tomb-raider-legend", "Lara Croft Tomb Raider: Legend", "2006-04-06", null],
    ["tomb-raider-3-the-lost-artifact", "Tomb Raider 3: The Lost Artifact", "2000-03-01", null],
  ],
  battlefield: [
    ["battlefield-6", "Battlefield 2042", "2021-11-19", "main"],
    ["battlefield-6-2", "Battlefield 6", "2025-10-10", "main"],
    ["battlefield-2-mc", "Battlefield 2: Modern Combat", "2005-10-24", "spinoffs"],
    ["battlefield-2-special-forces", "Battlefield 2: Special Forces", "2005-11-18", null],
    ["battlefield", "Battlefield", "1991-01-01", null],
  ],
  "the-witcher": [
    ["the-witcher", "The Witcher", "2007-10-24", "main"],
    ["the-witcher-4", "The Witcher (A New Saga Begins)", null, "main"],
    ["the-witcher-remake", "The Witcher: Remake", null, "remakes"],
    ["gwent-thronebreaker", "Thronebreaker: The Witcher Tales", "2018-10-23", "spinoffs"],
    ["the-witcher-rise-of-the-white-wolf", "The Witcher: Rise of the White Wolf", null, null],
  ],
  "grand-theft-auto": [
    ["grand-theft-auto-1998", "Grand Theft Auto", "1997-10-21", "main"],
    ["grand-theft-aito-vi", "Grand Theft Auto VI", "2026-11-19", "main"],
    ["gta-chinatown-wars", "Grand Theft Auto: Chinatown Wars", "2009-03-17", "spinoffs"],
    ["san-andreas-multiplayer-sa-mp", "San Andreas Multiplayer (SA-MP)", "2006-05-09", null],
  ],
  "assassins-creed": [
    ["assassins-creed-rogue-2", "Assassin's Creed Rogue", "2014-11-11", "main"],
    ["assassins-creed-rogue-remastered-2", "Rogue Remastered", "2018-03-20", "remakes"],
    ["assassins-creed-pirates", "Assassin's Creed Pirates", "2013-12-05", "spinoffs"],
  ],
  "god-of-war": [
    ["god-of-war-collection", "God of War Collection", "2009-11-17", "remakes"],
    ["god-of-war-saga", "God of War Saga", "2012-08-28", "editions"],
    ["god-of-war-ragnarok-valhalla", "God of War Ragnarok: Valhalla", "2023-12-12", null],
  ],
  "far-cry": [["far-cry-2-fortunes-edition", "Far Cry 2", "2008-10-21", "main"]],
  "red-dead": [["red-dead-online", "Red Dead Online", "2018-10-26", "spinoffs"]],
};

test("the catalog classifies RAWG's series members, keeping same-titled games apart", () => {
  for (const [id, cases] of Object.entries(CATALOG_CASES)) {
    const def = FRANCHISES.find((f) => f.id === id);
    const games = cases.map(([slug, name, released], i) => game(i + 1, slug, name, released));
    const { groups } = resolveFranchise(def, games);
    const placed = new Map();
    for (const [group, list] of Object.entries(groups)) {
      for (const g of list) placed.set(g.slug, group);
    }
    for (const [slug, , , expected] of cases) {
      assert.equal(placed.get(slug) ?? null, expected, `${id}: ${slug}`);
    }
    assert.equal(groups.other.length, 0, `${id}: nothing should stay unclassified`);
  }
});

test("unreleased games sort after released ones in their group", () => {
  const def = FRANCHISES.find((f) => f.id === "the-witcher");
  const { groups, firstYear, lastYear } = resolveFranchise(def, [
    game(1, "the-witcher-4", "The Witcher (A New Saga Begins)", null),
    game(2, "the-witcher-3-wild-hunt", "The Witcher 3", "2015-05-18"),
    game(3, "the-witcher", "The Witcher", "2007-10-24"),
  ]);
  assert.deepEqual(
    groups.main.map((g) => g.slug),
    ["the-witcher", "the-witcher-3-wild-hunt", "the-witcher-4"],
  );
  assert.equal(firstYear, 2007);
  assert.equal(lastYear, 2015);
});

test("slugs the RAWG check showed to be wrong are no longer curated", () => {
  const all = FRANCHISES.flatMap((f) => [...f.mainline, ...Object.keys(f.variants ?? {})]);
  for (const bad of [
    "god-of-war-2005", // 404; the 2005 game is `god-of-war`
    "battlefield-2042", // redirects; the 2021 record is `battlefield-6`
    "grand-theft-auto-the-trilogy-the-definitive-edition", // 404
    "resident-evil-revelations-2", // resolves to Resident Evil (2002)
    "tomb-raider-iii-adventures-of-lara-croft", // 404
    // Stale slugs that only redirect: each would cost an extra request.
    "assassins-creed-brotherhood",
    "assassins-creed-iii",
    "assassins-creed-unity",
    "assassins-creed-syndicate",
    "assassins-creed-rogue",
    "far-cry-2",
    "far-cry-3-blood-dragon",
    "grand-theft-auto",
    "grand-theft-auto-2",
    "grand-theft-auto-liberty-city-stories",
    "grand-theft-auto-chinatown-wars",
    "thronebreaker-the-witcher-tales",
    "resident-evil-5",
    "resident-evil-revelations",
    "lara-croft-and-the-guardian-of-light",
    "battlefield-bad-company",
    "call-of-duty-4-modern-warfare",
    "call-of-duty-modern-warfare-2",
    "call-of-duty-black-ops-ii",
    "call-of-duty-black-ops-iii",
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
      ["rawg:42", "far-cry-2"],
      ["rawg:7", "far-cry-primal"],
    ]),
  );
  assert.deepEqual(
    resolved.groups.main.map((g) => rawgIdOf(g.id)),
    [1, 42, 5],
  );
  assert.deepEqual(
    resolved.groups.spinoffs.map((g) => rawgIdOf(g.id)),
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
    new Map([["rawg:9", "old-dlc-slug"]]),
  );
  assert.deepEqual(
    Object.values(resolved.groups)
      .flat()
      .map((g) => g.slug),
    ["dark-souls-iii"],
  );
});
