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
