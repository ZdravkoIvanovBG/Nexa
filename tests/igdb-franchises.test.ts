// @ts-nocheck -- Node's test modules are not included in the application tsconfig.
// Stage 5: curated franchises on IGDB. The reviewed id mapping against the
// catalog and against IGDB's own records (a fixture fetched live), the
// provider's franchise and banner requests, resolution, game-page links, and
// the boundaries (RAWG unchanged, no IGDB Wishlist writes). No network.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { franchiseOfGame } from "../src/lib/game-discovery/franchise-of.ts";
import { resolveFranchise, sortGames } from "../src/lib/game-discovery/franchise-resolve.ts";
import { curatedSlugs, FRANCHISES, franchiseById } from "../src/lib/game-discovery/franchises.ts";
import {
  IGDB_FRANCHISES,
  igdbFranchiseArtwork,
  igdbFranchiseIds,
  igdbFranchiseOf,
} from "../src/lib/game-discovery/franchises-igdb.ts";
import { createIgdbProvider } from "../src/lib/providers/igdb/provider.ts";
import { buildQuery } from "../src/lib/providers/igdb/query.ts";

const src = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
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

// ---------------------------------------------------------------------------
// Provider requests

function fakeClient(rows) {
  const calls = [];
  return {
    calls,
    client: {
      async query(endpoint, spec) {
        calls.push({ endpoint, body: buildQuery(spec), spec });
        return rows(spec);
      },
      async multiquery() {
        throw new Error("no multiquery expected");
      },
    },
  };
}

const rowsForIds =
  (extra = {}) =>
  (spec) => {
    const ids = spec.where[0].clause
      .match(/\((.*)\)/)[1]
      .split(",")
      .map(Number);
    return ids.map((id) => {
      const r = RECORDS.get(id);
      return {
        id,
        name: r?.name ?? `Game ${id}`,
        slug: `igdb-slug-${id}`,
        first_release_date: r?.year ? Date.UTC(r.year, 5, 1) / 1000 : undefined,
        cover: { image_id: `co${id}`, width: 600, height: 800 },
        screenshots: [{ image_id: `sc${id}`, width: 1920, height: 1080 }],
        ...(extra[id] ?? {}),
      };
    });
  };

