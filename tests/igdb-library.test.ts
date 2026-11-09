// @ts-nocheck -- Node's test modules are not included in the application tsconfig.
// IGDB Stage 6: IGDB games and curated franchises in the Hybrid Wishlist, next
// to existing RAWG records. Saves, collections, cross-provider identity, snapshots,
// persistence, cloud round-trips, two-device merges, account switching, and what
// a pre-IGDB build does with igdb: rows. All offline, on fakes.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test, { afterEach, beforeEach } from "node:test";
import { IGDB_FRANCHISES } from "../src/lib/game-discovery/franchises-igdb.ts";
import { FRANCHISES, curatedSlugs } from "../src/lib/game-discovery/franchises.ts";
import { gameImageKind } from "../src/lib/game-discovery/game-image.ts";
import { providerFeatures } from "../src/lib/game-discovery/provider.ts";
import { gameIdOfRef, toGameRef } from "../src/lib/game-discovery/types.ts";
import {
  GAME_QUEUE_KEY,
  gamesBackedUp,
  libraryKey,
  parseLibraryBlob,
  prepareGameHold,
  restoreHeldGames,
} from "../src/lib/game-library/backup-state.ts";
import { createSyncTracker, hydrateGameLibrary } from "../src/lib/game-library/cloud/hydrate.ts";
import { createGameQueue } from "../src/lib/game-library/cloud/queue.ts";
import {
  GAME_TABLE,
  entryToRow,
  patchToOps,
  recordToRow,
  rowToEntry,
  rowToRecord,
} from "../src/lib/game-library/cloud/rows.ts";
import {
  catalogKey,
  isPresent,
  libraryRef,
  libraryRefs,
  possibleMatches,
  recordRef,
  sameCatalogGame,
  savedEquivalent,
} from "../src/lib/game-library/identity.ts";
import {
  addCatalogGames,
  addMember,
  applyPatch,
  catalogAdditions,
  collectionSummary,
  gameStage,
  moveEntry,
  placementsOf,
  refreshSnapshot,
  removeEntry,
  restoreEntries,
  saveCollection,
  saveGame,
  savedCollection,
  setNotes,
  shiftEntry,
  startGame,
  wishlistView,
} from "../src/lib/game-library/rules.ts";
import { emptyLibrary, sanitizeEntry, sanitizeRecord } from "../src/lib/game-library/sanitize.ts";
import { snapshotSummary } from "../src/lib/game-library/snapshot.ts";
import { createGameStore } from "../src/lib/game-library/store-core.ts";
import { collectionEntryId, memberEntryId, rootEntryId } from "../src/lib/game-library/types.ts";

const src = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

const { warn, error } = console;
beforeEach(() => {
  console.warn = () => {};
  console.error = () => {};
});
afterEach(() => {
  console.warn = warn;
  console.error = error;
});

let clock = 1_762_400_000_000;
const ctx = () => ({ now: (clock += 10), random: Math.random });

const COVER = (id) => `https://images.igdb.com/igdb/image/upload/t_cover_big/${id}.jpg`;
const ART = (id) => `https://images.igdb.com/igdb/image/upload/t_1080p/${id}.jpg`;
const RAWG_ART = (n) => `https://media.rawg.io/media/games/abc/${n}.jpg`;

const igdb = (igdbId, name = `IGDB ${igdbId}`, extra = {}) => ({
  provider: "igdb",
  igdbId,
  slug: `igdb-${igdbId}`,
  name,
  released: "2020-01-01",
  image: COVER(`co${igdbId}`),
  ...extra,
});
const rawg = (rawgId, slug = `game-${rawgId}`, name = `Game ${rawgId}`, extra = {}) => ({
  provider: "rawg",
  rawgId,
  slug,
  name,
  released: "2020-01-01",
  image: RAWG_ART(rawgId),
  ...extra,
});

/** Applies a change and returns the new data, like the store does. */
function run(data, change) {
  return applyPatch(data, change(data, ctx()));
}

const AC = { franchiseId: "assassins-creed", title: "Assassin's Creed", image: ART("ac") };

// ── 1. saving IGDB games ────────────────────────────────────────────────────

test("IGDB saves are enabled, under igdb: ids, and RAWG saves are unchanged", () => {
  assert.equal(providerFeatures("igdb").librarySaves, true);
  assert.equal(providerFeatures("rawg").librarySaves, true);

  let data = emptyLibrary();
  data = run(data, (d, c) => saveGame(d, igdb(1942, "The Witcher 3"), c));
  assert.deepEqual(Object.keys(data.records), ["igdb:1942"]);
  assert.deepEqual(Object.keys(data.queue), ["g:igdb:1942"]);
  const record = data.records["igdb:1942"];
  assert.equal(record.provider, "igdb");
  assert.equal(record.igdbId, 1942);
  assert.ok(!("rawgId" in record), "an IGDB record never carries a RAWG id");
  assert.equal(gameStage(data, "igdb:1942"), "wishlist");
});

test("saving the same IGDB game twice creates nothing the second time", () => {
  let data = run(emptyLibrary(), (d, c) => saveGame(d, igdb(5), c));
  const again = saveGame(data, igdb(5), ctx());
  assert.deepEqual(again, { records: [], queue: [] });
  data = applyPatch(data, again);
  assert.equal(wishlistView(data).length, 1);
});

test("rawg:N and igdb:N with the same number are different games everywhere", () => {
  let data = emptyLibrary();
  data = run(data, (d, c) => saveGame(d, rawg(1942), c));
  data = run(data, (d, c) => saveGame(d, igdb(1942), c));
  assert.deepEqual(Object.keys(data.records).sort(), ["igdb:1942", "rawg:1942"]);
  assert.deepEqual(Object.keys(data.queue).sort(), ["g:igdb:1942", "g:rawg:1942"]);
  data = run(data, (d, c) => removeEntry(d, "g:rawg:1942", c));
  assert.equal(gameStage(data, "igdb:1942"), "wishlist", "removing one leaves the other");
  assert.equal(gameStage(data, "rawg:1942"), "none");
});

