// Translates Games Discovery list filters into IGDB query plans (Stage 4).
//
// Discovery's filter vocabulary is RAWG's: the genre tiles and Browse pills
// carry RAWG genre slugs, the "horror" tag and RAWG parent-platform ids, and
// date and score ranges are "a,b" strings. Nothing here sends those values to
// IGDB: each one is mapped to IGDB genre, theme and platform ids verified
// against the live API (2026-11-05). A value with no mapping makes the plan
// "none": an empty result and no request, never a guess.
//
// Every plan includes the public filters (standalone games, no editions, no
// Erotic theme). Pure: no requests, no app state.

import type { GameListFilter, GameSectionId } from "../../game-discovery/types.ts";
import {
  plainText,
  popularFilters,
  publicFilters,
  sectionQuery,
  where,
  type IgdbCondition,
  type IgdbQuery,
} from "./query.ts";

export type IgdbSort = NonNullable<IgdbQuery["sort"]>;

export type IgdbListPlan =
  /** The filter can't be expressed on IGDB: answer empty without a request. */
  | { kind: "none" }
  /**
   * Games from the blended popularity ranking. With `sort` null and nothing
   * narrowing it they keep the ranking's order; otherwise the ranked pool is
   * queried (re-sorted, or filtered by genre, platform or name).
   */
  | { kind: "popular"; where: IgdbCondition[]; sort: IgdbSort | null; narrowed: boolean }
  | { kind: "query"; where: IgdbCondition[]; sort: IgdbSort | null; search: string | null };

/** IGDB theme ids used by the tiles (verified live). */
export const IGDB_THEME = { action: 1, horror: 19 } as const;

type Match = { genres?: number[]; themes?: number[] };

// RAWG genre slug -> IGDB. "Action" is a theme on IGDB, not a genre.
const GENRES: Record<string, Match> = {
  action: { themes: [IGDB_THEME.action] },
  "role-playing-games-rpg": { genres: [12] },
  adventure: { genres: [31] },
  // Strategy, Real Time Strategy, Turn-based strategy.
  strategy: { genres: [15, 11, 16] },
  shooter: { genres: [5] },
  indie: { genres: [32] },
  racing: { genres: [10] },
  puzzle: { genres: [9] },
  sports: { genres: [14] },
};

// RAWG tags -> IGDB. Horror is a theme on IGDB too.
const TAGS: Record<string, Match> = {
  horror: { themes: [IGDB_THEME.horror] },
};

// RAWG parent-platform id -> IGDB platforms (ids) or platform families.
type PlatformMatch = { platforms?: number[]; families?: number[] };
const PARENT_PLATFORMS: Record<string, PlatformMatch> = {
  "1": { platforms: [6] }, // PC (Microsoft Windows)
  "2": { families: [1] }, // PlayStation
  "3": { families: [2] }, // Xbox
  "4": { platforms: [39] }, // iOS
  "5": { platforms: [14] }, // Mac
  "6": { platforms: [3] }, // Linux
  "7": { families: [5] }, // Nintendo
  "8": { platforms: [34] }, // Android
};

/** The ordering a section's own recipe uses, so Browse opened from a row shows it. */
export const SECTION_ORDERING: Record<GameSectionId, NonNullable<GameListFilter["ordering"]>> = {
  popular: "-added",
  new: "-added",
  upcoming: "-added",
  acclaimed: "-metacritic",
  classics: "-added",
};

const DAY = 86_400;

/** Conditions in order, each once (recipes and orderings can add the same one). */
function unique(conditions: IgdbCondition[]): IgdbCondition[] {
  const seen = new Set<string>();
  return conditions.filter((c) => !seen.has(c.clause) && !!seen.add(c.clause));
}