test("a franchise page is one request by reviewed ids, never a slug or a search", async () => {
  for (const def of FRANCHISES) {
    const { client, calls } = fakeClient(rowsForIds());
    const data = await createIgdbProvider(client, "g0").franchise(def, async () => {
      throw new Error("no detail lookups");
    });
    assert.equal(calls.length, 1, def.id);
    const body = calls[0].body;
    assert.match(body, /where id = \(/);
    assert.match(body, /themes != \(42\)/, "the content filter applies");
    // Filtered by ids only: no search, no slug or name match (fields may list "slug").
    const filter = body.slice(body.indexOf("where "));
    assert.doesNotMatch(body, /search "/);
    assert.doesNotMatch(filter, /slug|name|~/);
    for (const slug of curatedSlugs(def)) assert.ok(!body.includes(`"${slug}"`), slug);
    assert.equal(data.curatedOnly, true);
    assert.equal(data.games.length, igdbFranchiseIds(def.id).size);
    // Every game carries its curated slug, so the catalog classifies it.
    for (const game of data.games) assert.ok(data.aliases.has(game.id), game.id);
    const resolved = resolveFranchise(def, data.games, "release", data.aliases, {
      curatedOnly: true,
    });
    assert.equal(resolved.mainCount, def.mainline.length, def.id);
    assert.equal(resolved.groups.other.length, 0, `${def.id}: nothing uncurated`);
  }
});

test("Erotic-themed or missing games are left out, never guessed", async () => {
  const def = franchiseById("dark-souls");
  const { client } = fakeClient((spec) =>
    rowsForIds({ 2155: { themes: [{ id: 42 }] } })(spec).filter((g) => g.id !== 8222),
  );
  const data = await createIgdbProvider(client, "g0").franchise(def, async () => null);
  const ids = data.games.map((g) => g.id).sort();
  assert.deepEqual(ids, ["igdb:11133", "igdb:2368", "igdb:81085"]);
});

test("an unknown franchise costs no request", async () => {
  const { client, calls } = fakeClient(() => []);
  const data = await createIgdbProvider(client, "g0").franchise(
    { id: "not-curated", name: "X", mainline: [], years: {} },
    async () => null,
  );
  assert.deepEqual(data.games, []);
  assert.equal(calls.length, 0);
});

test("all 11 banners are one request: hero art, then landscape card art, never a cover", async () => {
  const { client, calls } = fakeClient(
    rowsForIds({
      // No landscape art at all: no banner rather than a stretched cover.
      11133: { screenshots: [] },
    }),
  );
  const art = await createIgdbProvider(client, "g0").franchiseArt();
  assert.equal(calls.length, 1);
  assert.deepEqual(
    Object.keys(art),
    FRANCHISES.map((f) => f.id),
  );
  assert.match(art["assassins-creed"], /\/t_1080p\/sc133004\.jpg$/);
  assert.equal(art["dark-souls"], null);
});

// ---------------------------------------------------------------------------
// Resolution, sorting and game-page links

test("curated-only resolution never applies RAWG's exclude list to IGDB slugs", () => {
  const def = franchiseById("tomb-raider");
  // IGDB's slug for the GBC game equals a RAWG duplicate the catalog excludes.
  const gbc = {
    id: "igdb:36878",
    slug: "tomb-raider-starring-lara-croft",
    name: "Tomb Raider Starring Lara Croft",
    released: "2000-06-08",
    metacritic: null,
  };
  const aliases = new Map([["igdb:36878", "tomb-raider-gbc"]]);
  const igdb = resolveFranchise(def, [gbc], "release", aliases, { curatedOnly: true });
  assert.deepEqual(
    igdb.groups.spinoffs.map((g) => g.id),
    ["igdb:36878"],
  );
  // RAWG's behaviour is unchanged: its duplicate record is still hidden.
  const rawg = resolveFranchise(
    def,
    [{ ...gbc, id: "rawg:1" }],
    "release",
    new Map([["rawg:1", "tomb-raider-gbc"]]),
  );
  assert.equal(rawg.groups.spinoffs.length, 0);
});

test("critic-score sorting uses IGDB's critic score and RAWG's Metacritic", () => {
  const g = (id, released, extra) => ({ id, name: id, released, metacritic: null, ...extra });
  const sorted = sortGames(
    [
      g("a", "2001-01-01", { criticScore: 70 }),
      g("b", "2002-01-01", { criticScore: 95 }),
      g("c", "2000-01-01", {}),
    ],
    "metacritic",
  );
  assert.deepEqual(
    sorted.map((x) => x.id),
    ["b", "a", "c"],
  );
  const rawg = sortGames(
    [g("x", "2001", { metacritic: 80 }), g("y", "2002", { metacritic: 90 })],
    "metacritic",
  );
  assert.deepEqual(
    rawg.map((x) => x.id),
    ["y", "x"],
  );
});

test("a game's franchise comes from its exact identity, never its name", () => {
  assert.equal(franchiseOfGame({ id: "igdb:1942", slug: "anything" })?.id, "the-witcher");
  assert.equal(franchiseOfGame({ id: "igdb:14903", slug: "x" })?.id, "assassins-creed");
  assert.equal(franchiseOfGame({ id: "igdb:317407", slug: "x" })?.id, "battlefield");
  // An IGDB game outside the catalog, even with a curated-looking slug.
  assert.equal(franchiseOfGame({ id: "igdb:999999999", slug: "the-witcher-3-wild-hunt" }), null);
  assert.equal(franchiseOfGame({ id: "igdb:52416", slug: "x" }), null, "the Chronicles bundle");
  // RAWG keeps its slug lookup, unchanged.
  assert.equal(
    franchiseOfGame({ id: "rawg:3328", slug: "the-witcher-3-wild-hunt" })?.id,
    "the-witcher",
  );
  assert.equal(franchiseOfGame({ id: "rawg:3328", slug: "unrelated" }), null);
  assert.equal(franchiseOfGame({ id: "steam:1", slug: "the-witcher" }), null);
  assert.deepEqual(igdbFranchiseOf(8223), {
    franchiseId: "assassins-creed",
    slug: "assassins-creed-chronicles",
  });
});

// ---------------------------------------------------------------------------
// Views and boundaries

test("franchise pages show 3:4 covers under IGDB; banners stay landscape", () => {
  const view = src("views/game-discovery/franchise-view.tsx");
  assert.match(view, /const shape = cardShapeOf\(gate\);/);
  assert.match(view, /<GameCard key=\{game\.id\} game=\{game\} shape=\{shape\} \/>/);
  assert.match(view, /<div className=\{GRID\[shape\]\}>/);
  assert.match(view, /<GameCardSkeleton key=\{i\} shape=\{shape\} \/>/);
  assert.equal((view.match(/<Group\s+shape=\{shape\}/g) ?? []).length, 5);
  assert.match(view, /label: igdb \? t\("Critic score"\) : t\("Metacritic"\)/);
  const card = src("views/game-discovery/franchise-card.tsx");
  assert.match(card, /aspect-\[16\/9\]/);
  assert.match(card, /gameImage\(art\.image, 640\)/, "a card-sized banner");
  const discovery = src("views/game-discovery.tsx");
  assert.match(discovery, /shape="landscape"\s+min=\{300\}\s+scrollKey="games-row-franchises"/);
});

test("IGDB game pages link their franchise and show the series as covers, without the game", () => {
  const detail = src("views/game-discovery/game-detail.tsx");
  assert.match(detail, /\{gate\.provider === "igdb" && franchise && \(\s*<FranchiseSeriesRow/);
  const body = detail.slice(
    detail.indexOf("function FranchiseSeriesBody"),
    detail.indexOf("function DeveloperRow"),
  );
  assert.match(body, /useFranchiseGames\(gate, def, active\)/, "shares the franchise page's cache");
  assert.match(body, /\.filter\(\s*\(g\) => g\.id !== gameId,?\s*\)/);
  assert.match(body, /shape=\{cardShapeOf\(gate\)\}/);
  assert.match(body, /onViewAll=\{\(\) => openGameFranchise\(def\.id\)\}/);
  // RAWG keeps its own series row.
  assert.match(
    detail,
    /detail\.counts\.series > 0 && \(\s*<RelatedRow\s+title=\{t\("More in this series"\)\}/,
  );
});

test("franchise art is provider-scoped and RAWG's device cache is RAWG-only", () => {
  const queries = src("lib/game-discovery/queries.ts");
  assert.match(
    queries,
    /franchiseArt: \(p: Scope\) => \[\.\.\.ROOT, p\.id, p\.scope, "franchise-art"\] as const/,
  );
  assert.match(queries, /provider\.id === "rawg";/);
  assert.match(queries, /enabled: enabled && gate\.ready && batched && def !== null,/);
});

test("collection saving stays behind savableRef; the catalog itself writes nothing", () => {
  const save = src("views/game-discovery/save-controls.tsx");
  assert.match(
    save,
    /const refs = games\.map\(savableRef\);\s*if \(refs\.some\(\(r\) => r === null\)\) return null;/,
  );
  const igdb = src("lib/game-discovery/provider.ts");
  assert.match(igdb, /igdb: \{ franchises: true, librarySaves: true, cards: "cover" \}/);
  for (const path of [
    "lib/game-discovery/franchises-igdb.ts",
    "lib/game-discovery/franchise-of.ts",
    "lib/providers/igdb/provider.ts",
  ]) {
    assert.doesNotMatch(src(path), /game-library|supabase|changeGameLibrary/i, path);
  }
});

test("the RAWG catalog is unchanged by Stage 5", () => {
  const catalog = src("lib/game-discovery/franchises.ts");
  assert.doesNotMatch(catalog, /igdb/i, "IGDB ids live in franchises-igdb.ts only");
});
