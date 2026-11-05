// Dev-only IGDB checks (Stage 1 proof of concept). Not run in CI.
//
// Credentials come from the environment only, never from a file in the repo:
//
//   node --env-file=.env.igdb.local scripts/igdb-dev-check.mjs <mode>
//
// .env.igdb.local (gitignored by `.env.*`) holds TWITCH_CLIENT_ID and
// TWITCH_CLIENT_SECRET. The script never prints the secret, the token or any
// request header, and writes no files: redirect stdout to keep a report.
//
// Modes:
//   auth        mint a token and make one request
//   fields      verify current field names and enum ids we rely on
//   discovery   popular, new, upcoming, acclaimed, classics, search, details
//   media       art coverage per list and CDN reachability
//   franchises  compare all curated franchises with IGDB [--franchise <id>] [--verbose]
//   all         every mode above, in order

import { createIgdbClient, isIgdbError } from "../src/lib/providers/igdb/client.ts";
import { igdbImage } from "../src/lib/providers/igdb/image.ts";
import {
  matchCatalogEntry,
  describeCandidate,
  titleKey,
} from "../src/lib/providers/igdb/catalog-match.ts";
import { normalizeIgdbDetail } from "../src/lib/providers/igdb/normalize.ts";
import { blendPopularity, orderByRanking } from "../src/lib/providers/igdb/popularity.ts";
import {
  DETAIL_FIELDS,
  GAME_TYPE,
  SUMMARY_FIELDS,
  THEME_EROTIC,
  AGE_RATING_ORG_ESRB,
  gameBySlug,
  gamesByIds,
  popularityQuery,
  popularSubqueries,
  publicFilters,
  searchQuery,
  sectionQuery,
  where,
} from "../src/lib/providers/igdb/query.ts";
import { createFetchTransport } from "../src/lib/providers/igdb/server/fetch-transport.ts";
import { createTwitchTokenSource } from "../src/lib/providers/igdb/server/twitch-auth.ts";

const mode = process.argv[2];
const MODES = ["auth", "fields", "discovery", "media", "franchises", "all"];
if (!MODES.includes(mode)) {
  console.error(
    `Usage: node --env-file=.env.igdb.local scripts/igdb-dev-check.mjs ${MODES.join(" | ")}`,
  );
  process.exit(2);
}

const tokens = createTwitchTokenSource({
  clientId: process.env.TWITCH_CLIENT_ID ?? "",
  clientSecret: process.env.TWITCH_CLIENT_SECRET ?? "",
  fetchImpl: (url, init) => fetch(url, init),
});
if (!tokens.configured()) {
  console.error(
    "Set TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET in the environment (see the header).",
  );
  process.exit(2);
}

let requestCount = 0;
const statusCounts = new Map();
const igdb = createIgdbClient({
  transport: createFetchTransport({ tokens, fetchImpl: (url, init) => fetch(url, init) }),
  onRequest: ({ status }) => {
    requestCount++;
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
  },
  isOffline: () => false,
});

const NOW_S = Math.floor(Date.now() / 1000);
const NOW_YEAR = new Date().getUTCFullYear();
const log = (line = "") => console.log(line);
const yearOf = (seconds) =>
  typeof seconds === "number" ? new Date(seconds * 1000).getUTCFullYear() : null;
const failure = (error) =>
  isIgdbError(error)
    ? `${error.kind}${error.status ? ` (HTTP ${error.status})` : ""}`
    : "unexpected error";

async function attempt(label, fn) {
  try {
    return await fn();
  } catch (error) {
    log(`  FAIL ${label}: ${failure(error)}`);
    return null;
  }
}