function list(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function categoryCondition(slugs: string[], table: Record<string, Match>): IgdbCondition | null {
  const genres: number[] = [];
  const themes: number[] = [];
  for (const slug of slugs) {
    const match = Object.hasOwn(table, slug) ? table[slug] : undefined;
    if (!match) return null;
    genres.push(...(match.genres ?? []));
    themes.push(...(match.themes ?? []));
  }
  const parts: IgdbCondition[] = [];
  if (genres.length > 0) parts.push(where.anyOf("genres", genres));
  if (themes.length > 0) parts.push(where.anyOf("themes", themes));
  if (parts.length === 0) return null;
  return parts.length === 1 ? parts[0] : where.or(...parts);
}

function platformCondition(ids: string[]): IgdbCondition | null {
  const platforms: number[] = [];
  const families: number[] = [];
  for (const id of ids) {
    const match = Object.hasOwn(PARENT_PLATFORMS, id) ? PARENT_PLATFORMS[id] : undefined;
    if (!match) return null;
    platforms.push(...(match.platforms ?? []));
    families.push(...(match.families ?? []));
  }
  const parts: IgdbCondition[] = [];
  if (platforms.length > 0) parts.push(where.anyOf("platforms", platforms));
  if (families.length > 0) parts.push(where.anyOf("platforms.platform_family", families));
  if (parts.length === 0) return null;
  return parts.length === 1 ? parts[0] : where.or(...parts);
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "YYYY-MM-DD" as Unix seconds (UTC); `endOfDay` gives the day's last second. */
function isoSeconds(value: string, endOfDay: boolean): number | null {
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 1000) + (endOfDay ? DAY - 1 : 0);
}

function dateConditions(value: string): IgdbCondition[] | null {
  const [from, to, ...rest] = value.split(",");
  if (rest.length > 0 || !from || !to) return null;
  const start = isoSeconds(from, false);
  const end = isoSeconds(to, true);
  if (start === null || end === null || end < start) return null;
  return [where.gte("first_release_date", start), where.lte("first_release_date", end)];
}

function scoreConditions(value: string): IgdbCondition[] | null {
  const [from, to, ...rest] = value.split(",");
  const min = Number(from);
  const max = Number(to);
  if (rest.length > 0 || !Number.isInteger(min) || !Number.isInteger(max)) return null;
  if (min < 0 || max > 100 || max < min) return null;
  return [
    where.gte("aggregated_rating", min),
    where.lte("aggregated_rating", max),
    where.gte("aggregated_rating_count", 3),
  ];
}

const COMPANY_ID = /^[1-9]\d{0,15}$/;

/** A floor that hides records nobody has rated or followed (most shovelware). */
function engagementFloor(): IgdbCondition {
  return where.or(where.gte("hypes", 1), where.gte("total_rating_count", 1));
}

function orderingSort(
  ordering: GameListFilter["ordering"],
  extra: IgdbCondition[],
): IgdbSort | null {
  switch (ordering) {
    case "-released":
      extra.push(where.neq("first_release_date", null));
      return { field: "first_release_date", dir: "desc" };
    case "-metacritic":
      extra.push(where.gte("aggregated_rating_count", 3));
      return { field: "aggregated_rating", dir: "desc" };
    case "-rating":
      extra.push(where.gte("rating_count", 10));
      return { field: "rating", dir: "desc" };
    case "name":
      return { field: "name", dir: "asc" };
    case "-added":
    case undefined:
      return null;
  }
}

/**
 * The IGDB plan for a Discovery list filter at `nowSec` (Unix seconds).
 *
 * - Sections use their tuned recipe; another Browse ordering keeps the
 *   recipe's conditions and changes only the sort.
 * - Searching with no ordering uses IGDB's relevance search. IGDB can't sort a
 *   search, so a search with an ordering becomes a name match instead.
 * - Plain Browse sorts "Popular" by how many people rated the game.
 */
export function planList(filter: GameListFilter, nowSec: number): IgdbListPlan {
  const now = Math.floor(nowSec);
  const conditions: IgdbCondition[] = [];

  const genre = list(filter.genres);
  if (genre.length > 0) {
    const c = categoryCondition(genre, GENRES);
    if (!c) return { kind: "none" };
    conditions.push(c);
  }
  const tags = list(filter.tags);
  if (tags.length > 0) {
    const c = categoryCondition(tags, TAGS);
    if (!c) return { kind: "none" };
    conditions.push(c);
  }
  const platforms = list(filter.parentPlatforms);
  if (platforms.length > 0) {
    const c = platformCondition(platforms);
    if (!c) return { kind: "none" };
    conditions.push(c);
  }
  if (filter.developers !== undefined) {
    const id = filter.developers.trim();
    if (!COMPANY_ID.test(id)) return { kind: "none" };
    conditions.push(
      where.anyOf("involved_companies.company", [Number(id)]),
      where.eq("involved_companies.developer", true),
    );
  }
  if (filter.dates) {
    const c = dateConditions(filter.dates);
    if (!c) return { kind: "none" };
    conditions.push(...c);
  }
  if (filter.metacritic) {
    const c = scoreConditions(filter.metacritic);
    if (!c) return { kind: "none" };
    conditions.push(...c);
  }

  const term = filter.search !== undefined ? plainText(filter.search) : null;
  if (filter.search !== undefined && !term) return { kind: "none" };

  const section = filter.section;
  const ordering =
    section && filter.ordering === SECTION_ORDERING[section] ? undefined : filter.ordering;
  const extra: IgdbCondition[] = [];
  const sort = orderingSort(ordering, extra);

  if (section === "popular") {
    if (term) conditions.push(where.contains("name", term));
    return {
      kind: "popular",
      where: unique([...popularFilters(now), ...conditions, ...extra]),
      sort,
      narrowed: conditions.length > 0,
    };
  }

  if (section) {
    const recipe = sectionQuery(section, now);
    const base = [...(recipe.where ?? []), ...conditions, ...extra];
    if (term) base.push(where.contains("name", term));
    return { kind: "query", where: unique(base), sort: sort ?? recipe.sort ?? null, search: null };
  }

  const base = [...publicFilters(), ...conditions, ...extra];
  if (term) {
    if (!sort) return { kind: "query", where: unique(base), sort: null, search: term };
    return {
      kind: "query",
      where: unique([...base, where.contains("name", term)]),
      sort,
      search: null,
    };
  }
  // Plain Browse: hide records without art; a date, score or name sort also
  // hides records nobody has rated or followed, which would otherwise lead.
  base.push(where.neq("cover", null));
  if (ordering === "-released") {
    base.push(where.lte("first_release_date", now), engagementFloor());
  } else if (ordering === "name") {
    base.push(engagementFloor());
  }
  return {
    kind: "query",
    where: unique(base),
    sort: sort ?? { field: "total_rating_count", dir: "desc" },
    search: null,
  };
}
