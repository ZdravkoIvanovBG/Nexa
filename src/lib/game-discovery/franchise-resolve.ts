import { curatedSlugs, type FranchiseDef, type FranchiseVariant } from "./franchises.ts";
import type { GameId } from "./game-id.ts";
import type { GameSummary } from "./types.ts";

// Pure franchise resolution. Games are deduplicated by provider-qualified id only and
// classified only by the curated slug lists -- never by name similarity, so
// same-named titles from different eras stay separate.

export type FranchiseGroupId = "main" | "remakes" | "spinoffs" | "editions" | "other";

export type FranchiseSort = "release" | "metacritic" | "story";

export type ResolvedFranchise = {
  groups: Record<FranchiseGroupId, GameSummary[]>;
  mainCount: number;
  firstYear: number | null;
  lastYear: number | null;
  hasStoryOrder: boolean;
};

const GROUP_BY_VARIANT: Record<FranchiseVariant, FranchiseGroupId> = {
  remake: "remakes",
  remaster: "remakes",
  spinoff: "spinoffs",
  edition: "editions",
};

function yearOf(game: GameSummary): number | null {
  return game.released ? Number(game.released.slice(0, 4)) : null;
}

export function sortGames(
  games: GameSummary[],
  sort: FranchiseSort,
  chronology?: string[],
  slugOf: (game: GameSummary) => string = (game) => game.slug,
): GameSummary[] {
  const out = [...games];
  if (sort === "story" && chronology && chronology.length > 0) {
    const rank = new Map(chronology.map((slug, i) => [slug, i]));
    // Story order covers curated games only; the rest keep release order after them.
    const ranked = out.filter((g) => rank.has(slugOf(g)));
    const rest = out.filter((g) => !rank.has(slugOf(g)));
    ranked.sort((a, b) => rank.get(slugOf(a))! - rank.get(slugOf(b))!);
    return [...ranked, ...sortGames(rest, "release")];
  }
  if (sort === "metacritic") {
    // Metacritic for RAWG; a provider's own critic score (IGDB) otherwise.
    const score = (g: GameSummary) => g.metacritic ?? g.criticScore ?? null;
    return out.sort((a, b) => {
      const sa = score(a);
      const sb = score(b);
      if (sa === null && sb === null) return byRelease(a, b);
      if (sa === null) return 1;
      if (sb === null) return -1;
      return sb - sa || byRelease(a, b);
    });
  }
  return out.sort(byRelease);
}

function byRelease(a: GameSummary, b: GameSummary): number {
  if (a.released && b.released && a.released !== b.released) {
    return a.released < b.released ? -1 : 1;
  }
  if (a.released && !b.released) return -1;
  if (!a.released && b.released) return 1;
  return a.name.localeCompare(b.name);
}

/** Curated slugs not already present in `known` -- candidates for individual lookups. */
export function missingCuratedSlugs(def: FranchiseDef, knownSlugs: Iterable<string>): string[] {
  const known = new Set(knownSlugs);
  return curatedSlugs(def).filter((slug) => !known.has(slug));
}

/**
 * @param aliases Game id -> the curated slug that was requested for it, for
 *   games reached through a provider slug redirect (their canonical slug differs
 *   from the catalog's). Matching by id keeps them classified correctly.
 * @param options.curatedOnly Every game came from a reviewed id mapping and
 *   its alias is its curated identity (IGDB). The catalog's `exclude` list
 *   holds RAWG slugs, so it's never compared with another provider's slugs:
 *   IGDB's slug for Tomb Raider (GBC) equals a RAWG duplicate the list hides.
 */
export function resolveFranchise(
  def: FranchiseDef,
  games: (GameSummary | null | undefined)[],
  sort: FranchiseSort = "release",
  aliases: ReadonlyMap<GameId, string> = new Map(),
  options: { curatedOnly?: boolean } = {},
): ResolvedFranchise {
  const byId = new Map<GameId, GameSummary>();
  for (const game of games) {
    if (game && !byId.has(game.id)) byId.set(game.id, game);
  }
  const slugOf = (game: GameSummary) => aliases.get(game.id) ?? game.slug;
  const mainline = new Set(def.mainline);
  const exclude = new Set(def.exclude ?? []);
  const groups: Record<FranchiseGroupId, GameSummary[]> = {
    main: [],
    remakes: [],
    spinoffs: [],
    editions: [],
    other: [],
  };
  for (const game of byId.values()) {
    const slug = slugOf(game);
    if (exclude.has(slug)) continue;
    if (!options.curatedOnly && exclude.has(game.slug)) continue;
    if (mainline.has(slug)) {
      groups.main.push(game);
      continue;
    }
    const variant = def.variants?.[slug];
    groups[variant ? GROUP_BY_VARIANT[variant] : "other"].push(game);
  }
  const effectiveSort = sort === "story" && !def.chronology?.length ? "release" : sort;
  for (const id of Object.keys(groups) as FranchiseGroupId[]) {
    groups[id] = sortGames(groups[id], effectiveSort, def.chronology, slugOf);
  }
  const years = groups.main.map(yearOf).filter((y): y is number => y !== null);
  return {
    groups,
    mainCount: groups.main.length,
    firstYear: years.length ? Math.min(...years) : null,
    lastYear: years.length ? Math.max(...years) : null,
    hasStoryOrder: (def.chronology?.length ?? 0) > 0,
  };
}