// IGDB's documented game_type names for the ids in GAME_TYPE, as title keys.
const EXPECTED_TYPE_KEYS = {
  main: "main-game",
  dlc: "dlc",
  expansion: "expansion",
  bundle: "bundle",
  standaloneExpansion: "standalone-expansion",
  mod: "mod",
  episode: "episode",
  season: "season",
  remake: "remake",
  remaster: "remaster",
  expandedGame: "expanded-game",
  port: "port",
  fork: "fork",
  pack: "pack-addon",
  update: "update",
};
const LISTED_TYPE_KEYS = new Set([
  "main-game",
  "main",
  "remake",
  "remaster",
  "standalone-expansion",
  "expanded-game",
  "standaloneexpansion",
  "expandedgame",
]);

let gameTypeNames = new Map(Object.entries(GAME_TYPE).map(([name, id]) => [id, name]));
const typeName = (id) =>
  id === null || id === undefined ? "unknown" : (gameTypeNames.get(id) ?? `type ${id}`);

// ---------------------------------------------------------------------------

async function auth() {
  log("== auth");
  const ok = await attempt("token", () => tokens.getToken().then(() => true));
  if (!ok) {
    process.exitCode = 1;
    return false;
  }
  const { expiresAt } = tokens.state();
  log(
    `  token OK, valid for ~${Math.round((expiresAt - Date.now()) / 86_400_000)} days (value not shown)`,
  );
  const games = await attempt("first request", () =>
    igdb.query("games", { fields: ["name"], limit: 1 }),
  );
  if (!games) {
    process.exitCode = 1;
    return false;
  }
  log(`  IGDB request OK (${Array.isArray(games) ? games.length : 0} result)`);
  return true;
}

