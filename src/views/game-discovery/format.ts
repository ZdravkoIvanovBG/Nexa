import type { GameSummary, PlatformFamily } from "@/lib/game-discovery/types";

const PLATFORM_SHORT: Record<PlatformFamily, string> = {
  pc: "PC",
  playstation: "PS",
  xbox: "Xbox",
  nintendo: "Nintendo",
  mac: "Mac",
  linux: "Linux",
  ios: "iOS",
  android: "Android",
  web: "Web",
  other: "",
};

export function releaseYear(game: Pick<GameSummary, "released" | "tba">): string | null {
  if (game.released) return game.released.slice(0, 4);
  return game.tba ? "TBA" : null;
}

/** Up to `max` platform labels, plus "+n" for the rest. */
export function platformLabels(families: PlatformFamily[], max = 3): string[] {
  const labels = families.map((f) => PLATFORM_SHORT[f]).filter(Boolean);
  if (labels.length <= max) return labels;
  return [...labels.slice(0, max), `+${labels.length - max}`];
}

/** Metacritic's own colour bands. */
export function metacriticTone(score: number): string {
  if (score >= 75) return "bg-[#66cc33]/15 text-[#7fdb4c] ring-[#66cc33]/35";
  if (score >= 50) return "bg-[#ffcc33]/15 text-[#ffd75a] ring-[#ffcc33]/35";
  return "bg-[#ff0000]/15 text-[#ff6b6b] ring-[#ff0000]/35";
}

export function formatReleaseDate(iso: string | null, locale?: string): string | null {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" });
}

/**
 * The critic score a game shows: RAWG's Metacritic, or a provider's own critic
 * score (IGDB) labelled as such. Never both, never relabelled.
 */
export function criticScoreOf(
  game: Pick<GameSummary, "metacritic" | "criticScore" | "criticCount">,
): { score: number; label: "Metacritic" | "Critic score"; count: number } | null {
  if (game.metacritic !== null) return { score: game.metacritic, label: "Metacritic", count: 0 };
  if (typeof game.criticScore === "number") {
    return { score: game.criticScore, label: "Critic score", count: game.criticCount ?? 0 };
  }
  return null;
}

/** IGDB's 0–100 user score, when the game has one. RAWG's 0–5 rating stays separate. */
export function userScoreOf(
  game: Pick<GameSummary, "userScore" | "userCount">,
): { score: number; count: number } | null {
  return typeof game.userScore === "number"
    ? { score: game.userScore, count: game.userCount ?? 0 }
    : null;
}

/** Pill label for a record that isn't a main game. */
export const VARIANT_LABEL: Record<NonNullable<GameSummary["variant"]>, string> = {
  dlc: "DLC",
  expansion: "Expansion",
  bundle: "Bundle",
  standalone: "Standalone expansion",
  mod: "Mod",
  episode: "Episode",
  season: "Season",
  remake: "Remake",
  remaster: "Remaster",
  expanded: "Expanded edition",
  port: "Port",
  fork: "Fork",
  pack: "Pack",
  update: "Update",
  edition: "Edition",
};
