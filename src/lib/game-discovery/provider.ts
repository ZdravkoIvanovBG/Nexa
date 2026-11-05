// The seam between Games Discovery and a metadata provider. Views and hooks
// talk only to this interface and to the normalized types, never to a
// provider's API or ids.
//
// Exactly one provider is active per session, and nothing falls back to
// another provider at runtime: mixing providers would put two ids for the same
// game in one list. A provider asked about another provider's game id answers
// "not found" without making a request.
//
// No runtime imports, so providers can be tested under `node --test`.

import type { FranchiseDef } from "./franchises.ts";
import type { GameId, GameProvider } from "./game-id.ts";
import type { GameDetail, GameListFilter, GamePage, GameSummary } from "./types.ts";

/**
 * The provider every production build uses. IGDB can be made active only in
 * development builds, through the switch in dev-provider.ts (Stage 4).
 */
export const PRODUCTION_GAME_PROVIDER: GameProvider = "rawg";

/** The provider Games Discovery uses until the development switch is wired in. */
export const ACTIVE_GAME_PROVIDER: GameProvider = PRODUCTION_GAME_PROVIDER;

/**
 * Related-game rows. RAWG serves the first three; IGDB serves additions,
 * parent-games, versions (remakes and remasters) and similar. A provider
 * answers an unsupported kind with an empty list and no request.
 */
export type RelatedKind = "game-series" | "additions" | "parent-games" | "versions" | "similar";

/**
 * A detail lookup shared with the app's query cache, so franchise loading reuses
 * (and seeds) the same cached detail entries as the game page.
 */
export type DetailLookup = (idOrSlug: GameId | string) => Promise<GameDetail | null>;

export type FranchiseData = {
  def: FranchiseDef;
  games: GameSummary[];
  /** Game id -> the curated slug requested for it, when the provider's slug differs. */
  aliases: Map<GameId, string>;
  /** False when the provider can't list series members for this key or plan. */
  seriesAvailable: boolean;
};

/** What a provider can back in the UI. */
export type ProviderFeatures = {
  /** Curated franchise pages (the catalog is keyed by RAWG slugs until Stage 5). */
  franchises: boolean;
  /** Saving to the Game Library from Discovery (IGDB saves arrive in Stage 6). */
  librarySaves: boolean;
};

const FEATURES: Record<GameProvider, ProviderFeatures> = {
  rawg: { franchises: true, librarySaves: true },
  igdb: { franchises: false, librarySaves: false },
};

export function providerFeatures(provider: GameProvider): ProviderFeatures {
  return FEATURES[provider];
}

export type ListOptions = {
  /** Also count every match (Browse's first page). Costs IGDB one more request. */
  withCount?: boolean;
};

export interface GameMetadataProvider {
  readonly id: GameProvider;
  /**
   * Cache scope for query keys: changes when credentials change so stale
   * results aren't reused, and never contains a credential.
   */
  readonly scope: string;
  /** One page of a filtered list. `filter` uses Nexa's list semantics. */
  list(
    filter: GameListFilter,
    page: number,
    pageSize: number,
    signal?: AbortSignal,
    options?: ListOptions,
  ): Promise<GamePage>;
  /** A game by id or provider slug; null when the provider has no such game. */
  detail(idOrSlug: GameId | string, signal?: AbortSignal): Promise<GameDetail | null>;
  /** Full-size screenshot URLs. `lookup` lets a provider reuse the cached detail. */
  screenshots(id: GameId, signal?: AbortSignal, lookup?: DetailLookup): Promise<string[]>;
  related(
    id: GameId,
    kind: RelatedKind,
    signal?: AbortSignal,
    lookup?: DetailLookup,
  ): Promise<GameSummary[]>;
  /** Raw material for a curated franchise page; classification stays in franchise-resolve. */
  franchise(def: FranchiseDef, lookup: DetailLookup, signal?: AbortSignal): Promise<FranchiseData>;
}
