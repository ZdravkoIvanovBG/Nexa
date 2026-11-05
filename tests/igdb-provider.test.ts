// @ts-nocheck -- Node's test modules are not included in the application tsconfig.
// Stage 4: the IGDB GameMetadataProvider. A fake client records every request
// (built with the real query builder) and returns canned IGDB responses; no
// network, no Tauri.
import assert from "node:assert/strict";
import test from "node:test";
import { gamesErrorKind } from "../src/lib/game-discovery/errors.ts";
import {
  GAME_GENRE_TILES,
  GAME_PLATFORM_FILTERS,
  gameSections,
} from "../src/lib/game-discovery/sections.ts";
import { IgdbError } from "../src/lib/providers/igdb/client.ts";
import { planList } from "../src/lib/providers/igdb/listing.ts";
import {
  POPULARITY_POOL,
  RANKING_TTL_MS,
  createIgdbProvider,
} from "../src/lib/providers/igdb/provider.ts";
import { buildMultiquery, buildQuery } from "../src/lib/providers/igdb/query.ts";
import { toGameSummary, webUrl } from "../src/lib/providers/igdb/summary.ts";
import { normalizeIgdbGame } from "../src/lib/providers/igdb/normalize.ts";

const NOW_MS = Date.UTC(2026, 10, 5);
const NOW = NOW_MS / 1000;

const img = (id) => ({ image_id: id });
function game(id, extra = {}) {
  return {
    id,
    name: `Game ${id}`,
    slug: `game-${id}`,
    first_release_date: NOW - 86_400 * 30,
    game_type: 0,
    aggregated_rating: 88.4,
    aggregated_rating_count: 12,
    rating: 91.6,
    rating_count: 900,
    cover: img(`cov${id}`),
    artworks: [img(`art${id}`)],
    screenshots: [img(`shot${id}a`), img(`shot${id}b`)],
    genres: [{ id: 12, name: "Role-playing (RPG)", slug: "role-playing-rpg" }],
    themes: [{ id: 1, name: "Action", slug: "action" }],
    platforms: [{ id: 6, name: "PC (Microsoft Windows)" }],
    age_ratings: [{ organization: 1, rating_category: { rating: "M" } }],
    ...extra,
  };
}

function fakeClient(handler = () => []) {
  const calls = [];
  const client = {
    async query(endpoint, spec, signal) {
      const body = buildQuery(spec);
      calls.push({ endpoint, body, spec });
      return handler({ endpoint, body, spec, signal });
    },
    async multiquery(queries) {
      calls.push({ endpoint: "multiquery", body: buildMultiquery(queries) });
      return handler({ endpoint: "multiquery", queries });
    },
  };
  return { client, calls };
}

const provider = (client, now = () => NOW_MS) => createIgdbProvider(client, "g0", { now });

test("RAWG ids, catalog slugs and malformed ids never reach IGDB", async () => {
  const { client, calls } = fakeClient(() => [game(1942)]);
  const p = provider(client);
  for (const id of ["rawg:1942", "the-witcher-3-wild-hunt", "", "igdb:", "igdb:01", "steam:1"]) {
    assert.equal(await p.detail(id), null, id);
  }
  assert.deepEqual(await p.screenshots("rawg:1942"), []);
  assert.deepEqual(await p.related("rawg:1942", "similar"), []);
  const franchise = await p.franchise(
    { id: "witcher", name: "The Witcher", mainline: ["x"] },
    () => {
      throw new Error("no lookup");
    },
  );
  assert.deepEqual(franchise.games, [], "franchises are Stage 5");
  assert.equal(franchise.seriesAvailable, false);
  assert.equal(calls.length, 0);
});