async function fields() {
  log("\n== fields: enum ids and field names");
  const enums = await attempt("enum multiquery", () =>
    igdb.multiquery([
      {
        name: "game_types",
        endpoint: "game_types",
        query: { fields: ["type"], sort: { field: "id", dir: "asc" }, limit: 100 },
      },
      {
        name: "game_statuses",
        endpoint: "game_statuses",
        query: { fields: ["status"], sort: { field: "id", dir: "asc" }, limit: 100 },
      },
      {
        name: "themes",
        endpoint: "themes",
        query: { fields: ["name", "slug"], sort: { field: "id", dir: "asc" }, limit: 100 },
      },
      {
        name: "orgs",
        endpoint: "age_rating_organizations",
        query: { fields: ["name"], sort: { field: "id", dir: "asc" }, limit: 50 },
      },
      {
        name: "pop_types",
        endpoint: "popularity_types",
        query: {
          fields: ["name", "external_popularity_source"],
          sort: { field: "id", dir: "asc" },
          limit: 100,
        },
      },
      {
        name: "families",
        endpoint: "platform_families",
        query: { fields: ["name"], sort: { field: "id", dir: "asc" }, limit: 50 },
      },
      {
        name: "platforms",
        endpoint: "platforms",
        query: {
          fields: ["name", "platform_family"],
          where: [where.anyOf("id", [3, 6, 14, 34, 39, 82])],
          limit: 10,
        },
      },
      {
        name: "cm_types",
        endpoint: "collection_membership_types",
        query: { fields: ["name", "description", "allowed_collection_type"], limit: 50 },
      },
      {
        name: "c_types",
        endpoint: "collection_types",
        query: { fields: ["name", "description"], limit: 50 },
      },
    ]),
  );
  if (!enums) return;
  const list = (key) => (Array.isArray(enums[key]) ? enums[key] : []);

  log("  game_types:");
  const liveTypes = new Map(list("game_types").map((t) => [t.id, t.type]));
  for (const [name, id] of Object.entries(GAME_TYPE)) {
    const live = liveTypes.get(id);
    const ok = typeof live === "string" && titleKey(live) === EXPECTED_TYPE_KEYS[name];
    log(
      `    ${ok ? "ok   " : "CHECK"} ${String(id).padStart(2)} ours=${name.padEnd(20)} igdb=${live ?? "MISSING"}`,
    );
  }
  for (const [id, type] of liveTypes)
    if (!Object.values(GAME_TYPE).includes(id)) log(`    NEW   ${id} ${type}`);
  gameTypeNames = new Map([...liveTypes].map(([id, type]) => [id, type]));

  log(
    `  game_statuses: ${list("game_statuses")
      .map((s) => `${s.id}=${s.status}`)
      .join(", ")}`,
  );
  const erotic = list("themes").find((t) => t.id === THEME_EROTIC);
  log(
    `  themes: Erotic is id ${list("themes").find((t) => /erotic/i.test(t.name))?.id ?? "NOT FOUND"} (we use ${THEME_EROTIC}: ${erotic ? erotic.name : "MISSING"})`,
  );
  log(
    `  themes: ${list("themes")
      .map((t) => `${t.id}=${t.name}`)
      .join(", ")}`,
  );
  const esrb = list("orgs").find((o) => o.id === AGE_RATING_ORG_ESRB);
  log(
    `  age_rating_organizations: ${list("orgs")
      .map((o) => `${o.id}=${o.name}`)
      .join(", ")} (we use ESRB=${AGE_RATING_ORG_ESRB}: ${esrb?.name ?? "MISSING"})`,
  );
  log(
    `  popularity_types: ${list("pop_types")
      .map((p) => `${p.id}=${p.name}[src ${p.external_popularity_source ?? "-"}]`)
      .join(", ")}`,
  );
  log(
    `  platform_families: ${list("families")
      .map((f) => `${f.id}=${f.name}`)
      .join(", ")}`,
  );
  log(
    `  platforms we map by id: ${list("platforms")
      .map((p) => `${p.id}=${p.name}(family ${p.platform_family ?? "-"})`)
      .join(", ")}`,
  );
  log(
    `  collection_types: ${list("c_types")
      .map((t) => `${t.id}=${t.name}`)
      .join(", ")}`,
  );
  log(
    `  collection_membership_types: ${list("cm_types")
      .map((t) => `${t.id}=${t.name}`)
      .join(", ")}`,
  );

  log("  field sets:");
  for (const [label, set] of [
    ["summary", SUMMARY_FIELDS],
    ["detail", DETAIL_FIELDS],
  ]) {
    const r = await attempt(`${label} fields`, () =>
      igdb.query("games", gameBySlug("the-witcher-3-wild-hunt", set)),
    );
    if (r) {
      const present = new Set(Object.keys(r[0] ?? {}));
      const top = [...new Set(set.map((f) => f.split(".")[0]))];
      log(
        `    ${label}: accepted; present on Witcher 3: ${top.filter((f) => present.has(f)).length}/${top.length}; absent: ${top.filter((f) => !present.has(f)).join(", ") || "none"}`,
      );
    }
  }
  const deprecated = await attempt("deprecated fields", () =>
    igdb.query("games", { fields: ["category", "status", "collection"], limit: 1 }),
  );
  log(
    `    deprecated category/status/collection: ${deprecated ? "still accepted (do not use)" : "rejected"}`,
  );

  log("  public filter behaviour (counts of released games since 2020):");
  const since = [
    where.gte("first_release_date", 1_577_836_800),
    where.lte("first_release_date", NOW_S),
  ];
  const counts = await attempt("filter counts", () =>
    igdb.multiquery([
      { name: "all", endpoint: "games/count", query: { fields: [], where: since } },
      {
        name: "public",
        endpoint: "games/count",
        query: { fields: [], where: [...since, ...publicFilters()] },
      },
      {
        name: "no_themes",
        endpoint: "games/count",
        query: { fields: [], where: [...since, where.eq("themes", null)] },
      },
      {
        name: "no_themes_after_filter",
        endpoint: "games/count",
        query: {
          fields: [],
          where: [...since, where.eq("themes", null), where.noneOf("themes", [THEME_EROTIC])],
        },
      },
      {
        name: "erotic",
        endpoint: "games/count",
        query: { fields: [], where: [...since, where.anyOf("themes", [THEME_EROTIC])] },
      },
    ]),
  );
  if (counts) {
    log(
      `    all=${counts.all} public=${counts.public} erotic=${counts.erotic} untagged=${counts.no_themes} untagged-kept-by-theme-filter=${counts.no_themes_after_filter}`,
    );
    if (counts.no_themes > 0 && counts.no_themes_after_filter === 0) {
      log("    CHECK: 'themes != (42)' also drops games with no themes at all");
    }
  }
}

