// Apicalypse query construction for IGDB (Stage 1 proof of concept).
//
// Safety model: no caller-supplied text is ever pasted into a query raw.
// - Field names, sort fields and multiquery names must match strict patterns.
// - Numbers must be safe integers or finite numbers in range.
// - Free text (search terms, name filters) is reduced to plain text: control
//   characters, double quotes and backslashes are removed, so a term can never
//   close its string literal, and we don't depend on IGDB's escape rules.
// - Slugs must match [a-z0-9-].
// - `where` clauses can only be built with the helpers below (a branded type).
// Anything invalid throws IgdbQueryError before a request is made.

export class IgdbQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IgdbQueryError";
  }
}

/** Endpoints the client may call. Anything else is refused. */
export const IGDB_ENDPOINTS = [
  "games",
  "games/count",
  "covers",
  "artworks",
  "screenshots",
  "game_videos",
  "genres",
  "themes",
  "platforms",
  "platform_families",
  "game_types",
  "game_statuses",
  "collections",
  "collection_memberships",
  "collection_membership_types",
  "collection_types",
  "franchises",
  "popularity_primitives",
  "popularity_types",
  "age_ratings",
  "age_rating_organizations",
  "age_rating_categories",
  "involved_companies",
  "companies",
  "search",
  "multiquery",
] as const;

export type IgdbEndpoint = (typeof IGDB_ENDPOINTS)[number];

const ENDPOINT_SET: ReadonlySet<string> = new Set(IGDB_ENDPOINTS);

export function isIgdbEndpoint(value: unknown): value is IgdbEndpoint {
  return typeof value === "string" && ENDPOINT_SET.has(value);
}

// ---------------------------------------------------------------------------
// Tentative enum ids. `node scripts/igdb-dev-check.mjs fields` verifies each
// against the live game_types / themes / age_rating_organizations endpoints.

export const GAME_TYPE = {
  main: 0,
  dlc: 1,
  expansion: 2,
  bundle: 3,
  standaloneExpansion: 4,
  mod: 5,
  episode: 6,
  season: 7,
  remake: 8,
  remaster: 9,
  expandedGame: 10,
  port: 11,
  fork: 12,
  pack: 13,
  update: 14,
} as const;

/** Game types that stand on their own in public lists (no DLC, bundles, packs, mods). */
export const LISTABLE_GAME_TYPES: readonly number[] = [
  GAME_TYPE.main,
  GAME_TYPE.standaloneExpansion,
  GAME_TYPE.remake,
  GAME_TYPE.remaster,
  GAME_TYPE.expandedGame,
];

export const THEME_EROTIC = 42;
export const AGE_RATING_ORG_ESRB = 1;

// ---------------------------------------------------------------------------
// Primitive validation

const FIELD = /^(?:\*|[a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)*(?:\.\*)?)$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const QUERY_NAME = /^[a-z0-9_-]{1,32}$/i;

export const MAX_LIMIT = 500;
export const MAX_OFFSET = 50_000;
export const MAX_TEXT_LENGTH = 100;
export const MAX_IDS = 500;
export const MAX_MULTIQUERY = 10;

function field(name: string): string {
  if (typeof name !== "string" || !FIELD.test(name)) {
    throw new IgdbQueryError("Invalid IGDB field name");
  }
  return name;
}

function int(value: unknown, min: number, max: number, what: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new IgdbQueryError(`Invalid ${what}`);
  }
  return value;
}

function finite(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new IgdbQueryError("Invalid number");
  }
  return value;
}

/**
 * Reduce user text to something that is always safe inside a quoted
 * Apicalypse string. Returns null when nothing usable remains.
 */
