// @ts-nocheck -- Node's test modules are not included in the application tsconfig.
// Stage 5: the reviewed IGDB id mapping for the curated franchise catalog,
// checked against the catalog and against IGDB's own records (a fixture
// fetched live). No network.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { curatedSlugs, FRANCHISES } from "../src/lib/game-discovery/franchises.ts";
import {
  IGDB_FRANCHISES,
  igdbFranchiseArtwork,
  igdbFranchiseIds,
} from "../src/lib/game-discovery/franchises-igdb.ts";

const RECORDS = new Map(
  JSON.parse(
    readFileSync(new URL("./fixtures/igdb/franchise-records.json", import.meta.url), "utf8"),
  ).records.map((r) => [r.id, r]),
);
const roleOf = (def, slug) => (def.mainline.includes(slug) ? "main" : def.variants[slug]);

// ---------------------------------------------------------------------------
// The mapping

test("all 11 franchises and all 172 curated entries are mapped, nothing else", () => {
  assert.deepEqual(
    FRANCHISES.map((f) => f.id),
    [
      "assassins-creed",
      "far-cry",
      "grand-theft-auto",
      "red-dead",
      "the-witcher",
      "resident-evil",
      "tomb-raider",
      "god-of-war",
      "battlefield",
      "call-of-duty",
      "dark-souls",
    ],
  );
  assert.deepEqual(
    Object.keys(IGDB_FRANCHISES),
    FRANCHISES.map((f) => f.id),
  );
  let entries = 0;
  for (const def of FRANCHISES) {
    assert.deepEqual(
      Object.keys(IGDB_FRANCHISES[def.id].entries).sort(),
      curatedSlugs(def).sort(),
      def.id,
    );
    entries += curatedSlugs(def).length;
  }
  assert.equal(entries, 172);
});

test("ids are positive, unique across the catalog, and every one exists on IGDB", () => {
  const seen = new Map();
  for (const def of FRANCHISES) {
    for (const [id, slug] of igdbFranchiseIds(def.id)) {
      assert.ok(Number.isSafeInteger(id) && id > 0, `${def.id}/${slug}`);
      assert.ok(!seen.has(id), `igdb:${id} is both ${seen.get(id)} and ${def.id}/${slug}`);
      seen.set(id, `${def.id}/${slug}`);
      assert.ok(RECORDS.has(id), `igdb:${id} (${slug}) missing from the live record fixture`);
    }
  }
  assert.equal(seen.size, 174, "172 entries; Assassin's Creed Chronicles is three games");
});

test("the artwork game is the catalog's artwork slug, mapped", () => {
  for (const def of FRANCHISES) {
    const mapped = IGDB_FRANCHISES[def.id].entries[def.artwork];
    assert.equal(
      igdbFranchiseArtwork(def.id),
      typeof mapped === "number" ? mapped : mapped[0],
      def.id,
    );
  }
  assert.equal(igdbFranchiseArtwork("nope"), null);
});

test("game types fit the curated groups: mainline is always a main game, never an edition", () => {
  const allowed = {
    main: [0],
    spinoff: [0, 4, 11], // main, standalone expansion, port
    remake: [8],
    remaster: [3, 9, 11], // bundle (collections), remaster, port (Liberation HD)
    edition: [3, 10], // bundle (God of War Saga), expanded game
  };
  for (const def of FRANCHISES) {
    for (const [id, slug] of igdbFranchiseIds(def.id)) {
      const record = RECORDS.get(id);
      const role = roleOf(def, slug);
      assert.ok(
        allowed[role].includes(record.gameType),
        `${def.id}/${slug}: ${record.name} type ${record.gameType}`,
      );
      if (role === "main") assert.equal(record.versionParent, null, `${slug} is an edition`);
      // Never DLC, packs, updates, episodes or seasons.
      assert.ok(![1, 5, 6, 7, 13, 14].includes(record.gameType), slug);
      assert.equal(record.erotic, false, slug);
    }
  }
});