test("detail: one request, Critic Score and User Score 0–100, never Metacritic", async () => {
  const raw = game(1942, {
    summary: "Geralt hunts.",
    storyline: "Ciri is missing.",
    url: "https://www.igdb.com/games/the-witcher-3-wild-hunt",
    websites: [
      { url: "javascript:alert(1)", type: 1 },
      { url: "https://thewitcher.com", type: 1 },
      { url: "https://store.steampowered.com/app/292030", type: 13 },
    ],
    involved_companies: [
      { company: { id: 908, name: "CD Projekt RED", slug: "cd-projekt-red" }, developer: true },
      { company: { id: 1, name: "WB", slug: "wb" }, publisher: true },
    ],
    dlcs: [12503],
    expansions: [12504],
    remasters: [415005],
    similar_games: [472, 1877],
    version_parent: undefined,
  });
  const { client, calls } = fakeClient(() => [raw]);
  const d = await provider(client).detail("igdb:1942");
  assert.equal(calls.length, 1);
  assert.match(calls[0].body, /where id = 1942; limit 1;$/);
  assert.equal(d.id, "igdb:1942");
  assert.equal(d.metacritic, null, "no IGDB number is ever labelled Metacritic");
  assert.equal(d.rating, null, "RAWG's 0–5 rating stays empty");
  assert.equal(d.criticScore, 88);
  assert.equal(d.userScore, 92);
  assert.equal(d.esrb, "ESRB M");
  assert.equal(d.description, "Geralt hunts.");
  assert.equal(d.storyline, "Ciri is missing.");
  assert.equal(d.website, "https://thewitcher.com/", "unsafe and store links dropped");
  assert.equal(d.providerUrl, "https://www.igdb.com/games/the-witcher-3-wild-hunt");
  assert.deepEqual(
    d.developers.map((x) => x.name),
    ["CD Projekt RED"],
  );
  assert.deepEqual(
    d.publishers.map((x) => x.name),
    ["WB"],
  );
  assert.deepEqual(d.relations, {
    parents: [],
    versions: ["igdb:415005"],
    additions: ["igdb:12503", "igdb:12504"],
    similar: ["igdb:472", "igdb:1877"],
  });
  assert.equal(d.counts.series, 0, "series membership is curated franchise data (Stage 5)");
  assert.ok(!JSON.stringify(d).includes("rawg"), "no RAWG id anywhere");
});

test("an Erotic-themed game is never served as a detail page", async () => {
  const { client } = fakeClient(() => [
    game(5, { themes: [{ id: 42, name: "Erotic", slug: "erotic" }] }),
  ]);
  assert.equal(await provider(client).detail("igdb:5"), null);
});

test("art: landscape first at full size, a portrait cover is flagged, never cropped", () => {
  const landscape = toGameSummary(normalizeIgdbGame(game(1)));
  assert.match(landscape.image, /\/t_1080p\/art1\.jpg$/);
  assert.equal(landscape.imageKind, undefined);
  const shot = toGameSummary(normalizeIgdbGame(game(2, { artworks: [] })));
  assert.match(shot.image, /\/t_1080p\/shot2a\.jpg$/);
  const cover = toGameSummary(normalizeIgdbGame(game(3, { artworks: [], screenshots: [] })));
  assert.match(cover.image, /\/t_cover_big\/cov3\.jpg$/);
  assert.equal(cover.imageKind, "portrait");
  const none = toGameSummary(
    normalizeIgdbGame(game(4, { artworks: [], screenshots: [], cover: null })),
  );
  assert.equal(none.image, null);
  assert.ok(landscape.shortScreenshots.every((u) => u.includes("/t_1080p/")));
});

test("variants: DLC, remasters and editions are labelled, never shown as the base game", () => {
  const v = (extra) => toGameSummary(normalizeIgdbGame(game(9, extra))).variant;
  assert.equal(v({}), undefined);
  assert.equal(v({ game_type: 1 }), "dlc");
  assert.equal(v({ game_type: 2 }), "expansion");
  assert.equal(v({ game_type: 3 }), "bundle");
  assert.equal(v({ game_type: 8 }), "remake");
  assert.equal(v({ game_type: 9 }), "remaster");
  assert.equal(v({ version_parent: 1942 }), "edition");
});

