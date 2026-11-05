// @ts-nocheck -- Node's test modules are not included in the application tsconfig.
// Stage 2 regression tests for the GameMetadataProvider seam. RAWG must make
// exactly the requests it made before the seam (same paths, params and count)
// and return the same results, with only the id now provider-qualified.
// Mocked: RAWG responses come from an in-memory fetch.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { keyFingerprint } from "../src/lib/game-discovery/gates.ts";
import { ACTIVE_GAME_PROVIDER } from "../src/lib/game-discovery/provider.ts";
import { createRawgSessionStatus } from "../src/lib/game-discovery/status.ts";
import { createRawgClient } from "../src/lib/providers/rawg/client.ts";
import {
  MAX_CURATED_LOOKUPS,
  createRawgProvider,
  rawgLookupKey,
} from "../src/lib/providers/rawg/provider.ts";

const KEY = "SECRET_RAWG_KEY_123";
const AUTH = { key: KEY, verifiedFor: keyFingerprint(KEY) };

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  };
}

function setup(handler) {
  const calls = [];
  const client = createRawgClient({
    fetchImpl: async (url) => {
      calls.push(url);
      const u = new URL(url);
      return handler(u.pathname.replace(/^\/api/, ""), u.searchParams, calls.length);
    },
    status: createRawgSessionStatus(),
    base: "https://rawg.test/api",
    sleep: async () => {},
    isOffline: () => false,
  });
  const provider = createRawgProvider(client, AUTH, keyFingerprint(KEY));
  // Request lines without the key, for exact comparisons.
  const requests = () =>
    calls.map((url) => {
      const u = new URL(url);
      u.searchParams.delete("key");
      return `${u.pathname.replace(/^\/api/, "")}${u.search}`;
    });
  return { provider, calls, requests };
}

const WITCHER = {
  id: 3328,
  slug: "the-witcher-3-wild-hunt",
  name: "The Witcher 3: Wild Hunt",
  released: "2015-05-18",
  tba: false,
  background_image: "https://media.rawg.io/media/games/618/618c.jpg",
  rating: 4.65,
  ratings_count: 6000,
  metacritic: 92,
  added: 20000,
  genres: [{ id: 5, slug: "role-playing-games-rpg", name: "RPG" }],
  parent_platforms: [{ platform: { id: 1, slug: "pc", name: "PC" } }],
  esrb_rating: { id: 4, slug: "mature", name: "Mature" },
  short_screenshots: [
    { id: -1, image: "https://media.rawg.io/media/games/618/618c.jpg" },
    { id: 1, image: "https://media.rawg.io/media/screenshots/a.jpg" },
  ],
};

test("Stage 2 keeps RAWG as the only active provider", () => {
  assert.equal(ACTIVE_GAME_PROVIDER, "rawg");
});

test("list: one request with exactly the pre-seam path and params", async () => {
  const { provider, requests } = setup(() =>
    response(200, { count: 1, next: null, results: [WITCHER] }),
  );
  await provider.list({}, 1, 20);
  await provider.list({ search: "witcher" }, 2, 40);
  assert.deepEqual(requests(), [
    "/games?exclude_additions=true&ordering=-added&page=1&page_size=20",
    "/games?exclude_additions=true&page=2&page_size=40&search=witcher&search_precise=true",
  ]);
});

test("list: RAWG results are unchanged apart from the provider-qualified id", async () => {
  const { provider } = setup(() =>
    response(200, {
      count: 2,
      next: "https://rawg.test/next",
      results: [WITCHER, { ...WITCHER }, { id: 0, slug: "bad", name: "Bad" }],
    }),
  );
  const page = await provider.list({}, 1, 20);
  assert.equal(page.count, 2);
  assert.equal(page.hasMore, true);
  assert.equal(page.items.length, 1, "duplicates and invalid ids are dropped");
  // The exact pre-seam summary, with `rawgId: 3328` now spelled `id: "rawg:3328"`.
  assert.equal(
    JSON.stringify(page.items[0]),
    JSON.stringify({
      id: "rawg:3328",
      slug: "the-witcher-3-wild-hunt",
      name: "The Witcher 3: Wild Hunt",
      released: "2015-05-18",
      tba: false,
      image: "https://media.rawg.io/media/games/618/618c.jpg",
      metacritic: 92,
      rating: 4.65,
      ratingsCount: 6000,
      added: 20000,
      genres: [{ id: 5, slug: "role-playing-games-rpg", name: "RPG" }],
      platformFamilies: ["pc"],
      esrb: "Mature",
      shortScreenshots: ["https://media.rawg.io/media/screenshots/a.jpg"],
    }),
  );
});

test("detail: by id, by slug and through one redirect, with the same request count", async () => {
  const { provider, requests } = setup((path) => {
    if (path === "/games/old-slug")
      return response(200, { redirect: true, slug: "the-witcher-3-wild-hunt" });
    return response(200, WITCHER);
  });
  assert.equal((await provider.detail("rawg:3328")).id, "rawg:3328");
  assert.equal((await provider.detail("the-witcher-3-wild-hunt")).id, "rawg:3328");
  assert.equal((await provider.detail("old-slug")).id, "rawg:3328");
  assert.deepEqual(requests(), [
    "/games/3328",
    "/games/the-witcher-3-wild-hunt",
    "/games/old-slug",
    "/games/the-witcher-3-wild-hunt",
  ]);
});

test("detail: not found is null", async () => {
  const { provider } = setup(() => response(404, {}));
  assert.equal(await provider.detail("rawg:1"), null);
});