test("IGDB years match the catalog except the documented differences", () => {
  const differences = [];
  for (const def of FRANCHISES) {
    for (const [id, slug] of igdbFranchiseIds(def.id)) {
      const year = RECORDS.get(id).year;
      if (year !== def.years[slug])
        differences.push(`${def.id}/${slug}: ${year} vs ${def.years[slug]}`);
    }
  }
  assert.deepEqual(differences.sort(), [
    // China came out in 2015; India and Russia in 2016.
    "assassins-creed/assassins-creed-chronicles: 2015 vs 2016",
    "assassins-creed/assassins-creed-liberation-hd: 2014 vs 2013",
    // The game launched in 2018; RAWG dated its record 2021.
    "dark-souls/dark-souls-remastered: 2018 vs 2021",
    "red-dead/red-dead-online: 2019 vs 2018",
    "resident-evil/resident-evil-survivor-2-code-veronica: 2001 vs 2002",
    // RAWG lists it as TBA; IGDB has a date.
    "the-witcher/the-witcher-4: 2028 vs null",
  ]);
});

test("mainline release order holds on IGDB's dates", () => {
  for (const def of FRANCHISES) {
    const years = def.mainline.map((slug) => {
      const ids = [...igdbFranchiseIds(def.id)].filter(([, s]) => s === slug).map(([id]) => id);
      return RECORDS.get(ids[0]).year ?? 9999;
    });
    for (let i = 1; i < years.length; i++) {
      assert.ok(
        years[i] >= years[i - 1],
        `${def.id}: ${def.mainline[i]} before ${def.mainline[i - 1]}`,
      );
    }
  }
});

test("the reviewed decisions are pinned", () => {
  const e = (f, slug) => IGDB_FRANCHISES[f].entries[slug];
  assert.deepEqual(e("assassins-creed", "assassins-creed-chronicles"), [8223, 14902, 14903]);
  assert.ok(
    !igdbFranchiseIds("assassins-creed").has(52416),
    "the Trilogy Pack bundle isn't listed",
  );
  assert.equal(e("assassins-creed", "assassins-creed-liberation-hd"), 20864);
  assert.equal(e("assassins-creed", "assassins-creed-back-flag-resynced"), 337738);
  assert.equal(
    e("battlefield", "battlefield-6"),
    125166,
    "RAWG's battlefield-6 is Battlefield 2042",
  );
  assert.equal(e("battlefield", "battlefield-6-2"), 317407, "the 2025 Battlefield 6");
  assert.equal(e("dark-souls", "dark-souls-remastered"), 81085);
  assert.equal(e("red-dead", "red-dead-online"), 141338);
  assert.equal(
    e("resident-evil", "resident-evil-survivor-2"),
    967,
    "RAWG's -2 suffix: Survivor (2000)",
  );
  assert.equal(e("resident-evil", "resident-evil-survivor-2-code-veronica"), 19886);
  assert.equal(
    e("far-cry", "far-cry-2-fortunes-edition"),
    361,
    "the base game, not the edition 46633",
  );
  assert.equal(
    e("resident-evil", "resident-evil-5-biohazard-5"),
    847,
    "not the Gold Edition bundle",
  );
  assert.equal(e("resident-evil", "resident-evil-revelations-biohazard-revelations"), 978);
  assert.equal(e("call-of-duty", "modern-warfare-2"), 559, "2009, not 2022's Modern Warfare II");
  assert.equal(e("call-of-duty", "call-of-duty-modern-warfare-ii"), 200165);
  assert.equal(e("tomb-raider", "tomb-raider-gbc"), 36878);
  // Same-named games stay distinct ids.
  assert.notEqual(
    e("resident-evil", "resident-evil-2"),
    e("resident-evil", "resident-evil-2-2019"),
  );
  assert.notEqual(e("god-of-war", "god-of-war"), e("god-of-war", "god-of-war-2"));
});
