import type { GameEntry, GamePlatform, GameSort } from "./types";

export function filterByPlatform(games: GameEntry[], platform: GamePlatform | "all"): GameEntry[] {
  if (platform === "all") return games;
  return games.filter((g) => g.platform === platform);
}

export function matchesSearch(games: GameEntry[], search: string): GameEntry[] {
  const q = search.trim().toLowerCase();
  if (!q) return games;
  return games.filter(
    (g) => g.title.toLowerCase().includes(q) || g.developer?.toLowerCase().includes(q),
  );
}

function sortKey(title: string): string {
  const lower = title.trim().toLowerCase();
  for (const article of ["the ", "a ", "an "]) {
    if (lower.startsWith(article)) return lower.slice(article.length);
  }
  return lower;
}

export function sortEntries(games: GameEntry[], sort: GameSort): GameEntry[] {
  const list = [...games];
  switch (sort) {
    case "playtime":
      return list.sort(
        (a, b) =>
          b.totalPlaytimeMinutes - a.totalPlaytimeMinutes ||
          sortKey(a.title).localeCompare(sortKey(b.title)),
      );
    case "alpha":
      return list.sort((a, b) => sortKey(a.title).localeCompare(sortKey(b.title)));
    case "recent":
    default:
      return list.sort((a, b) => {
        if (a.lastPlayedAt == null && b.lastPlayedAt == null) {
          return sortKey(a.title).localeCompare(sortKey(b.title));
        }
        if (a.lastPlayedAt == null) return 1;
        if (b.lastPlayedAt == null) return -1;
        return b.lastPlayedAt - a.lastPlayedAt;
      });
  }
}