test("an IGDB save stores the approved cover; RAWG keeps its landscape art", () => {
  const summary = {
    id: "igdb:1942",
    slug: "the-witcher-3-wild-hunt",
    name: "The Witcher 3: Wild Hunt",
    released: "2015-05-19",
    tba: false,
    image: ART("ar1"),
    cover: COVER("co1"),
    heroImage: ART("hero"),
    metacritic: null,
    rating: null,
    ratingsCount: 0,
    added: 0,
    genres: [],
    platformFamilies: [],
    esrb: null,
    shortScreenshots: [],
  };
  assert.deepEqual(toGameRef(summary), {
    provider: "igdb",
    igdbId: 1942,
    slug: "the-witcher-3-wild-hunt",
    name: "The Witcher 3: Wild Hunt",
    released: "2015-05-19",
    image: COVER("co1"),
  });
  // No usable cover: the landscape art, which the Wishlist draws on a blurred fill.
  assert.equal(toGameRef({ ...summary, cover: null }).image, ART("ar1"));
  // RAWG: exactly the old shape and image.
  const rawgSummary = { ...summary, id: "rawg:3328", cover: undefined, image: RAWG_ART(1) };
  delete rawgSummary.cover;
  delete rawgSummary.heroImage;
  assert.deepEqual(toGameRef(rawgSummary), {
    provider: "rawg",
    rawgId: 3328,
    slug: "the-witcher-3-wild-hunt",
    name: "The Witcher 3: Wild Hunt",
    released: "2015-05-19",
    image: RAWG_ART(1),
  });
});

// ── 2. snapshots ────────────────────────────────────────────────────────────

test("a RAWG snapshot has exactly the keys it had before IGDB", () => {
  const data = run(emptyLibrary(), (d, c) => saveGame(d, rawg(42), c));
  assert.deepEqual(Object.keys(snapshotSummary(data.records["rawg:42"])), [
    "id",
    "slug",
    "name",
    "released",
    "tba",
    "image",
    "metacritic",
    "rating",
    "ratingsCount",
    "added",
    "genres",
    "platformFamilies",
    "esrb",
    "shortScreenshots",
  ]);
});

test("an IGDB snapshot paints its cover as a portrait, never as the hero", () => {
  let data = run(emptyLibrary(), (d, c) => saveGame(d, igdb(7), c));
  const covered = snapshotSummary(data.records["igdb:7"]);
  assert.equal(covered.id, "igdb:7");
  assert.equal(covered.cover, COVER("co7"));
  assert.equal(covered.imageKind, "portrait");
  assert.equal(covered.heroImage, null, "so the page uses a blurred fill");

  data = run(emptyLibrary(), (d, c) => saveGame(d, igdb(8, "No cover", { image: ART("a8") }), c));
  const landscape = snapshotSummary(data.records["igdb:8"]);
  assert.equal(landscape.cover, null);
  assert.equal(landscape.imageKind, undefined);
  assert.equal(landscape.image, ART("a8"));

  data = run(emptyLibrary(), (d, c) => saveGame(d, igdb(9, "No art", { image: null }), c));
  const bare = snapshotSummary(data.records["igdb:9"]);
  assert.equal(bare.image, null);
  assert.equal(bare.cover, null);
});

test("image kinds come from Nexa's own URL formats", () => {
  assert.equal(gameImageKind(COVER("x")), "cover");
  assert.equal(gameImageKind(COVER("x").replace("t_cover_big", "t_cover_big_2x")), "cover");
  assert.equal(gameImageKind(ART("x")), "landscape");
  assert.equal(gameImageKind(RAWG_ART(1)), "landscape");
  // A RAWG path that merely contains the text is still RAWG art.
  assert.equal(gameImageKind("https://media.rawg.io/media/t_cover_x.jpg"), "landscape");
  assert.equal(gameImageKind(null), null);
});

test("a corrupt IGDB snapshot fails safe instead of breaking the Wishlist", () => {
  const record = sanitizeRecord({
    gameId: "igdb:77",
    name: 12,
    slug: null,
    released: { y: 2020 },
    image: ["x"],
    metaAt: "not a number",
    notes: 5,
  });
  assert.equal(record.gameId, "igdb:77");
  assert.equal(record.name, "");
  assert.equal(record.image, null);
  assert.equal(record.released, null);
  assert.equal(record.metaAt, 0);
  const summary = snapshotSummary(record);
  assert.equal(summary.cover, null);
  assert.equal(summary.imageKind, undefined);
});

test("refreshing an IGDB snapshot keeps every personal value and the order", () => {
  let data = emptyLibrary();
  data = run(data, (d, c) => saveGame(d, igdb(1), c));
  data = run(data, (d, c) => saveGame(d, igdb(2), c));
  data = run(data, (d, c) => setNotes(d, "igdb:2", "my note", c));
  data = run(data, (d, c) => moveEntry(d, "g:igdb:2", 0, c));
  const before = structuredClone(data);
  data = run(data, (d, c) => refreshSnapshot(d, igdb(2, "Renamed", { image: COVER("new") }), c));
  const after = data.records["igdb:2"];
  assert.equal(after.name, "Renamed");
  assert.equal(after.image, COVER("new"));
  assert.equal(after.notes, "my note");
  assert.equal(after.notesAt, before.records["igdb:2"].notesAt);
  assert.deepEqual(data.queue, before.queue, "no queue row is touched");
  // A missing image in a refresh never blanks the saved one.
  data = run(data, (d, c) => refreshSnapshot(d, igdb(2, "Renamed", { image: null }), c));
  assert.equal(data.records["igdb:2"].image, COVER("new"));
});

// ── 3. malformed identifiers ────────────────────────────────────────────────

test("malformed IGDB ids never reach the library", () => {
  for (const id of ["igdb:0", "igdb:01", "igdb:-1", "IGDB:1", "igdb:1.5", "igdb:", "igdb:abc"]) {
    assert.equal(sanitizeRecord({ gameId: id, name: "x" }), null, id);
    assert.equal(
      sanitizeEntry({ entryId: `g:${id}`, kind: "game", gameId: id, position: "U" }),
      null,
      id,
    );
  }
  // A collection row needs no game id, so a stray one is simply dropped.
  const collection = sanitizeEntry({
    entryId: "c:far-cry",
    kind: "collection",
    gameId: "igdb:x",
    position: "U",
  });
  assert.equal(collection.gameId, null);
});

// ── 4. cross-provider identity ──────────────────────────────────────────────