test("every public list query excludes Erotic, DLC, bundles and editions", async () => {
  const { client, calls } = fakeClient(({ endpoint }) =>
    endpoint === "multiquery"
      ? { playing: [], want_to_play: [] }
      : endpoint === "games/count"
        ? { count: 0 }
        : [],
  );
  const p = provider(client);
  const filters = [
    ...gameSections(new Date(NOW_MS), "igdb").map((s) => s.filter),
    ...GAME_GENRE_TILES.map((t) => t.filter),
    ...GAME_PLATFORM_FILTERS.map((x) => ({ parentPlatforms: x.id })),
    { search: "witcher" },
    { search: "witcher", ordering: "-released" },
    { developers: "908" },
  ];
  for (const filter of filters) await p.list(filter, 1, 40, undefined, { withCount: true });
  const listing = calls.filter((c) => c.endpoint === "games" || c.endpoint === "games/count");
  assert.ok(listing.length > 15);
  for (const call of listing) {
    assert.match(call.body, /themes != \(42\)/, call.body);
    assert.match(call.body, /game_type = \(0,4,8,9,10\)/, call.body);
    assert.match(call.body, /version_parent = null/, call.body);
  }
});

test("genre tiles and platform pills map to verified IGDB ids", () => {
  const where = (filter) =>
    planList(filter, NOW)
      .where.map((c) => c.clause)
      .join(" & ");
  assert.match(where({ genres: "action" }), /themes = \(1\)/, "Action is an IGDB theme");
  assert.match(where({ tags: "horror" }), /themes = \(19\)/, "Horror is an IGDB theme");
  assert.match(where({ genres: "role-playing-games-rpg" }), /genres = \(12\)/);
  assert.match(where({ genres: "strategy" }), /genres = \(15,11,16\)/);
  assert.match(where({ genres: "sports" }), /genres = \(14\)/);
  assert.match(where({ parentPlatforms: "1" }), /platforms = \(6\)/);
  assert.match(where({ parentPlatforms: "2" }), /platforms\.platform_family = \(1\)/);
  assert.match(where({ parentPlatforms: "3" }), /platforms\.platform_family = \(2\)/);
  assert.match(where({ parentPlatforms: "7" }), /platforms\.platform_family = \(5\)/);
  assert.match(where({ parentPlatforms: "4,8" }), /platforms = \(39,34\)/);
  // Every tile and pill the UI offers has a mapping.
  for (const tile of GAME_GENRE_TILES)
    assert.notEqual(planList(tile.filter, NOW).kind, "none", tile.title);
  for (const pill of GAME_PLATFORM_FILTERS) {
    assert.notEqual(planList({ parentPlatforms: pill.id }, NOW).kind, "none", pill.label);
  }
});

test("a filter IGDB can't express answers empty without a request", async () => {
  const { client, calls } = fakeClient();
  const p = provider(client);
  for (const filter of [
    { genres: "massively-multiplayer" },
    { tags: "open-world" },
    { parentPlatforms: "99" },
    { developers: "12; fields *" },
    { dates: "2020-01-01" },
    { metacritic: "x,y" },
    { search: '"\\' },
  ]) {
    const page = await p.list(filter, 1, 20);
    assert.deepEqual(page, { items: [], count: 0, hasMore: false }, JSON.stringify(filter));
  }
  assert.equal(calls.length, 0);
});

test("search: relevance uses IGDB search; an ordering becomes a sorted name match", () => {
  const relevance = planList({ search: "zelda" }, NOW);
  assert.equal(relevance.search, "zelda");
  assert.equal(relevance.sort, null, "IGDB can't sort a search");
  const sorted = planList({ search: "zelda", ordering: "-released" }, NOW);
  assert.equal(sorted.search, null);
  assert.deepEqual(sorted.sort, { field: "first_release_date", dir: "desc" });
  assert.ok(sorted.where.some((c) => c.clause === 'name ~ *"zelda"*'));
});