function summarize(game) {
  const score = `critic ${game.criticScore ?? "-"}(${game.criticCount}) user ${game.userScore ?? "-"}(${game.userCount})`;
  return `${game.name} (${game.released?.slice(0, 4) ?? "TBA"}) [${typeName(game.gameType)}] ${score} art=${game.art?.kind ?? "NONE"}`;
}

const sectionLists = {};

async function discovery() {
  log("\n== discovery");
  const types = await attempt("popularity types", () =>
    igdb.query("popularity_types", {
      fields: ["name"],
      sort: { field: "id", dir: "asc" },
      limit: 100,
    }),
  );
  // The chosen Popular recipe: Playing blended with Want to Play (Visits is not used).
  const popular = await attempt("popular blend", async () => {
    const lists = await igdb.multiquery(popularSubqueries(50));
    const ranking = blendPopularity([lists.playing, lists.want_to_play], { limit: 60 });
    const games = await igdb.games({
      fields: SUMMARY_FIELDS,
      where: [where.anyOf("id", ranking), ...publicFilters()],
      limit: ranking.length,
    });
    return { ranking, games: orderByRanking(games, ranking) };
  });
  if (popular) {
    sectionLists["popular (Playing + Want to Play)"] = popular.games;
    log(
      `  POPULAR (Playing + Want to Play): ${popular.ranking.length} blended -> ${popular.games.length} public games`,
    );
    for (const game of popular.games.slice(0, 15)) log(`    ${summarize(game)}`);
  }

  // Individual signals, for comparison only.
  const wanted = ["Want to Play", "Playing", "24hr Peak Players", "Most Wishlisted Upcoming"];
  for (const name of wanted) {
    const type = (types ?? []).find((t) => typeof t.name === "string" && t.name.includes(name));
    if (!type) {
      log(`  popular/${name}: type not found`);
      continue;
    }
    const prims = await attempt(`popularity ${name}`, () =>
      igdb.query("popularity_primitives", popularityQuery(type.id, 40)),
    );
    const ids = (prims ?? [])
      .map((p) => p.game_id)
      .filter((id) => Number.isSafeInteger(id) && id > 0);
    if (ids.length === 0) {
      log(`  popular/${name} (type ${type.id}): no primitives`);
      continue;
    }
    const games = await attempt(`games for ${name}`, () =>
      igdb.games({
        fields: SUMMARY_FIELDS,
        where: [where.anyOf("id", ids), ...publicFilters()],
        limit: ids.length,
      }),
    );
    if (!games) continue;
    const order = new Map(ids.map((id, i) => [id, i]));
    games.sort((a, b) => order.get(a.igdbId) - order.get(b.igdbId));
    sectionLists[`popular:${name}`] = games;
    log(
      `  popular/${name} (type ${type.id}): ${ids.length} primitives -> ${games.length} public games`,
    );
    for (const game of games.slice(0, 10)) log(`    ${summarize(game)}`);
  }

  for (const id of ["new", "upcoming", "acclaimed", "classics"]) {
    const games = await attempt(id, () => igdb.games(sectionQuery(id, NOW_S, 20)));
    if (!games) continue;
    sectionLists[id] = games;
    log(`  ${id}: ${games.length} games`);
    for (const game of games.slice(0, 10)) log(`    ${summarize(game)}`);
  }

  for (const term of [
    "witcher",
    "zelda",
    "resident evil",
    "grand theft auto",
    'halo"; fields *;',
  ]) {
    const games = await attempt(`search ${term}`, () => igdb.games(searchQuery(term, 10)));
    if (games)
      log(
        `  search "${term}": ${games.map((g) => `${g.name} (${g.released?.slice(0, 4) ?? "TBA"})`).join(" | ") || "no results"}`,
      );
  }

  log("  details:");
  for (const slug of [
    "the-witcher-3-wild-hunt",
    "elden-ring",
    "baldurs-gate-iii",
    "red-dead-redemption-2",
  ]) {
    const raw = await attempt(`detail ${slug}`, () => igdb.query("games", gameBySlug(slug)));
    const d = normalizeIgdbDetail(raw?.[0]);
    if (!d) {
      log(`    ${slug}: NOT FOUND`);
      continue;
    }
    log(`    ${summarize(d)}`);
    log(
      `      description ${d.description?.length ?? 0} chars, storyline ${d.storyline?.length ?? 0} chars, esrb ${d.esrb ?? "-"}, genres ${d.genres.map((g) => g.name).join("/") || "-"}`,
    );
    log(
      `      developers ${d.developers.map((c) => c.name).join(", ") || "-"}; publishers ${d.publishers.map((c) => c.name).join(", ") || "-"}`,
    );
    log(
      `      platforms ${d.platforms.join(", ") || "-"}; families ${d.platformFamilies.join(",")}`,
    );
    log(
      `      screenshots ${d.screenshots.length}, videos ${d.videos.length}, collections ${d.collections.map((c) => c.name).join(", ") || "-"}, franchises ${d.franchises.map((c) => c.name).join(", ") || "-"}`,
    );
    log(
      `      related: remakes ${d.related.remakes.length}, remasters ${d.related.remasters.length}, dlcs ${d.related.dlcs.length}, expansions ${d.related.expansions.length}, similar ${d.related.similar.length}, igdbUrl ${d.igdbUrl ? "ok" : "-"}`,
    );
  }
}