test("the catalog links exactly the one-to-one slugs, both ways", () => {
  let single = 0;
  let multi = 0;
  const ids = new Map();
  for (const map of Object.values(IGDB_FRANCHISES)) {
    for (const [slug, value] of Object.entries(map.entries)) {
      if (typeof value === "number") {
        single++;
        assert.equal(catalogKey({ gameId: "rawg:1", slug }), value, slug);
        assert.equal(catalogKey({ gameId: `igdb:${value}`, slug: "anything" }), value, slug);
        assert.ok(!ids.has(value), `IGDB id ${value} is reviewed for one slug only`);
        ids.set(value, slug);
      } else {
        multi++;
        assert.equal(catalogKey({ gameId: "rawg:1", slug }), null, `${slug} names several games`);
        for (const id of value) assert.equal(catalogKey({ gameId: `igdb:${id}`, slug }), null);
      }
    }
  }
  assert.equal(single, 171);
  assert.equal(multi, 1);
  // Every curated slug is a slug of the catalog, so links follow the catalog.
  const curated = new Set(FRANCHISES.flatMap(curatedSlugs));
  for (const slug of ids.values()) assert.ok(curated.has(slug), slug);
});

test("Assassin's Creed Chronicles stays three separate games, linked to nothing", () => {
  const chronicles = rawg(900, "assassins-creed-chronicles", "Assassin's Creed Chronicles");
  for (const id of [8223, 14902, 14903]) {
    assert.equal(
      sameCatalogGame(
        { gameId: "rawg:900", slug: chronicles.slug },
        { gameId: `igdb:${id}`, slug: "" },
      ),
      false,
    );
  }
  let data = run(emptyLibrary(), (d, c) => saveGame(d, chronicles, c));
  data = run(data, (d, c) => saveCollection(d, AC, [], [], c));
  const collection = collectionEntryId(AC.franchiseId);
  for (const id of [8223, 14902, 14903]) {
    data = run(data, (d, c) => addMember(d, collection, libraryRef(d, igdb(id)), c));
  }
  assert.deepEqual(
    collectionSummary(data, collection).members.map((m) => m.record.gameId),
    ["igdb:8223", "igdb:14902", "igdb:14903"],
  );
  assert.equal(gameStage(data, "rawg:900"), "wishlist", "the RAWG record is untouched");
});

test("remakes, remasters and editions never link to the original", () => {
  const pairs = [
    ["resident-evil-2", 19686], // RE2 (1998) vs the 2019 remake
    ["resident-evil-4", 132181], // RE4 (2005) vs the 2023 remake
    ["god-of-war", 19560], // God of War (2005) vs (2018)
    ["dark-souls", 81085], // Dark Souls vs Remastered
    ["dark-souls-ii", 8222], // Dark Souls II vs Scholar of the First Sin
    ["assassins-creed-iii-2", 109532], // AC III vs AC III Remastered
    ["assassins-creed-iv-black-flag", 337738], // Black Flag vs Resynced
  ];
  for (const [slug, other] of pairs) {
    const original = { gameId: "rawg:1", slug };
    assert.notEqual(catalogKey(original), null, slug);
    assert.equal(sameCatalogGame(original, { gameId: `igdb:${other}`, slug: "" }), false, slug);
  }
  // And each is still the same game as its own reviewed id.
  assert.equal(
    sameCatalogGame(
      { gameId: "rawg:1", slug: "resident-evil-2-2019" },
      { gameId: "igdb:19686", slug: "" },
    ),
    true,
  );
});

test("a game saved from RAWG is recognised on its IGDB page, and only by the catalog", () => {
  // Assassin's Creed II: curated slug assassins-creed-ii, reviewed IGDB id 127.
  let data = run(emptyLibrary(), (d, c) => saveGame(d, rawg(4200, "assassins-creed-ii"), c));
  const hit = savedEquivalent(data, { gameId: "igdb:127", slug: "assassins-creed-ii" });
  assert.equal(hit.gameId, "rawg:4200");
  // A same-named but uncurated RAWG record is not an identity.
  assert.equal(savedEquivalent(data, { gameId: "igdb:128", slug: "assassins-creed" }), null);
  // Once the RAWG entry is removed it no longer counts as saved.
  data = run(data, (d, c) => removeEntry(d, "g:rawg:4200", c));
  assert.equal(savedEquivalent(data, { gameId: "igdb:127", slug: "x" }), null);
  // The IGDB game's own record wins when both are listed.
  data = run(data, (d, c) => restoreEntries(d, ["g:rawg:4200"], c));
  data = run(data, (d, c) => saveGame(d, igdb(127), c));
  assert.equal(savedEquivalent(data, { gameId: "igdb:127", slug: "x" }), null);
});

test("saving a game already saved from RAWG reuses that record and adds no duplicate", () => {
  let data = run(emptyLibrary(), (d, c) =>
    saveGame(d, rawg(4200, "assassins-creed-ii", "Assassin's Creed II"), c),
  );
  data = run(data, (d, c) => setNotes(d, "rawg:4200", "Ezio first", c));
  const before = structuredClone(data);
  const patch = saveGame(data, libraryRef(data, igdb(127, "Assassin's Creed II")), ctx());
  assert.deepEqual(patch, { records: [], queue: [] }, "already in the Wishlist");
  assert.equal(libraryRef(data, igdb(127)).provider, "rawg");
  assert.deepEqual(libraryRef(data, igdb(127)), recordRef(data.records["rawg:4200"]));
  assert.deepEqual(data, before, "snapshot, notes and order untouched");
  // A game the catalog doesn't link is saved under its own id, as usual.
  assert.deepEqual(libraryRef(data, igdb(999)), igdb(999));
});

test("starting an IGDB game already saved from RAWG plays that record, adding none", () => {
  let data = run(emptyLibrary(), (d, c) =>
    saveGame(d, rawg(4200, "assassins-creed-ii", "Assassin's Creed II"), c),
  );
  data = run(data, (d, c) => setNotes(d, "rawg:4200", "Ezio first", c));
  data = run(data, (d, c) => startGame(d, libraryRef(d, igdb(127, "Assassin's Creed II")), c));
  assert.deepEqual(Object.keys(data.records), ["rawg:4200"], "one record, the saved one");
  assert.equal(data.records["rawg:4200"].status, "playing");
  assert.equal(data.records["rawg:4200"].notes, "Ezio first");
  // An IGDB game the catalog doesn't link starts under its own id.
  data = run(data, (d, c) => startGame(d, libraryRef(d, igdb(999)), c));
  assert.equal(data.records["igdb:999"].status, "playing");
});

test("adding an IGDB game to a collection that holds its RAWG version is a no-op", () => {
  let data = run(emptyLibrary(), (d, c) =>
    saveCollection(d, AC, [rawg(4200, "assassins-creed-ii")], ["assassins-creed-ii"], c),
  );
  const collection = collectionEntryId(AC.franchiseId);
  const patch = addMember(data, collection, libraryRef(data, igdb(127)), ctx());
  assert.deepEqual(patch, { records: [], queue: [] });
  assert.deepEqual(
    placementsOf(data, "rawg:4200").collections.map((c) => c.entryId),
    [collection],
  );
});

