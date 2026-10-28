// Domain types for Games discovery. RAWG is a metadata provider only; these
// shapes are what the UI consumes after normalization.

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
  rawgId: number;
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

/**
 * Stable reference for future personal-library entries (wishlist, currently
 * playing, tier lists). A snapshot so entries render without RAWG — keyless,
 * offline or after a key change. Not persisted anywhere in Phase 1.
 */
export type GameRef = {
  provider: "rawg";
  rawgId: number;
  slug: string;
  name: string;
  released: string | null;
  image: string | null;
};

export function toGameRef(game: GameSummary): GameRef {
  return {
    provider: "rawg",
    rawgId: game.rawgId,
    slug: game.slug,
    name: game.name,
    released: game.released,
    image: game.image,
  };
}
