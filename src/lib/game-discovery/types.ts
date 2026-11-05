// Domain types for Games discovery. Metadata providers (RAWG today) normalize
// into these shapes; the UI consumes nothing else. Game identity is always
// provider-qualified (see game-id.ts), so no view depends on a provider's ids.

import { parseGameId, type GameId } from "./game-id.ts";

export type { GameId, GameProvider } from "./game-id.ts";

export type PlatformFamily =
  | "pc"
  | "playstation"
  | "xbox"
  | "nintendo"
  | "mac"
  | "linux"
  | "ios"
  | "android"
  | "web"
  | "other";

export type NamedRef = { id: number; slug: string; name: string };

export type GameSummary = {
  /** Provider-qualified identity, e.g. "rawg:3328". */
  id: GameId;
  /** The provider's own slug; only meaningful to that provider. */
  slug: string;
  name: string;
  /** ISO date (YYYY-MM-DD) or null when unknown. */
  released: string | null;
  tba: boolean;
  image: string | null;
  /** Metacritic score 0–100, or null when RAWG has none. */
  metacritic: number | null;
  /** RAWG community rating 0–5, or null when unrated. */
  rating: number | null;
  ratingsCount: number;
  /** Number of RAWG users who added the game to a library — RAWG's popularity signal. */
  added: number;
  genres: NamedRef[];
  platformFamilies: PlatformFamily[];
  esrb: string | null;
  /** Up to ~6 screenshot URLs included in list responses. */
  shortScreenshots: string[];
};

export type GameDetail = GameSummary & {
  description: string | null;
  imageAlt: string | null;
  website: string | null;
  developers: NamedRef[];
  publishers: NamedRef[];
  platforms: { name: string; releasedAt: string | null }[];
  tags: NamedRef[];
  /** Average playtime in hours, or null. */
  playtime: number | null;
  alternativeNames: string[];
  counts: {
    screenshots: number;
    series: number;
    additions: number;
    parents: number;
  };
};

export type GamePage = {
  items: GameSummary[];
  count: number;
  hasMore: boolean;
};

export type GameOrdering = "-added" | "-released" | "-metacritic" | "-rating" | "name";

/** Filter for RAWG /games list queries (RAWG parameter semantics). */
export type GameListFilter = {
  search?: string;
  genres?: string;
  tags?: string;
  parentPlatforms?: string;
  developers?: string;
  dates?: string;
  metacritic?: string;
  ordering?: GameOrdering;
};

/** Spec for the Browse / search frame. */
export type GameBrowseSpec = {
  title: string;
  kicker?: string;
  filter: GameListFilter;
  /** Focus the search field when the frame opens. */
  focusSearch?: boolean;
};

type GameRefSnapshot = {
  slug: string;
  name: string;
  released: string | null;
  image: string | null;
};

/**
 * Snapshot reference stored in personal-library records (wishlist, currently
 * playing, tier list), so entries render without any provider: keyless,
 * offline or after a key change. Persisted; the RAWG shape is exactly the one
 * saved before providers became pluggable, so existing records never change.
 */
export type RawgGameRef = GameRefSnapshot & { provider: "rawg"; rawgId: number };
export type IgdbGameRef = GameRefSnapshot & { provider: "igdb"; igdbId: number };
export type GameRef = RawgGameRef | IgdbGameRef;

export function toGameRef(game: GameSummary): GameRef {
  const parsed = parseGameId(game.id);
  if (!parsed) throw new RangeError("Invalid game id");
  const snapshot = {
    slug: game.slug,
    name: game.name,
    released: game.released,
    image: game.image,
  };
  return parsed.provider === "rawg"
    ? { provider: "rawg", rawgId: parsed.providerId, ...snapshot }
    : { provider: "igdb", igdbId: parsed.providerId, ...snapshot };
}

/** The provider-qualified id a snapshot reference belongs to. */
export function gameIdOfRef(ref: GameRef): GameId {
  return ref.provider === "rawg" ? `rawg:${ref.rawgId}` : `igdb:${ref.igdbId}`;
}
