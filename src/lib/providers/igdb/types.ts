// IGDB proof-of-concept types (Stage 1). Nothing in the app imports this
// directory yet. Raw shapes cover only the fields we request, using IGDB's
// current names (game_type, game_status, collections, age_ratings.organization
// and rating_category), never the deprecated ones (category, status, collection).
//
// The normalized shapes are an isolated prototype: ids are always
// provider-qualified (`igdb:N`) and there is deliberately no `rawgId`, so an
// IGDB id can never be mistaken for a RAWG one. Stage 2 folds them into the
// shared GameSummary/GameDetail once those become provider-neutral.

import type { NamedRef, PlatformFamily } from "../../game-discovery/types.ts";

export type IgdbGameId = `igdb:${number}`;

export type RawIgdbImage = {
  id?: number;
  image_id?: string;
  width?: number;
  height?: number;
  /** Artworks only: IGDB artwork_type id (or the expanded object). */
  artwork_type?: number | { id?: number };
  alpha_channel?: boolean;
  animated?: boolean;
};
export type RawIgdbNamed = { id?: number; slug?: string; name?: string };
export type RawIgdbPlatform = RawIgdbNamed & {
  abbreviation?: string;
  platform_family?: number | { id?: number; name?: string };
};
export type RawIgdbAgeRating = {
  id?: number;
  organization?: number | { id?: number; name?: string };
  rating_category?: number | { id?: number; rating?: string };
};
export type RawIgdbInvolvedCompany = {
  id?: number;
  company?: number | RawIgdbNamed;
  developer?: boolean;
  publisher?: boolean;
};
export type RawIgdbVideo = { id?: number; name?: string; video_id?: string };
export type RawIgdbWebsite = { id?: number; url?: string; type?: number | { id?: number } };
export type RawIgdbRef = number | { id?: number };

export type RawIgdbGame = {
  id?: number;
  name?: string;
  slug?: string;
  url?: string;
  summary?: string;
  storyline?: string;
  first_release_date?: number;
  game_type?: number | { id?: number; type?: string };
  game_status?: number | { id?: number; status?: string };
  version_parent?: RawIgdbRef;
  version_title?: string;
  parent_game?: RawIgdbRef;
  aggregated_rating?: number;
  aggregated_rating_count?: number;
  rating?: number;
  rating_count?: number;
  total_rating?: number;
  total_rating_count?: number;
  hypes?: number;
  cover?: RawIgdbImage;
  artworks?: RawIgdbImage[];
  screenshots?: RawIgdbImage[];
  videos?: RawIgdbVideo[];
  genres?: RawIgdbNamed[];
  themes?: RawIgdbNamed[];
  platforms?: RawIgdbPlatform[];
  age_ratings?: RawIgdbAgeRating[];
  involved_companies?: RawIgdbInvolvedCompany[];
  websites?: RawIgdbWebsite[];
  collections?: RawIgdbNamed[];
  franchises?: RawIgdbNamed[];
  alternative_names?: { id?: number; name?: string }[];
  remakes?: RawIgdbRef[];
  remasters?: RawIgdbRef[];
  dlcs?: RawIgdbRef[];
  expansions?: RawIgdbRef[];
  standalone_expansions?: RawIgdbRef[];
  similar_games?: RawIgdbRef[];
};

export type IgdbArtKind = "artwork" | "screenshot" | "cover";

/** Landscape-first art choice. `blur` marks a portrait cover shown as a blurred 16:9 fill. */
export type IgdbArt = { url: string; kind: IgdbArtKind; blur: boolean };

export type IgdbGame = {
  id: IgdbGameId;
  igdbId: number;
  slug: string;
  name: string;
  /** ISO date (YYYY-MM-DD, UTC) or null when IGDB has no first release date. */
  released: string | null;
  tba: boolean;
  /** Card art: landscape when there is any usable, else a blurred portrait cover; or null. */
  art: IgdbArt | null;
  /** Hero and backdrop art: large landscape only, never a cover; or null. */
  heroArt: IgdbArt | null;
  /** Portrait cover for cards (cover_big, 264×352), chosen by art.ts; or null. */
  cover: string | null;
  /** IGDB aggregated critic score, 0–100, rounded; null when unrated. */
  criticScore: number | null;
  criticCount: number;
  /** IGDB user score, 0–100, rounded; null when unrated. */
  userScore: number | null;
  userCount: number;
  genres: NamedRef[];
  themes: NamedRef[];
  platformFamilies: PlatformFamily[];
  /** ESRB rating label, for example "M", or null. */
  esrb: string | null;
  /** IGDB game_type id (0 = main game), or null when IGDB omits it. */
  gameType: number | null;
  /** Set when this record is an edition of another game. */
  versionParent: number | null;
  screenshots: string[];
};

export type IgdbGameDetail = IgdbGame & {
  description: string | null;
  storyline: string | null;
  /** The game's igdb.com page (https only), or null. */
  igdbUrl: string | null;
  developers: NamedRef[];
  publishers: NamedRef[];
  platforms: string[];
  alternativeNames: string[];
  /** YouTube video ids. */
  videos: string[];
  collections: NamedRef[];
  franchises: NamedRef[];
  related: {
    parent: number | null;
    remakes: number[];
    remasters: number[];
    dlcs: number[];
    expansions: number[];
    standaloneExpansions: number[];
    similar: number[];
  };
};