test("Popular blends Playing and Want to Play once, then pages through the ranking", async () => {
  let now = NOW_MS;
  const ranking = {
    playing: [10, 11, 12].map((game_id, i) => ({ game_id, value: 100 - i })),
    want_to_play: [12, 13, 14].map((game_id, i) => ({ game_id, value: 100 - i })),
  };
  const { client, calls } = fakeClient(({ endpoint, spec }) => {
    if (endpoint === "multiquery") return ranking;
    const ids = spec.where[0].clause
      .match(/\((.*)\)/)[1]
      .split(",")
      .map(Number);
    // IGDB answers in its own order; the provider restores the ranking.
    return ids.reverse().map((id) => game(id));
  });
  const p = provider(client, () => now);
  const first = await p.list({ section: "popular" }, 1, 2);
  const second = await p.list({ section: "popular" }, 2, 2);
  const third = await p.list({ section: "popular" }, 3, 2);
  assert.equal(calls.filter((c) => c.endpoint === "multiquery").length, 1, "ranking reused");
  assert.match(calls[0].body, new RegExp(`limit ${POPULARITY_POOL};`));
  assert.match(calls[0].body, /popularity_type = 3/);
  assert.match(calls[0].body, /popularity_type = 2/);
  assert.doesNotMatch(calls[0].body, /popularity_type = 1\b/, "Visits is never used");
  // 12 is near the top of both lists, so it leads; no duplicates across pages.
  const ids = [...first.items, ...second.items, ...third.items].map((g) => g.id);
  assert.equal(ids[0], "igdb:12");
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.length, 5);
  assert.equal(first.hasMore, true);
  assert.equal(third.hasMore, false);
  assert.equal(first.count, null, "no honest total for a filtered ranking");
  // Released games only (unreleased ones are in Coming soon).
  assert.match(calls[1].body, /first_release_date <= 1793836800/);
  now += RANKING_TTL_MS + 1;
  await p.list({ section: "popular" }, 1, 2);
  assert.equal(calls.filter((c) => c.endpoint === "multiquery").length, 2, "refreshed after TTL");
});

test("a failed ranking read isn't cached", async () => {
  let fail = true;
  const { client, calls } = fakeClient(({ endpoint }) => {
    if (endpoint === "multiquery") {
      if (fail) throw new IgdbError("unavailable", 503);
      return { playing: [], want_to_play: [] };
    }
    return [];
  });
  const p = provider(client);
  await assert.rejects(p.list({ section: "popular" }, 1, 20), (e) => e.kind === "unavailable");
  fail = false;
  await p.list({ section: "popular" }, 1, 20);
  assert.equal(calls.filter((c) => c.endpoint === "multiquery").length, 2);
});

test("Browse counts only on the first page, in parallel, and a failed count isn't fatal", async () => {
  const { client, calls } = fakeClient(({ endpoint }) => {
    if (endpoint === "games/count") throw new IgdbError("rate_limited", 429);
    return Array.from({ length: 40 }, (_, i) => game(i + 1));
  });
  const p = provider(client);
  const page1 = await p.list({ genres: "action" }, 1, 40, undefined, { withCount: true });
  const page2 = await p.list({ genres: "action" }, 2, 40, undefined, { withCount: true });
  assert.equal(page1.count, null);
  assert.equal(page1.hasMore, true);
  assert.equal(page2.items.length, 40);
  // Page 1: the page and its count together; page 2: the page alone.
  assert.deepEqual(
    calls
      .slice(0, 2)
      .map((c) => c.endpoint)
      .sort(),
    ["games", "games/count"],
  );
  assert.deepEqual(
    calls.slice(2).map((c) => c.endpoint),
    ["games"],
  );
  assert.match(calls[2].body, /offset 40;/);
  const rows = fakeClient(() => []);
  await provider(rows.client).list({ section: "new" }, 1, 20);
  assert.deepEqual(
    rows.calls.map((c) => c.endpoint),
    ["games"],
    "rows never count",
  );
});

