/** First two segments of every Games Discovery query key. */
export const GAMES_QUERY_ROOT = ["harbor", "games"] as const;

export type ActiveGamesCache = { provider: string; scope: string } | null;

/**
 * True for a Games query that must not outlive the current state: Games is
 * off (`active` null), or the query belongs to another provider or to an older
 * credential scope. Other queries (Movies, Shows…) are never matched.
 */
export function isStaleGamesQuery(key: readonly unknown[], active: ActiveGamesCache): boolean {
  if (key[0] !== GAMES_QUERY_ROOT[0] || key[1] !== GAMES_QUERY_ROOT[1]) return false;
  if (!active) return true;
  return key[2] !== active.provider || key[3] !== active.scope;
}