export function plainText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value
    .normalize("NFKC")
    // Control characters (C0, DEL, C1) and Unicode line/paragraph separators.
    .replace(/[\p{Cc}\u2028\u2029]/gu, " ")
    .replace(/["\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  // Cut on a code point boundary so a surrogate pair is never split.
  return Array.from(cleaned).slice(0, MAX_TEXT_LENGTH).join("").trim() || null;
}

export function validSlug(value: unknown): value is string {
  return typeof value === "string" && value.length <= 200 && SLUG.test(value);
}

/** Positive safe-integer ids, deduped, in first-seen order. Throws on anything else. */
export function idList(ids: readonly unknown[]): number[] {
  return intList(ids, 1);
}

/** Like idList, but also allows 0, which enum ids use (game_type 0 is a main game). */
export function enumList(ids: readonly unknown[]): number[] {
  return intList(ids, 0);
}

function intList(ids: readonly unknown[], min: number): number[] {
  if (!Array.isArray(ids)) throw new IgdbQueryError("Invalid id list");
  const out: number[] = [];
  const seen = new Set<number>();
  for (const id of ids) {
    const n = int(id, min, Number.MAX_SAFE_INTEGER, "IGDB id");
    if (!seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  if (out.length === 0) throw new IgdbQueryError("Empty id list");
  if (out.length > MAX_IDS) throw new IgdbQueryError("Too many ids");
  return out;
}

// ---------------------------------------------------------------------------
// Conditions

declare const conditionBrand: unique symbol;
export type IgdbCondition = { readonly clause: string; readonly [conditionBrand]: true };

function cond(clause: string): IgdbCondition {
  return { clause } as IgdbCondition;
}

type Scalar = number | boolean | null;

function scalar(value: Scalar): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(finite(value));
}

export const where = {
  eq: (name: string, value: Scalar) => cond(`${field(name)} = ${scalar(value)}`),
  neq: (name: string, value: Scalar) => cond(`${field(name)} != ${scalar(value)}`),
  gt: (name: string, value: number) => cond(`${field(name)} > ${finite(value)}`),
  gte: (name: string, value: number) => cond(`${field(name)} >= ${finite(value)}`),
  lt: (name: string, value: number) => cond(`${field(name)} < ${finite(value)}`),
  lte: (name: string, value: number) => cond(`${field(name)} <= ${finite(value)}`),
  /** Field equals any id (scalar) or contains at least one (array field). Ids may be 0 (enums). */
  anyOf: (name: string, ids: readonly number[]) =>
    cond(`${field(name)} = (${enumList(ids).join(",")})`),
  /** Field equals none of the ids (scalar) or contains none of them (array field). */
  noneOf: (name: string, ids: readonly number[]) =>
    cond(`${field(name)} != (${enumList(ids).join(",")})`),
  /** Exact slug match. */
  slug: (name: string, value: string) => {
    if (!validSlug(value)) throw new IgdbQueryError("Invalid slug");
    return cond(`${field(name)} = "${value}"`);
  },
  /** Case-insensitive substring match on plain text. */
  contains: (name: string, text: string) => {
    const safe = plainText(text);
    if (!safe) throw new IgdbQueryError("Empty text filter");
    return cond(`${field(name)} ~ *"${safe}"*`);
  },
  or: (...conditions: IgdbCondition[]) => {
    if (conditions.length === 0) throw new IgdbQueryError("Empty OR");
    return cond(`(${conditions.map(checked).join(" | ")})`);
  },
  and: (...conditions: IgdbCondition[]) => {
    if (conditions.length === 0) throw new IgdbQueryError("Empty AND");
    return cond(`(${conditions.map(checked).join(" & ")})`);
  },
};

function checked(c: IgdbCondition): string {
  if (!c || typeof c.clause !== "string" || !c.clause) {
    throw new IgdbQueryError("Invalid condition");
  }
  return c.clause;
}

// ---------------------------------------------------------------------------
// Queries

export type IgdbQuery = {
  fields: readonly string[];
  exclude?: readonly string[];
  search?: string;
  where?: readonly IgdbCondition[];
  sort?: { field: string; dir: "asc" | "desc" };
  limit?: number;
  offset?: number;
};

export function buildQuery(query: IgdbQuery): string {
  const parts: string[] = [];
  if (query.fields.length > 0) parts.push(`fields ${query.fields.map(field).join(",")};`);
  if (query.exclude && query.exclude.length > 0) {
    parts.push(`exclude ${query.exclude.map(field).join(",")};`);
  }
  if (query.search !== undefined) {
    const term = plainText(query.search);
    if (!term) throw new IgdbQueryError("Empty search");
    if (query.sort) throw new IgdbQueryError("IGDB does not allow sort with search");
    parts.push(`search "${term}";`);
  }
  if (query.where && query.where.length > 0) {
    parts.push(`where ${query.where.map(checked).join(" & ")};`);
  }
  if (query.sort) {
    if (query.sort.dir !== "asc" && query.sort.dir !== "desc") {
      throw new IgdbQueryError("Invalid sort direction");
    }
    parts.push(`sort ${field(query.sort.field)} ${query.sort.dir};`);
  }
  if (query.limit !== undefined) parts.push(`limit ${int(query.limit, 1, MAX_LIMIT, "limit")};`);
  if (query.offset !== undefined) {
    parts.push(`offset ${int(query.offset, 0, MAX_OFFSET, "offset")};`);
  }
  if (parts.length === 0) throw new IgdbQueryError("Empty query");
  return parts.join(" ");
}

export type IgdbSubQuery = {
  /** Result name, echoed back by IGDB. */
  name: string;
  endpoint: Exclude<IgdbEndpoint, "multiquery" | "search">;
  query: IgdbQuery;
};

/** One multiquery body: up to 10 named sub-queries in a single request. */
export function buildMultiquery(queries: readonly IgdbSubQuery[]): string {
  if (queries.length === 0 || queries.length > MAX_MULTIQUERY) {
    throw new IgdbQueryError("A multiquery holds 1 to 10 queries");
  }
  const names = new Set<string>();
  return queries
    .map((q) => {
      if (!QUERY_NAME.test(q.name) || names.has(q.name)) {
        throw new IgdbQueryError("Invalid or duplicate multiquery name");
      }
      names.add(q.name);
      // Checked at runtime too: callers may be untyped (the dev script, a future backend).
      const endpoint: string = q.endpoint;
      if (!isIgdbEndpoint(endpoint) || endpoint === "multiquery" || endpoint === "search") {
        throw new IgdbQueryError("Invalid multiquery endpoint");
      }
      return `query ${q.endpoint} "${q.name}" { ${buildQuery(q.query)} };`;
    })
    .join(" ");
}

// ---------------------------------------------------------------------------
// Field sets and query recipes used by the proof of concept.

export const SUMMARY_FIELDS: readonly string[] = [
  "name",
  "slug",
  "first_release_date",
  "game_type",
  "version_parent",
  "aggregated_rating",
  "aggregated_rating_count",
  "rating",
  "rating_count",
  "hypes",
  "cover.image_id",
  "artworks.image_id",
  "screenshots.image_id",
  "genres.name",
  "genres.slug",
  "themes.name",
  "themes.slug",
  "platforms.name",
  "platforms.platform_family",
  "age_ratings.organization",
  "age_ratings.rating_category.rating",
];

export const DETAIL_FIELDS: readonly string[] = [
  ...SUMMARY_FIELDS,
  "summary",
  "storyline",
  "url",
  "game_status",
  "version_title",
  "parent_game",
  "involved_companies.company.name",
  "involved_companies.company.slug",
  "involved_companies.developer",
  "involved_companies.publisher",
  "alternative_names.name",
  "videos.video_id",
  "collections.name",
  "collections.slug",
  "franchises.name",
  "franchises.slug",
  "remakes",
  "remasters",
  "dlcs",
  "expansions",
  "standalone_expansions",
  "similar_games",
  "websites.url",
  "websites.type",
];

/** IGDB website type for a game's official site (verified live 2026-11-05). */
export const WEBSITE_TYPE_OFFICIAL = 1;

/** Filters every public discovery list applies: standalone games, no editions, no Erotic theme. */
export function publicFilters(): IgdbCondition[] {
  return [
    where.anyOf("game_type", LISTABLE_GAME_TYPES),
    where.eq("version_parent", null),
    where.noneOf("themes", [THEME_EROTIC]),
  ];
}

const DAY = 86_400;

export type IgdbSectionId = "new" | "upcoming" | "acclaimed" | "classics";

/** List recipes for the discovery sections that need no popularity lookup. `nowSec` is Unix seconds. */
export function sectionQuery(id: IgdbSectionId, nowSec: number, limit = 20): IgdbQuery {
  const now = Math.floor(finite(nowSec));
  const base = { fields: SUMMARY_FIELDS, limit };
  switch (id) {
    case "new":
      // Released in the last 90 days, ranked by IGDB hypes (pre-release
      // interest), like RAWG's popularity-ordered "new" row. Newest-first with
      // a floor let day-old shovelware dominate (live check 2026-11-05).
      // Lesser-known games still appear further down: the only floor is "has a
      // cover and at least one hype or rating".
      return {
        ...base,
        where: [
          ...publicFilters(),
          where.neq("cover", null),
          where.gte("first_release_date", now - 90 * DAY),
          where.lte("first_release_date", now),
          where.or(where.gte("hypes", 1), where.gte("total_rating_count", 1)),
        ],
        sort: { field: "hypes", dir: "desc" },
      };
    case "upcoming":
      return {
        ...base,
        where: [
          ...publicFilters(),
          where.neq("cover", null),
          where.gt("first_release_date", now),
          where.lte("first_release_date", now + 365 * DAY),
        ],
        sort: { field: "hypes", dir: "desc" },
      };
    case "acclaimed":
      // Critic score 85+ from at least 10 critic reviews (live check
      // 2026-11-05): a 5-review floor let single-outlet scores and odd records
      // in; 10 keeps BotW, Elden Ring, God of War and friends on top.
      return {
        ...base,
        where: [
          ...publicFilters(),
          where.gte("aggregated_rating", 85),
          where.gte("aggregated_rating_count", 10),
        ],
        sort: { field: "aggregated_rating", dir: "desc" },
      };
    case "classics":
      return {
        ...base,
        where: [
          ...publicFilters(),
          // 1985-01-01 .. 2012-12-31 (UTC)
          where.gte("first_release_date", 473_385_600),
          where.lte("first_release_date", 1_356_998_399),
          // Critic score first. IGDB has few critic reviews for most pre-2000
          // games (Ocarina of Time has none), so a well-rated game with a large
          // user base also qualifies.
          where.or(
            where.and(where.gte("aggregated_rating", 80), where.gte("aggregated_rating_count", 2)),
            where.and(where.gte("total_rating", 85), where.gte("total_rating_count", 100)),
          ),
        ],
        // Among the acclaimed, the most rated first: the best-known classics lead.
        sort: { field: "total_rating_count", dir: "desc" },
      };
  }
}

/**
 * Popular: released games from the blended Playing / Want to Play ranking
 * (unreleased games have their own Coming soon row).
 */
export function popularFilters(nowSec: number): IgdbCondition[] {
  return [
    ...publicFilters(),
    where.neq("first_release_date", null),
    where.lte("first_release_date", Math.floor(finite(nowSec))),
  ];
}

/**
 * IGDB popularity types used for "Popular" (ids verified live 2026-11-05).
 * "Visits" (1) is deliberately unused: it surfaces low-quality page-view spikes.
 */
export const POPULARITY_TYPE = { wantToPlay: 2, playing: 3 } as const;

/** Popular = Playing blended with Want to Play. Two sub-queries for one multiquery. */
export function popularSubqueries(limit = 50): IgdbSubQuery[] {
  return [
    {
      name: "playing",
      endpoint: "popularity_primitives",
      query: popularityQuery(POPULARITY_TYPE.playing, limit),
    },
    {
      name: "want_to_play",
      endpoint: "popularity_primitives",
      query: popularityQuery(POPULARITY_TYPE.wantToPlay, limit),
    },
  ];
}

/** Top game ids for one popularity type. Resolve them with `gamesByIds`. */
export function popularityQuery(popularityType: number, limit = 40): IgdbQuery {
  return {
    fields: ["game_id", "value", "popularity_type"],
    where: [where.eq("popularity_type", int(popularityType, 1, 10_000, "popularity type"))],
    sort: { field: "value", dir: "desc" },
    limit,
  };
}

export function gamesByIds(
  ids: readonly number[],
  fields: readonly string[] = SUMMARY_FIELDS,
): IgdbQuery {
  const list = idList(ids);
  return { fields, where: [where.anyOf("id", list)], limit: list.length };
}

export function gameBySlug(slug: string, fields: readonly string[] = DETAIL_FIELDS): IgdbQuery {
  return { fields, where: [where.slug("slug", slug)], limit: 1 };
}

export function searchQuery(term: string, limit = 20): IgdbQuery {
  return { fields: SUMMARY_FIELDS, search: term, where: publicFilters(), limit };
}