async function media() {
  log("\n== media");
  if (Object.keys(sectionLists).length === 0) {
    for (const id of ["new", "upcoming", "acclaimed", "classics"]) {
      const games = await attempt(id, () => igdb.games(sectionQuery(id, NOW_S, 40)));
      if (games) sectionLists[id] = games;
    }
  }
  const total = { artwork: 0, screenshot: 0, cover: 0, none: 0 };
  for (const [name, games] of Object.entries(sectionLists)) {
    const c = { artwork: 0, screenshot: 0, cover: 0, none: 0 };
    for (const game of games) c[game.art?.kind ?? "none"]++;
    for (const k of Object.keys(c)) total[k] += c[k];
    log(
      `  ${name.padEnd(36)} artwork ${c.artwork}, screenshot ${c.screenshot}, cover-only ${c.cover}, none ${c.none} (of ${games.length})`,
    );
  }
  log(
    `  TOTAL                                artwork ${total.artwork}, screenshot ${total.screenshot}, cover-only ${total.cover}, none ${total.none}`,
  );

  const sample = await attempt("art dimensions", () =>
    igdb.query("games", {
      fields: [
        "name",
        "artworks.width",
        "artworks.height",
        "screenshots.width",
        "screenshots.height",
        "cover.width",
        "cover.height",
      ],
      where: [
        where.anyOf(
          "id",
          Object.values(sectionLists)
            .flat()
            .slice(0, 30)
            .map((g) => g.igdbId),
        ),
      ],
      limit: 30,
    }),
  );
  if (sample) {
    const widths = (key) =>
      sample
        .flatMap((g) => (Array.isArray(g[key]) ? g[key] : g[key] ? [g[key]] : []))
        .map((i) => i.width)
        .filter(Number.isFinite);
    const median = (xs) =>
      xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : "-";
    log(
      `  source widths (median): artworks ${median(widths("artworks"))}px, screenshots ${median(widths("screenshots"))}px, covers ${median(widths("cover"))}px`,
    );
  }

  const first = Object.values(sectionLists)
    .flat()
    .find((g) => g.art);
  if (first) {
    const id = first.art.url
      .split("/")
      .pop()
      .replace(/\.jpg$/, "");
    for (const size of ["cover_big", "screenshot_big", "720p", "1080p"]) {
      const url = igdbImage(id, size);
      const res = await fetch(url, { method: "HEAD" }).catch(() => null);
      log(
        `  CDN t_${size.padEnd(14)} HTTP ${res?.status ?? "network error"} ${res?.headers.get("content-type") ?? ""} (no credentials sent)`,
      );
    }
  }
}

