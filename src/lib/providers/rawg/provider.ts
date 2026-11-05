// RAWG behind the GameMetadataProvider seam. The requests are exactly the ones
// Games Discovery made before the seam existed (same paths, params, redirect
// handling, series paging and lookup cap); only the ids handed back are now
// provider-qualified ("rawg:N").
//
// Takes the client as a parameter (no app imports), so it runs under `node --test`.

import { missingCuratedSlugs } from "../../game-discovery/franchise-resolve.ts";
import type { FranchiseDef } from "../../game-discovery/franchises.ts";
import { parseGameId, rawgIdOf, type GameId } from "../../game-discovery/game-id.ts";
import type {
  DetailLookup,
  FranchiseData,
  GameMetadataProvider,
  RelatedKind,
} from "../../game-discovery/provider.ts";
import { listParams } from "../../game-discovery/sections.ts";
import type { GameDetail, GameSummary } from "../../game-discovery/types.ts";
import { isRawgError, type RawgAuth, type RawgClient, type RawgParams } from "./client.ts";
import { getGameDetailRaw } from "./detail.ts";
import { normalizeGameDetail, normalizeGamePage, normalizeScreenshots } from "./normalize.ts";
import type { RawgGameDetail, RawgListGame, RawgPage, RawgScreenshot } from "./types.ts";

export const SERIES_PAGE_LIMIT = 3;
export const MAX_CURATED_LOOKUPS = 6;

/**
 * The RAWG path segment for a lookup: the number of a rawg: id, or a slug.
 * Null for another provider's id (or anything id-shaped that isn't valid), so
 * a RAWG request is never made with a foreign number.
 */
export function rawgLookupKey(idOrSlug: GameId | string): number | string | null {
  const parsed = parseGameId(idOrSlug);
  if (parsed) return parsed.provider === "rawg" ? parsed.providerId : null;
  if (typeof idOrSlug !== "string" || idOrSlug === "" || idOrSlug.includes(":")) return null;
  return idOrSlug;
}

export function createRawgProvider(
  client: Pick<RawgClient, "get">,
  auth: RawgAuth,
  scope: string,
): GameMetadataProvider {
  const get = <T>(path: string, params: RawgParams, signal?: AbortSignal) =>
    client.get<T>(path, params, auth, signal);

  async function detail(
    idOrSlug: GameId | string,
    signal?: AbortSignal,
  ): Promise<GameDetail | null> {
    const key = rawgLookupKey(idOrSlug);
    if (key === null) return null;
    try {
      const raw = await getGameDetailRaw((path) => get<RawgGameDetail>(path, {}, signal), key);
      return normalizeGameDetail(raw);
    } catch (error) {
      if (isRawgError(error) && error.kind === "not_found") return null;
      throw error;
    }
  }

  /** Series members of the anchor game, following `next` up to SERIES_PAGE_LIMIT pages. */
  async function series(anchor: number, signal?: AbortSignal): Promise<GameSummary[]> {
    const out: GameSummary[] = [];
    for (let page = 1; page <= SERIES_PAGE_LIMIT; page++) {
      const raw = await get<RawgPage<RawgListGame>>(
        `/games/${anchor}/game-series`,
        { page, page_size: 40 },
        signal,
      );
      const normalized = normalizeGamePage(raw);
      out.push(...normalized.items);
      if (!normalized.hasMore) break;
    }
    return out;
  }

  return {
    id: "rawg",
    scope,

    async list(filter, page, pageSize, signal) {
      return normalizeGamePage(
        await get<RawgPage<RawgListGame>>("/games", listParams(filter, page, pageSize), signal),
      );
    },

    detail,

    async screenshots(id, signal) {
      const rawgId = rawgIdOf(id);
      if (rawgId === null) return [];
      return normalizeScreenshots(
        await get<RawgPage<RawgScreenshot>>(
          `/games/${rawgId}/screenshots`,
          { page_size: 40 },
          signal,
        ),
      );
    },

    async related(id: GameId, kind: RelatedKind, signal?: AbortSignal) {
      const rawgId = rawgIdOf(id);
      if (rawgId === null) return [];
      return normalizeGamePage(
        await get<RawgPage<RawgListGame>>(`/games/${rawgId}/${kind}`, { page_size: 20 }, signal),
      ).items;
    },

    async franchise(
      def: FranchiseDef,
      lookup: DetailLookup,
      signal?: AbortSignal,
    ): Promise<FranchiseData> {
      const anchorSlug = def.seriesAnchor ?? def.artwork;
      const anchor = await lookup(anchorSlug);
      const games: GameSummary[] = anchor ? [anchor] : [];
      const aliases = new Map<GameId, string>();
      if (anchor && anchor.slug !== anchorSlug) aliases.set(anchor.id, anchorSlug);
      let seriesAvailable = true;
      const anchorRawgId = anchor ? rawgIdOf(anchor.id) : null;
      if (anchorRawgId !== null) {
        try {
          games.push(...(await series(anchorRawgId, signal)));
        } catch (error) {
          // A plan without series access degrades to the curated list only.
          if (isRawgError(error) && error.kind === "capability_unavailable")
            seriesAvailable = false;
          else throw error;
        }
      }
      // Curated games RAWG's series data doesn't list; capped to protect the request budget.
      const missing = missingCuratedSlugs(def, [
        ...games.map((g) => g.slug),
        ...aliases.values(),
      ]).slice(0, MAX_CURATED_LOOKUPS);
      const extra = await Promise.all(missing.map((slug) => lookup(slug).catch(() => null)));
      extra.forEach((game, i) => {
        if (!game) return;
        games.push(game);
        if (game.slug !== missing[i]) aliases.set(game.id, missing[i]);
      });
      return { def, games, aliases, seriesAvailable };
    },
  };
}
