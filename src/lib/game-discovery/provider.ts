// The seam between Games Discovery and a metadata provider (RAWG today; IGDB
// is being prepared behind it). Views and hooks talk only to this interface
// and to the normalized types, never to a provider's API or ids.
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

/** The provider Nexa uses. Stage 2: RAWG only; IGDB is not active anywhere. */
export const ACTIVE_GAME_PROVIDER: GameProvider = "rawg";

export type RelatedKind = "game-series" | "additions" | "parent-games";

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
  ): Promise<GamePage>;
  /** A game by id or provider slug; null when the provider has no such game. */
  detail(idOrSlug: GameId | string, signal?: AbortSignal): Promise<GameDetail | null>;
  /** Full-size screenshot URLs. */
  screenshots(id: GameId, signal?: AbortSignal): Promise<string[]>;
  related(id: GameId, kind: RelatedKind, signal?: AbortSignal): Promise<GameSummary[]>;
  /** Raw material for a curated franchise page; classification stays in franchise-resolve. */
  franchise(def: FranchiseDef, lookup: DetailLookup, signal?: AbortSignal): Promise<FranchiseData>;
}