test("possible matches outside the catalog are offered, never linked", () => {
  let data = run(emptyLibrary(), (d, c) =>
    saveGame(d, rawg(1, "hades", "Hades", { released: "2020-09-17" }), c),
  );
  const game = { gameId: "igdb:113112", slug: "hades--1", name: "HADES", released: "2020-09-17" };
  assert.deepEqual(
    possibleMatches(data, game).map((r) => r.gameId),
    ["rawg:1"],
  );
  assert.equal(savedEquivalent(data, game), null, "not an identity");
  assert.equal(gameStage(data, "igdb:113112"), "none", "not treated as saved");
  // A different year is a different game (a remake, a reboot).
  assert.deepEqual(possibleMatches(data, { ...game, released: "2024-05-06" }), []);
  // No year, no suggestion.
  assert.deepEqual(possibleMatches(data, { ...game, released: null }), []);
  // The catalog knows the IGDB game: it already said what it is.
  data = run(data, (d, c) =>
    saveGame(d, rawg(2, "some-rawg-slug", "Resident Evil 2", { released: "1998-01-21" }), c),
  );
  assert.deepEqual(
    possibleMatches(data, {
      gameId: "igdb:880",
      slug: "x",
      name: "Resident Evil 2",
      released: "1998-01-21",
    }),
    [],
  );
  // The catalog knows the RAWG record (as another IGDB game): not offered either.
  data = run(data, (d, c) =>
    saveGame(d, rawg(3, "resident-evil-2-2019", "Resident Evil 2", { released: "2019-01-25" }), c),
  );
  assert.deepEqual(
    possibleMatches(data, {
      gameId: "igdb:5",
      slug: "x",
      name: "Resident Evil 2",
      released: "2019-01-25",
    }),
    [],
  );
});

