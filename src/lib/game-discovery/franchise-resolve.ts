import type { FranchiseDef, FranchiseVariant } from "./franchises.ts";
import type { GameSummary } from "./types.ts";

// Pure franchise resolution. Games are deduplicated by RAWG id only and
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
): GameSummary[] {
  const out = [...games];
  if (sort === "story" && chronology && chronology.length > 0) {
    const rank = new Map(chronology.map((slug, i) => [slug, i]));
    // Story order covers curated games only; the rest keep release order after them.
    const ranked = out.filter((g) => rank.has(g.slug));
    const rest = out.filter((g) => !rank.has(g.slug));
    ranked.sort((a, b) => rank.get(a.slug)! - rank.get(b.slug)!);
    return [...ranked, ...sortGames(rest, "release")];
  }
  if (sort === "metacritic") {
    return out.sort((a, b) => {
      if (a.metacritic === null && b.metacritic === null) return byRelease(a, b);
      if (a.metacritic === null) return 1;
      if (b.metacritic === null) return -1;
      return b.metacritic - a.metacritic || byRelease(a, b);
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
  const curated = [...def.mainline, ...Object.keys(def.variants ?? {})];
  return curated.filter((slug) => !known.has(slug));
}

export function resolveFranchise(
  def: FranchiseDef,
  games: (GameSummary | null | undefined)[],
  sort: FranchiseSort = "release",
): ResolvedFranchise {
  const byId = new Map<number, GameSummary>();
  for (const game of games) {
    if (game && !byId.has(game.rawgId)) byId.set(game.rawgId, game);
  }
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
    if (exclude.has(game.slug)) continue;
    if (mainline.has(game.slug)) {
      groups.main.push(game);
      continue;
    }
    const variant = def.variants?.[game.slug];
    groups[variant ? GROUP_BY_VARIANT[variant] : "other"].push(game);
  }
  const effectiveSort = sort === "story" && !def.chronology?.length ? "release" : sort;
  for (const id of Object.keys(groups) as FranchiseGroupId[]) {
    groups[id] = sortGames(groups[id], effectiveSort, def.chronology);
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