test("related rows reuse the cached detail and keep each row's own filter", async () => {
  const detail = {
    id: "igdb:1942",
    relations: {
      parents: ["igdb:1"],
      versions: ["igdb:415005"],
      additions: ["igdb:12503", "igdb:12504"],
      similar: ["igdb:472", "igdb:1877", "igdb:1942"],
    },
  };
  const lookups = [];
  const lookup = async (id) => {
    lookups.push(id);
    return detail;
  };
  const { client, calls } = fakeClient(({ spec }) => {
    const ids = spec.where[0].clause
      .match(/\((.*)\)/)[1]
      .split(",")
      .map(Number);
    return ids.map((id, i) => game(id, { first_release_date: NOW - i * 86_400, game_type: 1 }));
  });
  const p = provider(client);
  const additions = await p.related("igdb:1942", "additions", undefined, lookup);
  const similar = await p.related("igdb:1942", "similar", undefined, lookup);
  await p.related("igdb:1942", "versions", undefined, lookup);
  await p.related("igdb:1942", "parent-games", undefined, lookup);
  assert.deepEqual(await p.related("igdb:1942", "game-series", undefined, lookup), []);
  assert.equal(calls.length, 4, "no extra detail request");
  assert.ok(lookups.every((id) => id === "igdb:1942"));
  assert.deepEqual(
    additions.map((g) => g.id),
    ["igdb:12504", "igdb:12503"],
    "additions read in release order",
  );
  assert.ok(!similar.some((g) => g.id === "igdb:1942"), "a game is never similar to itself");
  // DLC rows keep DLC; similar and versions are public lists.
  assert.doesNotMatch(calls[0].body, /game_type =/);
  assert.match(calls[0].body, /themes != \(42\)/);
  assert.match(calls[1].body, /game_type = \(0,4,8,9,10\)/);
});

test("screenshots come from the cached detail", async () => {
  const { client, calls } = fakeClient();
  const shots = await provider(client).screenshots("igdb:7", undefined, async () => ({
    screenshots: ["a", "b"],
  }));
  assert.deepEqual(shots, ["a", "b"]);
  assert.equal(calls.length, 0);
});

test("client failures surface as the Games error kinds", async () => {
  for (const [kind, expected] of [
    ["invalid_credentials", "credentials"],
    ["missing_credentials", "credentials"],
    ["rate_limited", "rate_limited"],
    ["network", "network"],
    ["unavailable", "unavailable"],
    ["bad_response", "unavailable"],
  ]) {
    const { client } = fakeClient(() => {
      throw new IgdbError(kind);
    });
    const error = await provider(client)
      .list({ section: "new" }, 1, 20)
      .catch((e) => e);
    assert.equal(gamesErrorKind(error), expected, kind);
  }
  assert.equal(gamesErrorKind(new Error("x")), null);
});

test("webUrl keeps http(s) only", () => {
  assert.equal(webUrl("https://a.example/x"), "https://a.example/x");
  for (const bad of ["javascript:alert(1)", "file:///C:/x", "data:text/html,x", "x", 5, null]) {
    assert.equal(webUrl(bad), null, String(bad));
  }
});

test("Popular narrowed by genre or name queries the ranked pool, so pages stay full", async () => {
  const ranking = {
    playing: Array.from({ length: 60 }, (_, i) => ({ game_id: i + 1, value: 1000 - i })),
    want_to_play: [],
  };
  const { client, calls } = fakeClient(({ endpoint }) =>
    endpoint === "multiquery"
      ? ranking
      : endpoint === "games/count"
        ? { count: 7 }
        : [game(3), game(1)],
  );
  const p = provider(client);
  const page = await p.list({ section: "popular", genres: "action" }, 1, 40, undefined, {
    withCount: true,
  });
  const games = calls.find((c) => c.endpoint === "games");
  assert.match(games.body, /where id = \(1,2,3,/, "the whole ranked pool, not one page of it");
  assert.match(games.body, /themes = \(1\)/);
  assert.match(games.body, /sort total_rating_count desc;/);
  assert.match(games.body, /offset 0;/);
  assert.equal(page.count, 7);
  // Unfiltered Popular keeps the ranking's own order.
  assert.equal(planList({ section: "popular" }, NOW).narrowed, false);
  assert.equal(planList({ section: "popular", search: "zelda" }, NOW).narrowed, true);
});
