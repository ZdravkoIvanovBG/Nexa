// Blends IGDB popularity lists (Playing, Want to Play) into one ranking for a
// future "Popular" row. Pure and deterministic.
//
// Reciprocal-rank fusion: a game scores 1 / (k + rank) in each list it appears
// in (rank from 0), summed across lists. Rank-based rather than value-based,
// because the two lists measure different things on different scales. A game
// near the top of both lists beats one at the top of only one; ties break on
// the best single rank, then on the IGDB id, so the order is stable.

export type PopularityPrimitive = { game_id?: unknown; value?: unknown };

const DEFAULT_K = 10;

function rankedIds(list: unknown): number[] {
  if (!Array.isArray(list)) return [];
  const rows = (list as PopularityPrimitive[])
    .filter(
      (p): p is { game_id: number; value: number } =>
        !!p &&
        typeof p.game_id === "number" &&
        Number.isSafeInteger(p.game_id) &&
        p.game_id > 0 &&
        typeof p.value === "number" &&
        Number.isFinite(p.value),
    )
    // IGDB already sorts by value; sort again so the blend never depends on response order.
    .sort((a, b) => b.value - a.value || a.game_id - b.game_id);
  const out: number[] = [];
  for (const row of rows) if (!out.includes(row.game_id)) out.push(row.game_id);
  return out;
}

export function blendPopularity(
  lists: readonly unknown[],
  options: { k?: number; limit?: number } = {},
): number[] {
  const k = options.k ?? DEFAULT_K;
  const score = new Map<number, number>();
  const bestRank = new Map<number, number>();
  for (const list of lists) {
    rankedIds(list).forEach((id, rank) => {
      score.set(id, (score.get(id) ?? 0) + 1 / (k + rank));
      bestRank.set(id, Math.min(bestRank.get(id) ?? Infinity, rank));
    });
  }
  const ids = [...score.keys()].sort(
    (a, b) => score.get(b)! - score.get(a)! || bestRank.get(a)! - bestRank.get(b)! || a - b,
  );
  return options.limit === undefined ? ids : ids.slice(0, Math.max(0, options.limit));
}

/** Reorder fetched games to match a ranking; games missing from the ranking go last. */
export function orderByRanking<T extends { igdbId: number }>(
  games: readonly T[],
  ranking: readonly number[],
): T[] {
  const position = new Map(ranking.map((id, i) => [id, i]));
  return [...games].sort(
    (a, b) =>
      (position.get(a.igdbId) ?? Infinity) - (position.get(b.igdbId) ?? Infinity) ||
      a.igdbId - b.igdbId,
  );
}