test("the identity index is built once per library snapshot", () => {
  const data = run(emptyLibrary(), (d, c) => saveGame(d, igdb(1), c));
  assert.equal(isPresent(data, "igdb:1"), true);
  assert.equal(isPresent(data, "igdb:2"), false);
  const code = src("lib/game-library/identity.ts");
  assert.match(code, /const indexes = new WeakMap<GameLibraryData, LibraryIndex>\(\);/);
  assert.doesNotMatch(code, /supabase|changeGameLibrary|localStorage|fetch\(/);
});

// ── 5. curated franchise collections ────────────────────────────────────────

const AC_MAIN = IGDB_FRANCHISES["assassins-creed"].entries;
const acRefs = (slugs) => slugs.map((slug) => igdb(AC_MAIN[slug], slug, { slug: `igdb-${slug}` }));

test("an IGDB franchise saves as one collection with IGDB members in catalog order", () => {
  const def = FRANCHISES.find((f) => f.id === "assassins-creed");
  const refs = acRefs(def.mainline);
  let data = run(emptyLibrary(), (d, c) =>
    saveCollection(d, AC, libraryRefs(d, refs), def.mainline, c),
  );
  const collection = collectionEntryId(AC.franchiseId);
  const members = collectionSummary(data, collection).members.map((m) => m.record.gameId);
  assert.deepEqual(
    members,
    def.mainline.map((slug) => `igdb:${AC_MAIN[slug]}`),
  );
  assert.ok(members.every((id) => id.startsWith("igdb:")));
  assert.equal(catalogAdditions(savedCollection(data, AC.franchiseId), def.mainline).length, 0);
  // Saving again while it's saved changes nothing.
  assert.deepEqual(saveCollection(data, AC, refs, def.mainline, ctx()), { records: [], queue: [] });
  // Members reorder inside the collection, and the collection among root entries.
  data = run(data, (d, c) => saveGame(d, igdb(1942), c));
  data = run(data, (d, c) => moveEntry(d, memberEntryId(collection, members[2]), 0, c));
  assert.equal(collectionSummary(data, collection).members[0].record.gameId, members[2]);
  data = run(data, (d, c) => moveEntry(d, "g:igdb:1942", 0, c));
  assert.deepEqual(
    wishlistView(data).map((i) => i.entry.entryId),
    ["g:igdb:1942", collection],
  );
  // Removing a member, and the collection, both undo exactly.
  const memberId = memberEntryId(collection, members[0]);
  const removeMember = removeEntry(data, memberId, ctx());
  data = applyPatch(data, removeMember);
  assert.equal(collectionSummary(data, collection).members.length, members.length - 1);
  data = run(data, (d, c) => restoreEntries(d, [memberId], c));
  assert.equal(collectionSummary(data, collection).members.length, members.length);
  const removeAll = removeEntry(data, collection, ctx());
  data = applyPatch(data, removeAll);
  assert.equal(savedCollection(data, AC.franchiseId), null);
  const ids = removeAll.queue.map((e) => e.entryId);
  data = run(data, (d, c) => restoreEntries(d, ids, c));
  assert.equal(collectionSummary(data, collection).members.length, members.length);
});

test("a RAWG-saved franchise stays the one collection on its IGDB page", () => {
  const def = FRANCHISES.find((f) => f.id === "assassins-creed");
  const first = def.mainline.slice(0, 3);
  // Saved from RAWG before the catalog grew: seen only the first three slugs.
  let data = run(emptyLibrary(), (d, c) =>
    saveCollection(
      d,
      AC,
      first.map((slug, i) => rawg(100 + i, slug, slug)),
      first,
      c,
    ),
  );
  const collection = collectionEntryId(AC.franchiseId);
  const before = collectionSummary(data, collection).members.map((m) => m.entry);

  // The IGDB page: saving is refused, so there is never a second collection.
  const saved = savedCollection(data, AC.franchiseId);
  assert.ok(saved);
  assert.deepEqual(
    saveCollection(data, AC, libraryRefs(data, acRefs(def.mainline)), def.mainline, ctx()),
    { records: [], queue: [] },
  );

  // "Add N new games" offers only slugs never seen, and adds them as IGDB games.
  const offered = catalogAdditions(saved, def.mainline);
  assert.deepEqual(offered, def.mainline.slice(3));
  // The page offers by slug; even if every mainline game were passed, RAWG
  // members resolve to themselves and are skipped as already there.
  data = run(data, (d, c) =>
    addCatalogGames(d, collection, libraryRefs(d, acRefs(def.mainline)), offered, c),
  );
  const after = collectionSummary(data, collection).members;
  assert.equal(after.length, def.mainline.length, "no duplicate of any game");
  assert.deepEqual(
    after.slice(0, 3).map((m) => m.entry),
    before,
    "the RAWG members and their order are untouched",
  );
  assert.ok(after.slice(3).every((m) => m.record.gameId.startsWith("igdb:")));
  assert.equal(catalogAdditions(savedCollection(data, AC.franchiseId), def.mainline).length, 0);
});

test("saving an IGDB collection reuses a game already standalone from RAWG", () => {
  const def = FRANCHISES.find((f) => f.id === "assassins-creed");
  let data = run(emptyLibrary(), (d, c) => saveGame(d, rawg(4200, "assassins-creed-ii"), c));
  data = run(data, (d, c) =>
    saveCollection(d, AC, libraryRefs(d, acRefs(def.mainline)), def.mainline, c),
  );
  const collection = collectionEntryId(AC.franchiseId);
  const ids = collectionSummary(data, collection).members.map((m) => m.record.gameId);
  assert.ok(ids.includes("rawg:4200"));
  assert.ok(!ids.includes("igdb:127"), "no second record for AC II");
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(placementsOf(data, "rawg:4200"), {
    standalone: true,
    collections: [savedCollection(data, AC.franchiseId)],
  });
});

// ── 6. mixed-provider Wishlist ──────────────────────────────────────────────

test("a Wishlist with both providers orders, moves and removes as one queue", () => {
  let data = emptyLibrary();
  data = run(data, (d, c) => saveGame(d, rawg(1), c));
  data = run(data, (d, c) => saveGame(d, igdb(2), c));
  data = run(data, (d, c) => saveGame(d, rawg(3), c));
  data = run(data, (d, c) => saveGame(d, igdb(4), c));
  const ids = () => wishlistView(data).map((i) => i.record.gameId);
  assert.deepEqual(ids(), ["rawg:1", "igdb:2", "rawg:3", "igdb:4"]);
  data = run(data, (d, c) => shiftEntry(d, "g:igdb:4", -2, c));
  assert.deepEqual(ids(), ["rawg:1", "igdb:4", "igdb:2", "rawg:3"]);
  const removed = removeEntry(data, "g:igdb:4", ctx());
  data = applyPatch(data, removed);
  assert.deepEqual(ids(), ["rawg:1", "igdb:2", "rawg:3"]);
  data = run(data, (d, c) => restoreEntries(d, ["g:igdb:4"], c));
  assert.deepEqual(ids(), ["rawg:1", "igdb:4", "igdb:2", "rawg:3"], "Undo puts it back in place");
  assert.deepEqual(
    wishlistView(data).map((i) => snapshotSummary(i.record).imageKind ?? "landscape"),
    ["landscape", "portrait", "portrait", "landscape"],
  );
});

test("the Wishlist draws cards in the active provider's shape and sends nothing", () => {
  const tab = src("views/game-library/wishlist-tab.tsx");
  assert.match(tab, /const shape = providerFeatures\(useActiveGameProvider\(\)\)\.cards;/);
  assert.match(
    tab,
    /<WishlistList items=\{items\} expanded=\{expanded\} onToggle=\{toggle\} shape=\{shape\} \/>/,
  );
  const hook = src("lib/game-discovery/use-active-provider.ts");
  assert.doesNotMatch(hook, /queries|use-rawg|useQuery|invoke\(|igdbStatus/);
  const art = src("views/game-library/game-art.tsx");
  assert.match(art, /ratio=\{shape\}/);
  assert.match(art, /kind === "cover" && shape === "landscape" && <PortraitFill/);
  assert.match(art, /kind === "landscape" && shape === "cover" && \(\s*<LandscapeFill/);
  const footer = src("views/game-library.tsx");
  assert.match(
    footer,
    /for \(const record of Object\.values\(data\.records\)\) used\.add\(record\.provider\);/,
  );
});

// ── 7. local persistence ────────────────────────────────────────────────────

function fakeStorage(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    has: (key) => map.has(key),
  };
}

function storeOn(storage, { read } = {}) {
  return createGameStore({
    read: read ?? ((key) => storage.getItem(key)),
    write: (key, value) => {
      storage.setItem(key, value);
      return true;
    },
    remove: (key) => storage.removeItem(key),
    now: () => (clock += 5),
    random: Math.random,
    isPlaceholderProfile: () => false,
  });
}

test("a mixed library survives a restart unchanged", () => {
  const storage = fakeStorage();
  const first = storeOn(storage);
  first.apply("p1", (d, c) => saveGame(d, rawg(1), c));
  first.apply("p1", (d, c) => saveGame(d, igdb(2), c));
  first.apply("p1", (d, c) => saveCollection(d, AC, [igdb(128), igdb(127)], ["a", "b"], c));
  first.apply("p1", (d, c) => moveEntry(d, "g:igdb:2", 0, c));

  const second = storeOn(storage); // a fresh app start
  const data = second.snapshot("p1");
  assert.deepEqual(data, first.snapshot("p1"));
  assert.equal(second.isUnsynced("p1"), true);
  assert.deepEqual(
    wishlistView(data).map((i) => i.entry.entryId),
    ["g:igdb:2", "g:rawg:1", collectionEntryId(AC.franchiseId)],
  );
});

test("the pre-IGDB legacy blob reads back with every RAWG record intact", () => {
  // game-identity.test.ts proves the byte-for-byte round trip; this pins that
  // Stage 6 links and resolves nothing in it.
  const legacy = readFileSync(
    new URL("./fixtures/game-library-legacy-blob.json", import.meta.url),
    "utf8",
  );
  const parsed = parseLibraryBlob(legacy);
  const raw = JSON.parse(legacy);
  assert.deepEqual(Object.keys(parsed.records).sort(), Object.keys(raw.records).sort());
  for (const [id, record] of Object.entries(raw.records)) {
    assert.deepEqual(parsed.records[id], record, id);
    assert.deepEqual(recordRef(parsed.records[id]), recordRef(record));
  }
  const witcher = parsed.records["rawg:3328"];
  assert.equal(snapshotSummary(witcher).image, witcher.image, "RAWG art is shown as saved");
});

// ── 8. cloud: rows, queue, two devices, accounts ────────────────────────────

const OWNER = { userId: "user-a", profileId: "p1" };

test("IGDB rows map to and from the cloud without losing anything", () => {
  let data = run(emptyLibrary(), (d, c) =>
    saveCollection(d, AC, [igdb(128)], ["assassins-creed"], c),
  );
  data = run(data, (d, c) => saveGame(d, igdb(1942), c));
  data = run(data, (d, c) => setNotes(d, "igdb:1942", "note", c));
  for (const record of Object.values(data.records)) {
    const row = recordToRow(OWNER, record);
    assert.equal(row.game_id, record.gameId);
    assert.deepEqual(rowToRecord(row), record);
  }
  for (const entry of Object.values(data.queue)) {
    const row = entryToRow(OWNER, entry);
    assert.deepEqual(rowToEntry(row), entry);
  }
  const ops = patchToOps(OWNER, {
    records: Object.values(data.records),
    queue: Object.values(data.queue),
  });
  assert.deepEqual(ops.map((op) => op.key).sort(), [
    "c:assassins-creed",
    "c:assassins-creed|igdb:128",
    "g:igdb:1942",
    "igdb:128",
    "igdb:1942",
  ]);
});

/** Behaves like the Supabase tables, including the merge triggers and RLS by owner. */
function fakeCloud() {
  const tables = { [GAME_TABLE.library]: new Map(), [GAME_TABLE.queue]: new Map() };
  const cloud = {
    tables,
    failWith: null,
    failOnce: 0,
    sent: [],
    keyOf: (table, row) =>
      `${row.user_id}|${row.profile_id}|${table === GAME_TABLE.library ? row.game_id : row.entry_id}`,
    async send(table, rows) {
      if (cloud.failOnce > 0) {
        cloud.failOnce--;
        return { code: "08006", message: "network" };
      }
      if (cloud.failWith) return cloud.failWith;
      cloud.sent.push(...rows.map((r) => ({ table, row: structuredClone(r) })));
      for (const incoming of rows) {
        const key = cloud.keyOf(table, incoming);
        const stored = tables[table].get(key);
        const next = structuredClone(incoming);
        if (stored) {
          const keepOlder = (stamp, fields) => {
            if (next[stamp] < stored[stamp]) for (const f of fields) next[f] = stored[f];
          };
          if (table === GAME_TABLE.queue) {
            keepOlder("updated_at", [
              "parent_id",
              "kind",
              "game_id",
              "franchise_id",
              "title",
              "image",
              "catalog_seen",
              "position",
              "added_at",
              "updated_at",
            ]);
            keepOlder("live_at", ["deleted_at", "live_at"]);
          } else {
            keepOlder("meta_at", ["slug", "name", "released", "image", "meta_at"]);
            keepOlder("state_at", ["status", "started_at", "completed_at", "state_at"]);
            keepOlder("progress_at", ["progress_enabled", "progress", "progress_at"]);
            keepOlder("notes_at", ["notes", "notes_at"]);
            keepOlder("tier_at", ["tier", "tier_position", "tier_at"]);
          }
        }
        tables[table].set(key, next);
      }
      return null;
    },
    async pull(table, owner, from, to) {
      if (cloud.failWith) return { rows: [], error: cloud.failWith };
      const rows = [...tables[table].values()]
        .filter((r) => r.user_id === owner.userId && r.profile_id === owner.profileId)
        .sort((a, b) => (cloud.keyOf(table, a) < cloud.keyOf(table, b) ? -1 : 1))
        .slice(from, to + 1);
      return { rows: structuredClone(rows), error: null };
    },
  };
  return cloud;
}

/**
 * A device. `preIgdb` reproduces a build from before IGDB (feature/game-library
 * at 303370a7): its reader keeps only ids matching /^rawg:[1-9]\d*$/, on disk and
 * from the cloud. Merge, hydrate and the queue are unchanged since that commit.
 */
function device(cloud, { owner = OWNER, storage = fakeStorage(), preIgdb = false } = {}) {
  const OLD_ID = /^rawg:[1-9]\d*$/;
  const oldFilter = (raw) => {
    if (!raw) return raw;
    const blob = JSON.parse(raw);
    for (const [k, r] of Object.entries(blob.records ?? {}))
      if (!OLD_ID.test(r.gameId)) delete blob.records[k];
    for (const [k, e] of Object.entries(blob.queue ?? {})) {
      if (e.kind === "game" && !OLD_ID.test(e.gameId)) delete blob.queue[k];
    }
    return JSON.stringify(blob);
  };
  const store = storeOn(storage, {
    read: preIgdb ? (key) => oldFilter(storage.getItem(key)) : undefined,
  });
  const tracker = createSyncTracker((o) => store.markSynced(o.profileId));
  const queue = createGameQueue({
    load: () => storage.getItem(GAME_QUEUE_KEY),
    save: (payload) => storage.setItem(GAME_QUEUE_KEY, payload),
    send: (table, rows) => cloud.send(table, rows),
    userId: () => owner.userId,
    refreshSession: async () => true,
    setTimer: () => 0,
    clearTimer: () => {},
    onDrained: tracker.drained,
  });
  const pull = async (table, o, from, to) => {
    const result = await cloud.pull(table, o, from, to);
    if (!preIgdb) return result;
    // The old reader got every row (so paging is unchanged) and dropped the
    // ones its id pattern rejects when it read them: blank those ids here.
    const rows = result.rows.map((row) => {
      const drop =
        table === GAME_TABLE.library
          ? !OLD_ID.test(row.game_id)
          : row.kind === "game" && !OLD_ID.test(row.game_id);
      return drop ? { ...row, game_id: "unreadable" } : row;
    });
    return { ...result, rows };
  };
  const d = {
    store,
    queue,
    storage,
    online: true,
    get data() {
      return store.snapshot(owner.profileId);
    },
    change(fn) {
      const patch = store.apply(owner.profileId, fn);
      if (d.online) queue.enqueue(patchToOps(owner, patch));
      return patch;
    },
    sync: () =>
      hydrateGameLibrary({
        owner,
        pull,
        drain: () => queue.drain(),
        enqueue: (ops) => queue.enqueue(ops),
        merge: (remote) => store.merge(owner.profileId, remote),
        isCurrent: () => true,
        markBlocked: () => queue.markBlocked(owner),
        onReconciled: () => tracker.reconciled(owner),
      }),
  };
  return d;
}

const ids = (d) =>
  wishlistView(d.data).map((i) => (i.kind === "game" ? i.record.gameId : i.entry.entryId));

async function settle(...devices) {
  for (let round = 0; round < 2; round++) for (const d of devices) await d.sync();
}

test("IGDB saves reach a second device with order, collections and notes", async () => {
  const cloud = fakeCloud();
  const a = device(cloud);
  const b = device(cloud);
  a.change((d, c) => saveGame(d, rawg(1), c));
  a.change((d, c) => saveGame(d, igdb(2), c));
  a.change((d, c) => saveCollection(d, AC, [igdb(128), igdb(127)], ["x"], c));
  a.change((d, c) => setNotes(d, "igdb:2", "from A", c));
  a.change((d, c) => moveEntry(d, "g:igdb:2", 0, c));
  await settle(a, b);
  assert.deepEqual(ids(b), ["igdb:2", "rawg:1", "c:assassins-creed"]);
  assert.equal(b.data.records["igdb:2"].notes, "from A");
  assert.deepEqual(
    collectionSummary(b.data, "c:assassins-creed").members.map((m) => m.record.gameId),
    ["igdb:128", "igdb:127"],
  );
  assert.deepEqual(a.data, b.data);
});

test("conflicting IGDB edits on two devices converge without losing either", async () => {
  const cloud = fakeCloud();
  const a = device(cloud);
  const b = device(cloud);
  a.change((d, c) => saveGame(d, igdb(1), c));
  a.change((d, c) => saveGame(d, igdb(2), c));
  a.change((d, c) => saveGame(d, igdb(3), c));
  await settle(a, b);
  a.online = false;
  b.online = false;
  a.change((d, c) => moveEntry(d, "g:igdb:3", 0, c));
  a.change((d, c) => setNotes(d, "igdb:1", "A's note", c));
  b.change((d, c) => removeEntry(d, "g:igdb:2", c));
  b.change((d, c) => moveEntry(d, "g:igdb:1", 2, c));
  a.online = true;
  b.online = true;
  await settle(a, b);
  assert.deepEqual(ids(a), ids(b));
  assert.ok(!ids(a).includes("igdb:2"), "the removal holds");
  assert.equal(b.data.records["igdb:1"].notes, "A's note");
});

test("the same IGDB game saved on two offline devices is one row", async () => {
  const cloud = fakeCloud();
  const a = device(cloud);
  const b = device(cloud);
  a.online = false;
  b.online = false;
  a.change((d, c) => saveGame(d, igdb(9), c));
  b.change((d, c) => saveGame(d, igdb(9), c));
  a.online = true;
  b.online = true;
  await settle(a, b);
  assert.deepEqual(ids(a), ["igdb:9"]);
  assert.equal([...cloud.tables[GAME_TABLE.queue].keys()].length, 1);
  assert.equal([...cloud.tables[GAME_TABLE.library].keys()].length, 1);
});

test("offline IGDB saves, removals and reorders upload on reconnect", async () => {
  const cloud = fakeCloud();
  const a = device(cloud);
  a.change((d, c) => saveGame(d, igdb(1), c));
  await settle(a);
  cloud.failWith = { code: "08006" };
  a.change((d, c) => saveGame(d, igdb(2), c));
  a.change((d, c) => moveEntry(d, "g:igdb:2", 0, c));
  a.change((d, c) => removeEntry(d, "g:igdb:1", c));
  assert.equal(await a.sync(), "failed");
  assert.equal(gamesBackedUp(OWNER.userId, a.storage), false, "sign-out would hold them");
  cloud.failWith = null;
  assert.equal(await a.sync(), "synced");
  const b = device(cloud);
  await settle(b);
  assert.deepEqual(ids(b), ["igdb:2"]);
  assert.equal(gamesBackedUp(OWNER.userId, a.storage), true);
});

test("a failed IGDB write is retried and lands once", async () => {
  const cloud = fakeCloud();
  const a = device(cloud);
  cloud.failOnce = 1;
  a.change((d, c) => saveGame(d, igdb(5), c));
  const first = await a.queue.drain();
  assert.notEqual(first, "drained");
  assert.equal(await a.queue.drain(), "drained");
  assert.equal(cloud.tables[GAME_TABLE.library].size, 1);
  assert.equal(cloud.tables[GAME_TABLE.queue].size, 1);
});

test("unsent IGDB games are held through an account switch and only return to their owner", async () => {
  const OWNER_KEY = "harbor.local.ownerUserId";
  const storage = fakeStorage({ [OWNER_KEY]: "alice" });
  const cloud = fakeCloud();
  cloud.failWith = { code: "PGRST205" }; // tables unavailable: nothing can upload
  const alice = device(cloud, { owner: { userId: "alice", profileId: "pa" }, storage });
  alice.change((d, c) => saveGame(d, igdb(42), c));
  alice.change((d, c) => setNotes(d, "igdb:42", "Alice's IGDB note", c));
  await alice.sync();
  assert.equal(gamesBackedUp("alice", storage), false);

  // Bob signs in: wipe, holding Alice's unsent games under her account.
  const hold = prepareGameHold("alice", storage);
  for (const key of [...Array(storage.length)].map((_, i) => storage.key(i))) {
    if (key.startsWith("harbor.") && !key.startsWith("harbor.cloud.") && key !== OWNER_KEY) {
      storage.removeItem(key);
    }
  }
  hold();
  storage.setItem(OWNER_KEY, "bob");
  assert.equal(restoreHeldGames("bob", storage), false, "Bob gets nothing");
  const bob = device(fakeCloud(), { owner: { userId: "bob", profileId: "pa" }, storage });
  assert.deepEqual(wishlistView(bob.data), []);

  storage.setItem(OWNER_KEY, "alice");
  assert.equal(restoreHeldGames("alice", storage), true);
  const back = device(cloud, { owner: { userId: "alice", profileId: "pa" }, storage });
  assert.equal(back.data.records["igdb:42"].notes, "Alice's IGDB note");
  cloud.failWith = null;
  assert.equal(await back.sync(), "synced");
  const rows = [...cloud.tables[GAME_TABLE.library].values()];
  assert.deepEqual(
    rows.map((r) => [r.user_id, r.game_id]),
    [["alice", "igdb:42"]],
  );
});

test("profiles and accounts never see each other's IGDB rows", async () => {
  const cloud = fakeCloud();
  const p1 = device(cloud, { owner: { userId: "u", profileId: "p1" } });
  const p2 = device(cloud, { owner: { userId: "u", profileId: "p2" } });
  const other = device(cloud, { owner: { userId: "v", profileId: "p1" } });
  p1.change((d, c) => saveGame(d, igdb(1), c));
  await settle(p1, p2, other);
  assert.deepEqual(ids(p1), ["igdb:1"]);
  assert.deepEqual(ids(p2), []);
  assert.deepEqual(ids(other), []);
});

// ── 9. older clients ────────────────────────────────────────────────────────

test("a pre-IGDB build never deletes, overwrites or re-sends igdb: rows in the cloud", async () => {
  const cloud = fakeCloud();
  const current = device(cloud);
  current.change((d, c) => saveGame(d, rawg(1, "game-1"), c));
  current.change((d, c) => saveGame(d, igdb(2), c));
  current.change((d, c) => saveCollection(d, AC, [rawg(3, "game-3"), igdb(128)], ["x"], c));
  current.change((d, c) => setNotes(d, "igdb:2", "keep me", c));
  await settle(current);
  const igdbRows = () =>
    JSON.stringify(
      [...cloud.tables[GAME_TABLE.library].values(), ...cloud.tables[GAME_TABLE.queue].values()]
        .filter((r) => String(r.game_id).startsWith("igdb:"))
        .sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1)),
    );
  const before = igdbRows();

  const old = device(cloud, { preIgdb: true });
  await settle(old);
  assert.deepEqual(ids(old), ["rawg:1", "c:assassins-creed"], "it sees only RAWG");
  cloud.sent = [];
  // Everything an old build can do to what it sees.
  old.change((d, c) => moveEntry(d, "c:assassins-creed", 0, c));
  old.change((d, c) => setNotes(d, "rawg:1", "old build note", c));
  old.change((d, c) => removeEntry(d, "g:rawg:1", c));
  old.change((d, c) => restoreEntries(d, ["g:rawg:1"], c));
  await settle(old);
  assert.ok(
    cloud.sent.every((s) => !String(s.row.game_id).startsWith("igdb:")),
    "no igdb: row is ever sent",
  );
  assert.equal(igdbRows(), before, "every igdb: row is exactly as it was");

  await settle(current);
  assert.deepEqual(ids(current), ["c:assassins-creed", "rawg:1", "igdb:2"]);
  assert.equal(current.data.records["igdb:2"].notes, "keep me");
  assert.equal(current.data.records["rawg:1"].notes, "old build note");
});