const CANDIDATE_FIELDS = [
  "name",
  "slug",
  "first_release_date",
  "game_type",
  "version_parent",
  "artworks.image_id",
  "screenshots.image_id",
  "cover.image_id",
];

function toCandidate(raw) {
  return {
    igdbId: raw.id,
    slug: raw.slug ?? "",
    name: raw.name ?? "",
    year: yearOf(raw.first_release_date),
    gameType: typeof raw.game_type === "number" ? raw.game_type : null,
    versionParent: typeof raw.version_parent === "number" ? raw.version_parent : null,
    art: raw.artworks?.length
      ? "artwork"
      : raw.screenshots?.length
        ? "screenshot"
        : raw.cover
          ? "cover"
          : "none",
  };
}

async function fetchCandidates(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const raw = await attempt("pool games", () =>
      igdb.query("games", gamesByIds(chunk, CANDIDATE_FIELDS)),
    );
    for (const g of raw ?? []) if (g?.id && g.slug) out.push(toCandidate(g));
  }
  return out;
}

async function franchises() {
  const { FRANCHISES } = await import("../src/lib/game-discovery/franchises.ts");
  const only = process.argv.includes("--franchise")
    ? process.argv[process.argv.indexOf("--franchise") + 1]
    : null;
  const verbose = process.argv.includes("--verbose");
  if (gameTypeNames.size === 0 || !gameTypeNames.has(0) || gameTypeNames.get(0) === "main") {
    const live = await attempt("game_types", () =>
      igdb.query("game_types", { fields: ["type"], limit: 100 }),
    );
    if (live) gameTypeNames = new Map(live.map((t) => [t.id, t.type]));
  }
  log("\n== franchises: curated catalog vs IGDB");
  const totals = {
    resolved: 0,
    matched: 0,
    near_year: 0,
    year_mismatch: 0,
    ambiguous: 0,
    missing: 0,
  };

  for (const def of FRANCHISES) {
    if (only && def.id !== only) continue;
    log(`\n-- ${def.name} (${def.id})`);
    const key = titleKey(def.name);
    const entries = [
      ...def.mainline.map((slug) => ({ slug, role: "main", expectedYear: def.years[slug] })),
      ...Object.entries(def.variants ?? {}).map(([slug, role]) => ({
        slug,
        role,
        expectedYear: def.years[slug],
      })),
    ];
    const lookups = [
      ...new Set(
        entries
          .flatMap((e) => [e.slug, e.slug.replace(/-\d+$/, "")])
          .filter((s) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s)),
      ),
    ];
    const slugConds = lookups.map((slug) => where.slug("slug", slug));
    const subs = [
      {
        name: "collections",
        endpoint: "collections",
        query: {
          fields: ["name", "slug", "games", "type"],
          where: [where.contains("name", def.name)],
          limit: 50,
        },
      },
      {
        name: "franchises",
        endpoint: "franchises",
        query: {
          fields: ["name", "slug", "games"],
          where: [where.contains("name", def.name)],
          limit: 20,
        },
      },
    ];
    for (let i = 0; i < slugConds.length && subs.length < 10; i += 40) {
      subs.push({
        name: `slugs${i}`,
        endpoint: "games",
        query: { fields: ["name"], where: [where.or(...slugConds.slice(i, i + 40))], limit: 500 },
      });
    }
    const mq = await attempt("lookup multiquery", () => igdb.multiquery(subs));
    if (!mq) continue;
    const collections = Array.isArray(mq.collections) ? mq.collections : [];
    const igdbFranchises = Array.isArray(mq.franchises) ? mq.franchises : [];
    const primary = [...collections, ...igdbFranchises].filter(
      (c) => titleKey(c.name ?? "") === key,
    );
    log(
      `  IGDB collections matching the name: ${collections.map((c) => `${c.name} [${c.id}] ${c.games?.length ?? 0} games`).join("; ") || "none"}`,
    );
    log(
      `  IGDB franchises matching the name:  ${igdbFranchises.map((c) => `${c.name} [${c.id}] ${c.games?.length ?? 0} games`).join("; ") || "none"}`,
    );

    const poolIds = new Set();
    for (const c of [...collections, ...igdbFranchises])
      for (const id of c.games ?? []) poolIds.add(id);
    for (const [name, value] of Object.entries(mq))
      if (name.startsWith("slugs")) for (const g of value ?? []) poolIds.add(g.id);
    const primaryIds = new Set(primary.flatMap((c) => c.games ?? []));
    const pool = await fetchCandidates([...poolIds]);
    log(
      `  candidate pool: ${pool.length} IGDB games (primary collection/franchise: ${primaryIds.size})`,
    );

    const usedIds = new Set();
    const rows = [];
    for (const entry of entries) {
      let m = matchCatalogEntry(entry, pool, { nowYear: NOW_YEAR, typeName });
      let via = "";
      if (m.status === "missing") {
        const words = entry.slug.replace(/-/g, " ");
        const found = await attempt(`search ${entry.slug}`, () =>
          igdb.query("games", { fields: CANDIDATE_FIELDS, search: words, limit: 10 }),
        );
        const extra = (found ?? []).filter((g) => g?.id && g.slug).map(toCandidate);
        if (extra.length) {
          m = matchCatalogEntry(entry, [...pool, ...extra], { nowYear: NOW_YEAR, typeName });
          via = " (via search)";
          if (m.status === "missing") m.candidates = extra.slice(0, 3);
        }
      }
      totals[m.status]++;
      if (m.status === "matched" && m.passedOver.length) totals.resolved++;
      if (m.match) usedIds.add(m.match.igdbId);
      rows.push({ m, via });
    }

    for (const { m, via } of rows) {
      const e = m.entry;
      const head = `${e.slug} [${e.role}] expected ${e.expectedYear ?? "TBA"}`;
      const notes = m.notes.length ? `  NOTE: ${m.notes.join("; ")}` : "";
      const inPrimary =
        m.match && primaryIds.size > 0 && !primaryIds.has(m.match.igdbId)
          ? "  (not in IGDB's collection)"
          : "";
      const art = m.match?.art && m.match.art !== "artwork" ? `  art=${m.match.art}` : "";
      const passed = m.passedOver.length
        ? `  over ${m.passedOver.map((c) => `${c.igdbId} [${c.versionParent !== null ? "edition" : typeName(c.gameType)}]`).join(", ")}`
        : "";
      if (m.status === "matched" && passed) {
        // Same title and year as other records: always shown so the choice can be checked.
        log(
          `  RESOLVED   ${head} -> ${describeCandidate(m.match)} [${typeName(m.match.gameType)}]${passed}${via}${notes}${inPrimary}${art}`,
        );
      } else if (m.status === "matched") {
        if (verbose || notes || inPrimary || art)
          log(
            `  ok         ${head} -> ${describeCandidate(m.match)}${via}${notes}${inPrimary}${art}`,
          );
      } else if (m.status === "near_year") {
        log(
          `  NEAR YEAR  ${head} -> ${describeCandidate(m.match)}${via}${notes}${inPrimary}${art}`,
        );
      } else {
        const label = {
          year_mismatch: "YEAR DIFF ",
          ambiguous: "AMBIGUOUS ",
          missing: "MISSING   ",
        }[m.status];
        log(`  ${label} ${head}${via}`);
        for (const c of m.candidates.slice(0, 4))
          log(`               candidate ${describeCandidate(c)} [${typeName(c.gameType)}]`);
      }
    }

    // Cross-check: IGDB's own mainline = "Member" (type 1) memberships of the
    // franchise's main collection whose game is a main game and not an edition.
    // A review signal for catalog maintenance only, never used at runtime.
    const mainCollections = collections.filter((c) => titleKey(c.name ?? "") === key);
    const crossCollections = mainCollections.length
      ? mainCollections
      : [...collections]
          .sort((a, b) => (b.games?.length ?? 0) - (a.games?.length ?? 0))
          .slice(0, 1);
    if (crossCollections.length) {
      const memberships = await attempt("collection memberships", () =>
        igdb.query("collection_memberships", {
          fields: ["game", "type", "collection"],
          where: [
            where.anyOf(
              "collection",
              crossCollections.map((c) => c.id),
            ),
            where.eq("type", 1),
          ],
          limit: 500,
        }),
      );
      const byId = new Map(pool.map((c) => [c.igdbId, c]));
      const igdbMain = (memberships ?? [])
        .map((r) => byId.get(r.game))
        .filter((c) => c && c.gameType === 0 && c.versionParent === null);
      const igdbMainIds = new Set(igdbMain.map((c) => c.igdbId));
      const curatedMain = rows.filter(({ m }) => m.entry.role === "main" && m.match);
      const curatedMainIds = new Set(curatedMain.map(({ m }) => m.match.igdbId));
      const curatedAnyIds = new Set(rows.filter(({ m }) => m.match).map(({ m }) => m.match.igdbId));
      const onlyIgdb = igdbMain.filter((c) => !curatedMainIds.has(c.igdbId));
      const onlyCurated = curatedMain.filter(({ m }) => !igdbMainIds.has(m.match.igdbId));
      log(
        `  MAINLINE CROSS-CHECK vs IGDB ${crossCollections.map((c) => `"${c.name}" [${c.id}]`).join(", ")} Member+Main: IGDB ${igdbMain.length}, curated main matched ${curatedMain.length}, in both ${curatedMain.length - onlyCurated.length}`,
      );
      for (const c of onlyIgdb.sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999))) {
        const where_ = curatedAnyIds.has(c.igdbId) ? "curated as a variant" : "not curated";
        log(`    IGDB mainline only (${where_}): ${describeCandidate(c)}`);
      }
      for (const { m } of onlyCurated) {
        log(`    curated mainline only: ${m.entry.slug} -> ${describeCandidate(m.match)}`);
      }
    }

    const excluded = new Set(def.exclude ?? []);
    const unclassified = pool.filter(
      (c) => primaryIds.has(c.igdbId) && !usedIds.has(c.igdbId) && !excluded.has(c.slug),
    );
    const byType = new Map();
    for (const c of unclassified) {
      const t = c.versionParent !== null ? "edition" : typeName(c.gameType);
      byType.set(t, [...(byType.get(t) ?? []), c]);
    }
    const counts = [...byType].map(([t, list]) => `${t} ${list.length}`).join(", ");
    log(
      `  IGDB collection members not in the curated catalog: ${unclassified.length}${counts ? ` (${counts})` : ""}`,
    );
    for (const [t, list] of byType) {
      if (!verbose && !LISTED_TYPE_KEYS.has(titleKey(t))) continue;
      for (const c of list
        .sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999))
        .slice(0, verbose ? 100 : 15)) {
        log(`    + [${t}] ${describeCandidate(c)}`);
      }
    }
  }
  log(
    `\nFranchise totals: matched ${totals.matched} (resolved over same-title duplicates: ${totals.resolved}), near-year ${totals.near_year}, year mismatch ${totals.year_mismatch}, ambiguous ${totals.ambiguous}, missing ${totals.missing}`,
  );
}

// ---------------------------------------------------------------------------

const ok = await auth();
if (ok && mode !== "auth") {
  if (mode === "fields" || mode === "all") await fields();
  if (mode === "discovery" || mode === "all") await discovery();
  if (mode === "media" || mode === "all") await media();
  if (mode === "franchises" || mode === "all") await franchises();
}
log(
  `\n${requestCount} IGDB requests; statuses ${[...statusCounts].map(([s, n]) => `${s ?? "network"}×${n}`).join(", ")}`,
);
