// @ts-nocheck -- Node's test modules are not included in the application tsconfig.
// Mocked: hand-built candidate pools; no network.
import assert from "node:assert/strict";
import test from "node:test";
import {
  candidateKeys,
  curatedKeys,
  matchCatalogEntry,
  titleKey,
} from "../src/lib/providers/igdb/catalog-match.ts";

const NOW = { nowYear: 2026 };
const c = (igdbId, slug, name, year, gameType = 0, versionParent = null) => ({
  igdbId,
  slug,
  name,
  year,
  gameType,
  versionParent,
});
const entry = (slug, expectedYear, role = "main") => ({ slug, expectedYear, role });

test("title keys fold case, punctuation and roman numerals", () => {
  assert.equal(titleKey("Assassin's Creed IV: Black Flag"), "assassins-creed-4-black-flag");
  assert.equal(titleKey("assassins-creed-iv-black-flag"), "assassins-creed-4-black-flag");
  assert.equal(titleKey("Ratchet & Clank"), "ratchet-and-clank");
  assert.equal(titleKey("Pokémon"), "pokemon");
  assert.equal(titleKey("Dark Souls III"), "dark-souls-3");
  assert.deepEqual(curatedKeys("assassins-creed-brotherhood-2"), {
    exact: "assassins-creed-brotherhood-2",
    loose: "assassins-creed-brotherhood",
  });
  assert.deepEqual(curatedKeys("the-witcher"), { exact: "the-witcher", loose: null });
  assert.ok(candidateKeys({ slug: "god-of-war--1", name: "God of War" }).has("god-of-war"));
});

test("same-named games separate by year (God of War 2005 vs 2018)", () => {
  const pool = [c(1, "god-of-war", "God of War", 2005), c(2, "god-of-war--1", "God of War", 2018)];
  const old = matchCatalogEntry(entry("god-of-war", 2005), pool, NOW);
  assert.equal(old.status, "matched");
  assert.equal(old.match.igdbId, 1);
  // RAWG's "god-of-war-2" is the 2018 game, not God of War II.
  const pool2 = [...pool, c(3, "god-of-war-ii", "God of War II", 2007)];
  const reboot = matchCatalogEntry(entry("god-of-war-2", 2018), pool2, NOW);
  assert.equal(reboot.status, "matched");
  assert.equal(reboot.match.igdbId, 2);
  const sequel = matchCatalogEntry(entry("god-of-war-ii", 2007), pool2, NOW);
  assert.equal(sequel.match.igdbId, 3);
});

test("original vs remake (Resident Evil 2, 1998 and 2019)", () => {
  const pool = [
    c(10, "resident-evil-2", "Resident Evil 2", 1998),
    c(11, "resident-evil-2--1", "Resident Evil 2", 2019, 8),
    c(12, "resident-evil", "Resident Evil", 1996),
  ];
  assert.equal(matchCatalogEntry(entry("resident-evil-2", 1998), pool, NOW).match.igdbId, 10);
  const remake = matchCatalogEntry(entry("resident-evil-2-2019", 2019, "remake"), pool, NOW);
  assert.equal(remake.status, "matched");
  assert.equal(remake.match.igdbId, 11);
  assert.deepEqual(remake.notes, []);
});

test("type disagreements are noted for review", () => {
  const pool = [c(20, "tomb-raider-anniversary", "Tomb Raider: Anniversary", 2007, 0)];
  const m = matchCatalogEntry(entry("tomb-raider-anniversary", 2007, "remake"), pool, {
    ...NOW,
    typeName: (id) => ({ 0: "main_game", 8: "remake" })[id],
  });
  assert.equal(m.status, "matched");
  assert.deepEqual(m.notes, ["curated as remake; IGDB says main_game"]);
});

test("editions lose to their base game, and are flagged when chosen", () => {
  const pool = [
    c(30, "dark-souls", "Dark Souls", 2011),
    c(31, "dark-souls-prepare-to-die-edition", "Dark Souls", 2011, 0, 30),
  ];
  const m = matchCatalogEntry(entry("dark-souls", 2011), pool, NOW);
  assert.equal(m.match.igdbId, 30);
  const onlyEdition = matchCatalogEntry(entry("dark-souls", 2011), [pool[1]], NOW);
  assert.equal(onlyEdition.status, "matched");
  assert.deepEqual(onlyEdition.notes, ["IGDB lists it as an edition of another game"]);
});

test("one-year differences need review; bigger ones are mismatches", () => {
  const pool = [c(40, "far-cry-2", "Far Cry 2", 2008)];
  const near = matchCatalogEntry(entry("far-cry-2", 2009), pool, NOW);
  assert.equal(near.status, "near_year");
  assert.equal(near.match.igdbId, 40);
  const far = matchCatalogEntry(entry("far-cry-2", 2012), pool, NOW);
  assert.equal(far.status, "year_mismatch");
  assert.equal(far.match, null);
  assert.deepEqual(
    far.candidates.map((x) => x.igdbId),
    [40],
  );
});