test("another provider's id never reaches RAWG", async () => {
  const { provider, calls } = setup(() => response(200, WITCHER));
  assert.equal(await provider.detail("igdb:3328"), null);
  assert.deepEqual(await provider.screenshots("igdb:3328"), []);
  assert.deepEqual(await provider.related("igdb:3328", "additions"), []);
  for (const odd of ["", "rawg:01", "igdb:", "steam:1", "a:b"]) {
    assert.equal(await provider.detail(odd), null, odd);
  }
  assert.equal(calls.length, 0, "no request for a foreign or malformed id");
  assert.equal(rawgLookupKey("rawg:3328"), 3328);
  assert.equal(rawgLookupKey("the-witcher"), "the-witcher");
  assert.equal(rawgLookupKey("igdb:3328"), null);
});

test("screenshots and related rows: same endpoints and page sizes as before", async () => {
  const { provider, requests } = setup((path) =>
    path.endsWith("/screenshots")
      ? response(200, { results: [{ id: 1, image: "https://media.rawg.io/s.jpg" }] })
      : response(200, { count: 1, next: null, results: [WITCHER] }),
  );
  assert.deepEqual(await provider.screenshots("rawg:3328"), ["https://media.rawg.io/s.jpg"]);
  for (const kind of ["game-series", "additions", "parent-games"]) {
    const items = await provider.related("rawg:3328", kind);
    assert.deepEqual(
      items.map((g) => g.id),
      ["rawg:3328"],
    );
  }
  assert.deepEqual(requests(), [
    "/games/3328/screenshots?page_size=40",
    "/games/3328/game-series?page_size=20",
    "/games/3328/additions?page_size=20",
    "/games/3328/parent-games?page_size=20",
  ]);
});

const game = (id, slug) => ({ id, slug, name: slug, released: "2010-01-01" });

function franchiseSetup(seriesHandler) {
  return setup((path, params) => {
    if (path === "/games/anchor") return response(200, game(10, "anchor"));
    if (path === "/games/10/game-series") return seriesHandler(params);
    if (path === "/games/curated-alias")
      return response(200, { redirect: true, slug: "canonical" });
    const slug = path.slice("/games/".length);
    return response(200, game(100 + slug.length, slug));
  });
}

const DEF = {
  id: "demo",
  name: "Demo",
  artwork: "anchor",
  mainline: ["anchor", "m2", "m3"],
  variants: { "curated-alias": "spinoff" },
  years: {},
};

test("franchise: anchor, series pages and curated lookups, in the pre-seam order", async () => {
  const { provider, requests } = franchiseSetup((params) =>
    params.get("page") === "1"
      ? response(200, { results: [game(20, "m2")], next: "https://rawg.test/p2" })
      : response(200, { results: [], next: null }),
  );
  const data = await provider.franchise(DEF, (idOrSlug) => provider.detail(idOrSlug));
  assert.equal(data.seriesAvailable, true);
  assert.deepEqual(
    data.games.map((g) => g.id),
    ["rawg:10", "rawg:20", "rawg:102", "rawg:109"],
  );
  assert.deepEqual([...data.aliases], [["rawg:109", "curated-alias"]]);
  assert.deepEqual(requests(), [
    "/games/anchor",
    "/games/10/game-series?page=1&page_size=40",
    "/games/10/game-series?page=2&page_size=40",
    "/games/m3",
    "/games/curated-alias",
    "/games/canonical",
  ]);
});

test("franchise: a key without series access falls back to curated lookups", async () => {
  const { provider } = franchiseSetup(() => response(403, {}));
  const data = await provider.franchise(DEF, (idOrSlug) => provider.detail(idOrSlug));
  assert.equal(data.seriesAvailable, false);
  assert.deepEqual(
    data.games.map((g) => g.slug),
    ["anchor", "m2", "m3", "canonical"],
  );
});

test("franchise: curated lookups stay capped", async () => {
  const many = {
    ...DEF,
    mainline: ["anchor", ...Array.from({ length: 12 }, (_, i) => `x${i}`)],
    variants: {},
  };
  const { provider, requests } = franchiseSetup(() => response(200, { results: [], next: null }));
  await provider.franchise(many, (idOrSlug) => provider.detail(idOrSlug));
  assert.equal(requests().length, 1 + 1 + MAX_CURATED_LOOKUPS);
});

test("queries.ts makes no provider requests of its own", () => {
  const source = readFileSync(
    new URL("../src/lib/game-discovery/queries.ts", import.meta.url),
    "utf8",
  );
  assert.ok(!/rawg\.get\(/.test(source), "every request goes through the provider");
  assert.ok(!/providers\/rawg\/(normalize|detail)/.test(source));
  assert.ok(!/providers\/igdb/.test(source), "IGDB is not wired in");
  assert.ok(
    /useMemo\(\(\) => \{\s*switch \(ACTIVE_GAME_PROVIDER\)/.test(source),
    "one provider per key change, not per render",
  );
  // Same cache lifetimes and retry policy as before the seam.
  assert.ok(source.includes("const LIST = { staleTime: 30 * 60_000, gcTime: 60 * 60_000 };"));
  assert.ok(
    source.includes("const DETAIL = { staleTime: 6 * 60 * 60_000, gcTime: 6 * 60 * 60_000 };"),
  );
  assert.ok(
    source.includes("const NO_RETRY = { retry: false as const, refetchOnReconnect: false };"),
  );
});

test("query keys are provider-namespaced and hold no credential", () => {
  const source = readFileSync(
    new URL("../src/lib/game-discovery/queries.ts", import.meta.url),
    "utf8",
  );
  assert.ok(source.includes('const ROOT = ["harbor", "games"] as const;'));
  assert.ok(/\[\.\.\.ROOT, p\.id, p\.scope, "detail"/.test(source));
  assert.ok(!/auth\.key\]/.test(source));
});