test("known limit: a pre-IGDB build rewriting this device's blob drops its igdb: rows", () => {
  // Documented, not fixed: an old build can't be changed. The cloud keeps the
  // rows (above), so only changes this device never uploaded are at risk.
  const storage = fakeStorage();
  const current = storeOn(storage);
  current.apply("p1", (d, c) => saveGame(d, igdb(2), c));
  const old = device(fakeCloud(), {
    preIgdb: true,
    storage,
    owner: { userId: "u", profileId: "p1" },
  });
  old.change((d, c) => saveGame(d, rawg(1), c));
  const reread = parseLibraryBlob(storage.getItem(libraryKey("p1")));
  assert.equal(reread.records["igdb:2"], undefined);
  assert.ok(reread.unsynced, "but the blob stays marked unsent");
});

// ── 10. boundaries ──────────────────────────────────────────────────────────

test("every save resolves its ref against the library at write time", () => {
  const save = src("views/game-discovery/save-controls.tsx");
  const writes = save
    .split("changeGameLibrary((d, ctx) =>")
    .slice(1)
    .map((rest) => rest.slice(0, rest.indexOf("ctx)")));
  assert.equal(writes.length, 5, `found ${writes.length} writes`);
  const resolving = writes.filter((w) => /libraryRefs?\(d, /.test(w));
  // Every save resolves; the fifth write is the snapshot refresh of the exact record.
  assert.equal(resolving.length, 4);
  assert.match(save, /changeGameLibrary\(\(d, ctx\) => refreshSnapshot\(d, ref, ctx\)\);/);
  assert.equal((save.match(/toGameRef\(/g) ?? []).length, 1, "toGameRef only inside savableRef");
  assert.doesNotMatch(save, /NotSavableYet|Wishlist coming soon/);
});

test("Stage 6 needs no schema change and writes nowhere but through the app's sync", () => {
  const migrations = readFileSync(new URL("../supabase/README.md", import.meta.url), "utf8");
  assert.match(migrations, /20261102120000_game_library/);
  for (const path of [
    "lib/game-library/identity.ts",
    "lib/game-library/snapshot.ts",
    "views/game-library/game-art.tsx",
    "lib/game-discovery/use-active-provider.ts",
  ]) {
    assert.doesNotMatch(src(path), /supabase|cloud\/(client|queue)|\.upsert\(|\.delete\(/, path);
  }
  assert.equal(gameIdOfRef(igdb(3)), "igdb:3");
  assert.equal(rootEntryId("igdb:3"), "g:igdb:3");
});

test("a saved game opened without its provider set up still shows its snapshot", () => {
  const frame = src("views/game-discovery/games-frame.tsx");
  // The closed slot renders only while the gate is closed, above the setup notice.
  assert.match(frame, /\{gate\.ready \? \([\s\S]*?\) : \(\s*<>\s*\{closed\}\s*<div/);
  const detail = src("views/game-discovery/game-detail.tsx");
  assert.match(
    detail,
    /closed=\{seed \? <OtherProviderGame gameId=\{gameId\} seed=\{seed\} reason="not-set-up" \/> : null\}/,
  );
  const other = detail.slice(
    detail.indexOf("function OtherProviderGame"),
    detail.indexOf("function GameDetailBody"),
  );
  assert.doesNotMatch(other, /useGame(Detail|Related|Screenshots)|useDeveloperGames|useQuery/);
});

test("the IGDB SQL checks change no schema, refuse real projects and leave nothing behind", () => {
  const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  const sql = read("supabase/tests/game_library_igdb_checks.sql").replace(/--.*$/gm, "");
  assert.match(sql, /if exists \(select 1 from auth\.users\) then\s+raise exception/);
  assert.match(
    sql,
    /raise exception using errcode = 'GL000';\s+exception when sqlstate 'GL000' then/,
  );
  assert.match(sql, /create or replace function pg_temp\.game_library_igdb_checks\(\)/);
  // Only the temporary function is created; no table, policy, trigger or grant.
  assert.doesNotMatch(sql, /\b(alter|drop|grant|revoke)\b|create (table|policy|trigger|index)/i);
  assert.doesNotMatch(sql, /create (or replace )?function (?!pg_temp\.)/i);
  // The frozen migration is untouched and listed as the only migration.
  assert.deepEqual(readdirSync(new URL("../supabase/migrations", import.meta.url)), [
    "20261102120000_game_library.sql",
  ]);
  assert.match(
    read("supabase/README.md"),
    /tests\/game_library_igdb_checks\.sql`\s+\| Same, for IGDB ids/,
  );
});