test("TBA entries match undated or future games only", () => {
  const pool = [c(50, "the-witcher-4", "The Witcher IV", null)];
  assert.equal(matchCatalogEntry(entry("the-witcher-4", null), pool, NOW).status, "matched");
  const future = [c(51, "the-witcher-4", "The Witcher IV", 2028)];
  assert.equal(matchCatalogEntry(entry("the-witcher-4", null), future, NOW).status, "matched");
  const past = [c(52, "the-witcher-4", "The Witcher IV", 2020)];
  assert.equal(matchCatalogEntry(entry("the-witcher-4", null), past, NOW).status, "year_mismatch");
});

test("two exact candidates are ambiguous; none is missing", () => {
  const pool = [
    c(60, "battlefield", "Battlefield", 2021),
    c(61, "battlefield--1", "Battlefield", 2021),
  ];
  const m = matchCatalogEntry(entry("battlefield", 2021), pool, NOW);
  assert.equal(m.status, "ambiguous");
  assert.equal(m.candidates.length, 2);
  assert.equal(matchCatalogEntry(entry("grand-theft-aito-vi", 2026), pool, NOW).status, "missing");
});

test("an exact-slug match wins over a looser one in the same year", () => {
  const pool = [
    c(70, "assassins-creed-brotherhood", "Assassin's Creed: Brotherhood", 2010),
    c(71, "assassins-creed-brotherhood-2", "Assassin's Creed Brotherhood 2", 2010),
  ];
  const m = matchCatalogEntry(entry("assassins-creed-brotherhood-2", 2010), pool, NOW);
  assert.equal(m.match.igdbId, 71);
  const loose = matchCatalogEntry(entry("assassins-creed-brotherhood-2", 2010), [pool[0]], NOW);
  assert.equal(loose.status, "matched");
  assert.equal(loose.match.igdbId, 70);
});

// Candidate sets observed live on 2026-11-05 (ids, names, years and game types
// copied from the dev-check report). Each case was "ambiguous" before role-fit
// ranking; each must now resolve to IGDB's base record and report what it
// passed over.
const PORT = 11;
const EXPANDED = 10;
const BUNDLE = 3;
const REMAKE = 8;
const REMASTER = 9;
const LIVE_CASES = [
  [
    "resident-evil",
    1996,
    "main",
    424,
    [
      c(424, "resident-evil", "Resident Evil", 1996),
      c(380192, "resident-evil--8", "Resident Evil", 1996, PORT),
    ],
  ],
  [
    "resident-evil-2",
    1998,
    "main",
    880,
    [
      c(186400, "resident-evil-2--2", "Resident Evil 2", 1998, PORT),
      c(217953, "resident-evil-2--4", "Resident Evil 2", 1998, PORT),
      c(880, "resident-evil-2", "Resident Evil 2", 1998),
    ],
  ],
  [
    "resident-evil-4",
    2005,
    "main",
    974,
    [
      c(974, "resident-evil-4", "Resident Evil 4", 2005),
      c(145191, "resident-evil-4--2", "Resident Evil 4", 2005, EXPANDED),
    ],
  ],
  [
    "grand-theft-auto-2-1999",
    1999,
    "main",
    819,
    [
      c(819, "grand-theft-auto-2", "Grand Theft Auto 2", 1999),
      c(200403, "grand-theft-auto-2--2", "Grand Theft Auto 2", 1999, PORT),
    ],
  ],
  [
    "tomb-raider-legend",
    2006,
    "main",
    1161,
    [
      c(165184, "tomb-raider-legend--3", "Tomb Raider: Legend", 2006, PORT),
      c(146718, "tomb-raider-legend--2", "Tomb Raider: Legend", 2006, PORT),
      c(248535, "tomb-raider-legend--4", "Tomb Raider: Legend", 2006, PORT),
      c(248536, "tomb-raider-legend--5", "Tomb Raider: Legend", 2006, PORT),
      c(1161, "tomb-raider-legend", "Tomb Raider: Legend", 2006),
    ],
  ],
  [
    "tomb-raider-underworld",
    2008,
    "main",
    1163,
    [
      c(146720, "tomb-raider-underworld--1", "Tomb Raider: Underworld", 2008, PORT),
      c(1163, "tomb-raider-underworld", "Tomb Raider: Underworld", 2008),
      c(371966, "tomb-raider-underworld--3", "Tomb Raider: Underworld", 2008, PORT),
      c(381691, "tomb-raider-underworld--4", "Tomb Raider: Underworld", 2008, PORT),
    ],
  ],
  [
    "tomb-raider-anniversary",
    2007,
    "remake",
    1162,
    [
      c(312286, "tomb-raider-anniversary--1", "Tomb Raider: Anniversary", 2007, PORT),
      c(1162, "tomb-raider-anniversary", "Tomb Raider: Anniversary", 2007, REMAKE),
      c(381690, "tomb-raider-anniversary--4", "Tomb Raider: Anniversary", 2007, PORT),
    ],
  ],
  [
    "call-of-duty-world-at-war",
    2008,
    "main",
    625,
    [
      c(343822, "call-of-duty-world-at-war--3", "Call of Duty: World at War", 2008, PORT),
      c(625, "call-of-duty-world-at-war", "Call of Duty: World at War", 2008),
      c(135296, "call-of-duty-world-at-war--2", "Call of Duty: World at War", 2008, PORT),
      c(135297, "call-of-duty-world-at-war--1", "Call of Duty: World at War", 2008, PORT),
    ],
  ],
  [
    "call-of-duty-black-ops",
    2010,
    "main",
    545,
    [
      c(545, "call-of-duty-black-ops", "Call of Duty: Black Ops", 2010),
      c(135299, "call-of-duty-black-ops--1", "Call of Duty: Black Ops", 2010, PORT),
      c(343819, "call-of-duty-black-ops--3", "Call of Duty: Black Ops", 2010, PORT),
    ],
  ],
  [
    "call-of-duty-modern-warfare-3",
    2011,
    "main",
    979,
    [
      c(287021, "call-of-duty-modern-warfare-3--1", "Call of Duty: Modern Warfare 3", 2011, PORT),
      c(979, "call-of-duty-modern-warfare-3", "Call of Duty: Modern Warfare 3", 2011),
    ],
  ],
  [
    "assassins-creed-iii-remastered",
    2019,
    "remaster",
    109532,
    [
      c(
        237701,
        "assassins-creed-iii-remastered--1",
        "Assassin's Creed III Remastered",
        2019,
        BUNDLE,
      ),
      c(
        109532,
        "assassins-creed-iii-remastered",
        "Assassin's Creed III Remastered",
        2019,
        REMASTER,
      ),
    ],
  ],
];

