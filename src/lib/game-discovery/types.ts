// Domain types for Games discovery. Metadata providers (RAWG, and IGDB behind
// the development switch) normalize into these shapes; the UI consumes nothing
// else. Game identity is always
// provider-qualified (see game-id.ts), so no view depends on a provider's ids.

import { parseGameId, type GameId, type GameProvider } from "./game-id.ts";

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
  // Provider-neutral extras. Optional, so RAWG summaries (and saved snapshots)
  // keep exactly the shape they had before IGDB existed.
  /** Critic score 0–100 from a provider without Metacritic (IGDB's aggregated rating). */
  criticScore?: number | null;
  criticCount?: number;
  /** User score on a 0–100 scale (IGDB). RAWG's 0–5 rating stays in `rating`. */
  userScore?: number | null;
  userCount?: number;
  /**
   * Portrait box art for cover cards (IGDB). Null: no usable cover, so the card
   * shows landscape art or a titled placeholder. Undefined (RAWG): RAWG has no
   * covers and keeps its landscape cards.
   */
  cover?: string | null;
  /** "portrait" when `image` is a cover, not landscape art: never crop it to 16:9. */
  imageKind?: "portrait";
  /**
   * Large landscape art for the hero and the game page backdrop, chosen apart
   * from the card art (IGDB). Null: the provider has nothing big enough, so the
   * game isn't a hero slide. Undefined (RAWG): use `image`.
   */
  heroImage?: string | null;
  /** What the record is when it isn't a main game (IGDB game_type / editions). */
  variant?: GameVariant;
};

export type GameVariant =
  | "dlc"
  | "expansion"
  | "bundle"
  | "standalone"
  | "mod"
  | "episode"
  | "season"
  | "remake"
  | "remaster"
  | "expanded"
  | "port"
  | "fork"
  | "pack"
  | "update"
  | "edition";

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
    /** Remakes and remasters (IGDB). */
    versions?: number;
    /** Similar games (IGDB). */
    similar?: number;
  };
  /** Story text when the provider keeps it apart from the description (IGDB). */
  storyline?: string | null;
  /** The game's page on the provider's site, already validated (IGDB). */
  providerUrl?: string | null;
  /** Every screenshot, full size, when the detail response carries them (IGDB). */
  screenshots?: string[];
  /** Related games by provider-qualified id (IGDB); read by the provider's `related`. */
  relations?: {
    parents: GameId[];
    versions: GameId[];
    additions: GameId[];
    similar: GameId[];
  };
};

export type GamePage = {
  items: GameSummary[];
  /** Total matches, or null when the provider didn't count them. */
  count: number | null;
  hasMore: boolean;
};

/** Discovery rows. Defined here so list filters can name one. */
export type GameSectionId = "popular" | "new" | "acclaimed" | "upcoming" | "classics";

export type GameOrdering = "-added" | "-released" | "-metacritic" | "-rating" | "name";

/**
 * Filter for list queries. The values use RAWG's vocabulary (genre slugs, the
 * horror tag, parent-platform ids, "a,b" date and score ranges), which is also
 * the category vocabulary of the genre tiles and Browse pills; IGDB translates
 * it. `developers` is the active provider's own company id. `section` names a
 * Discovery row whose recipe the provider defines itself (IGDB only).
 */
export type GameListFilter = {
  section?: GameSectionId;
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
  /**
   * Set when the filter holds provider-specific ids or recipes (a developer id,
   * an IGDB section). Browse refuses to run it under another provider.
   */
  provider?: GameProvider;
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

/**
 * The snapshot a save stores. RAWG keeps its landscape art, exactly as before.
 * IGDB stores the portrait cover its cards use (Stage 4B), or its landscape
 * art when it has no usable cover; snapshotSummary tells the two apart by URL.
 */
export function toGameRef(game: GameSummary): GameRef {
  const parsed = parseGameId(game.id);
  if (!parsed) throw new RangeError("Invalid game id");
  const snapshot = {
    slug: game.slug,
    name: game.name,
    released: game.released,
    image: game.image,
  };
  if (parsed.provider === "rawg")
    return { provider: "rawg", rawgId: parsed.providerId, ...snapshot };
  return {
    provider: "igdb",
    igdbId: parsed.providerId,
    ...snapshot,
    image: game.cover ?? game.image,
  };
}

/** The provider-qualified id a snapshot reference belongs to. */
export function gameIdOfRef(ref: GameRef): GameId {
  return ref.provider === "rawg" ? `rawg:${ref.rawgId}` : `igdb:${ref.igdbId}`;
}