for (const [slug, year, role, expected, pool] of LIVE_CASES) {
  test(`live case: ${slug} resolves to the base record ${expected}`, () => {
    const m = matchCatalogEntry(entry(slug, year, role), pool, NOW);
    assert.equal(m.status, "matched");
    assert.equal(m.match.igdbId, expected);
    assert.deepEqual(
      m.passedOver.map((x) => x.igdbId).sort(),
      pool
        .filter((x) => x.igdbId !== expected)
        .map((x) => x.igdbId)
        .sort(),
      "every same-title, same-year record is reported as passed over",
    );
    assert.deepEqual(m.notes, []);
  });
}

test("the result does not depend on the order IGDB returns candidates in", () => {
  for (const [slug, year, role, expected, pool] of LIVE_CASES) {
    const reversed = matchCatalogEntry(entry(slug, year, role), [...pool].reverse(), NOW);
    assert.equal(reversed.match?.igdbId, expected, slug);
  }
});

test("role decides between a remake and its original in the same year", () => {
  const pool = [c(1, "x", "X", 2020, 0), c(2, "x--1", "X", 2020, REMAKE)];
  assert.equal(matchCatalogEntry(entry("x", 2020, "main"), pool, NOW).match.igdbId, 1);
  assert.equal(matchCatalogEntry(entry("x", 2020, "remake"), pool, NOW).match.igdbId, 2);
});

test("edition role prefers the edition record; other roles avoid it", () => {
  const pool = [c(1, "game", "Game", 2012), c(2, "game-saga", "Game", 2012, 0, 1)];
  assert.equal(matchCatalogEntry(entry("game", 2012, "edition"), pool, NOW).match.igdbId, 2);
  assert.equal(matchCatalogEntry(entry("game", 2012, "main"), pool, NOW).match.igdbId, 1);
});

test("two equally fitting ports stay ambiguous: no silent choice", () => {
  const pool = [c(1, "g--1", "G", 2008, PORT), c(2, "g--2", "G", 2008, PORT)];
  const m = matchCatalogEntry(entry("g", 2008, "main"), pool, NOW);
  assert.equal(m.status, "ambiguous");
  assert.equal(m.match, null);
  assert.deepEqual(
    m.candidates.map((x) => x.igdbId),
    [1, 2],
  );
});

test("a DLC-only match is flagged", () => {
  const m = matchCatalogEntry(entry("g", 2008, "main"), [c(1, "g", "G", 2008, 1)], NOW);
  assert.equal(m.status, "matched");
  assert.ok(m.notes.includes("only DLC, packs or similar records match"));
});
