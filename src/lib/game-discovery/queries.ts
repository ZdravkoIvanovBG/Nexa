import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { rawg, isRawgError, type RawgAuth } from "@/lib/providers/rawg";
import {
  normalizeGameDetail,
  normalizeGamePage,
  normalizeScreenshots,
} from "@/lib/providers/rawg/normalize";
import type {
  RawgGameDetail,
  RawgListGame,
  RawgPage,
  RawgScreenshot,
} from "@/lib/providers/rawg/types";
import { readFranchiseArt, writeFranchiseArt } from "./franchise-art-cache";
import {
  missingCuratedSlugs,
  resolveFranchise,
  type FranchiseSort,
  type ResolvedFranchise,
} from "./franchise-resolve";
import type { FranchiseDef } from "./franchises";
import { listParams } from "./sections";
import type { GameDetail, GameListFilter, GamePage, GameSummary } from "./types";
import type { RawgGateState } from "./use-rawg";

// Every RAWG query key starts with ROOT + the key's fingerprint, so a key
// change starts a fresh cache without the key itself ever being in a key.
// gcTime >= staleTime everywhere: cached data is reused until it goes stale.
const ROOT = ["harbor", "rawg"] as const;
const LIST = { staleTime: 30 * 60_000, gcTime: 60 * 60_000 };
const DETAIL = { staleTime: 6 * 60 * 60_000, gcTime: 6 * 60 * 60_000 };
// The client already retries transport and 5xx failures.
const NO_RETRY = { retry: false as const, refetchOnReconnect: false };

const SERIES_PAGE_LIMIT = 3;
const MAX_CURATED_LOOKUPS = 6;

type Gate = Pick<RawgGateState, "ready" | "fingerprint" | "auth">;

export const gameKeys = {
  all: (fp: string) => [...ROOT, fp] as const,
  list: (fp: string, filter: GameListFilter, pageSize: number) =>
    [...ROOT, fp, "list", filter, pageSize] as const,
  browse: (fp: string, filter: GameListFilter) => [...ROOT, fp, "browse", filter] as const,
  detail: (fp: string, idOrSlug: number | string) =>
    [...ROOT, fp, "detail", String(idOrSlug)] as const,
  screenshots: (fp: string, id: number) => [...ROOT, fp, "screenshots", id] as const,
  related: (fp: string, id: number, kind: RelatedKind) =>
    [...ROOT, fp, "related", kind, id] as const,
  developer: (fp: string, developerId: number) => [...ROOT, fp, "developer", developerId] as const,
  franchise: (fp: string, franchiseId: string) => [...ROOT, fp, "franchise", franchiseId] as const,
};

export type RelatedKind = "game-series" | "additions" | "parent-games";

async function fetchList(
  auth: RawgAuth,
  filter: GameListFilter,
  page: number,
  pageSize: number,
  signal?: AbortSignal,
): Promise<GamePage> {
  const raw = await rawg.get<RawgPage<RawgListGame>>(
    "/games",
    listParams(filter, page, pageSize),
    auth,
    signal,
  );
  return normalizeGamePage(raw);
}

/** Detail by id or slug; null when RAWG has no such game (cached, so a bad slug costs one request). */
async function fetchDetail(
  qc: QueryClient,
  gate: Gate,
  idOrSlug: number | string,
  signal?: AbortSignal,
): Promise<GameDetail | null> {
  try {
    const raw = await rawg.get<RawgGameDetail>(`/games/${idOrSlug}`, {}, gate.auth, signal);
    const detail = normalizeGameDetail(raw);
    if (detail) {
      // Seed the other key form so id and slug lookups share one request.
      const other = typeof idOrSlug === "number" ? detail.slug : detail.rawgId;
      qc.setQueryData(gameKeys.detail(gate.fingerprint, other), detail);
    }
    return detail;
  } catch (error) {
    if (isRawgError(error) && error.kind === "not_found") return null;
    throw error;
  }
}

function detailQueryOptions(qc: QueryClient, gate: Gate, idOrSlug: number | string) {
  return {
    queryKey: gameKeys.detail(gate.fingerprint, idOrSlug),
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchDetail(qc, gate, idOrSlug, signal),
    ...DETAIL,
    ...NO_RETRY,
  };
}

export function useGameList(
  gate: Gate,
  filter: GameListFilter,
  pageSize: number,
  enabled: boolean,
) {
  return useQuery({
    queryKey: gameKeys.list(gate.fingerprint, filter, pageSize),
    queryFn: ({ signal }) => fetchList(gate.auth, filter, 1, pageSize, signal),
    enabled: enabled && gate.ready,
    ...LIST,
    ...NO_RETRY,
  });
}

export function useGameDetail(gate: Gate, idOrSlug: number | string | null, enabled: boolean) {
  const qc = useQueryClient();
  return useQuery({
    ...detailQueryOptions(qc, gate, idOrSlug ?? ""),
    enabled: enabled && gate.ready && idOrSlug !== null && idOrSlug !== "",
  });
}

export function useGameScreenshots(gate: Gate, id: number, enabled: boolean) {
  return useQuery({
    queryKey: gameKeys.screenshots(gate.fingerprint, id),
    queryFn: async ({ signal }) =>
      normalizeScreenshots(
        await rawg.get<RawgPage<RawgScreenshot>>(
          `/games/${id}/screenshots`,
          { page_size: 40 },
          gate.auth,
          signal,
        ),
      ),
    enabled: enabled && gate.ready,
    ...DETAIL,
    ...NO_RETRY,
  });
}

export function useGameRelated(gate: Gate, id: number, kind: RelatedKind, enabled: boolean) {
  return useQuery({
    queryKey: gameKeys.related(gate.fingerprint, id, kind),
    queryFn: async ({ signal }) =>
      normalizeGamePage(
        await rawg.get<RawgPage<RawgListGame>>(
          `/games/${id}/${kind}`,
          { page_size: 20 },
          gate.auth,
          signal,
        ),
      ).items,
    enabled: enabled && gate.ready,
    ...DETAIL,
    ...NO_RETRY,
  });
}

export function useDeveloperGames(gate: Gate, developerId: number | null, enabled: boolean) {
  return useQuery({
    queryKey: gameKeys.developer(gate.fingerprint, developerId ?? 0),
    queryFn: ({ signal }) =>
      fetchList(
        gate.auth,
        { developers: String(developerId), ordering: "-added" },
        1,
        20,
        signal,
      ).then((page) => page.items),
    enabled: enabled && gate.ready && developerId !== null,
    ...DETAIL,
    ...NO_RETRY,
  });
}

const BROWSE_PAGE_SIZE = 40;

export function useGameBrowse(gate: Gate, filter: GameListFilter, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: gameKeys.browse(gate.fingerprint, filter),
    queryFn: ({ pageParam, signal }) =>
      fetchList(gate.auth, filter, pageParam, BROWSE_PAGE_SIZE, signal),
    initialPageParam: 1,
    getNextPageParam: (last, pages) =>
      last.hasMore && last.items.length > 0 ? pages.length + 1 : undefined,
    enabled: enabled && gate.ready,
    ...LIST,
    ...NO_RETRY,
  });
}

/** Series members of the anchor game, following `next` up to SERIES_PAGE_LIMIT pages. */
async function fetchSeries(
  gate: Gate,
  anchor: number,
  signal?: AbortSignal,
): Promise<GameSummary[]> {
  const out: GameSummary[] = [];
  for (let page = 1; page <= SERIES_PAGE_LIMIT; page++) {
    const raw = await rawg.get<RawgPage<RawgListGame>>(
      `/games/${anchor}/game-series`,
      { page, page_size: 40 },
      gate.auth,
      signal,
    );
    const normalized = normalizeGamePage(raw);
    out.push(...normalized.items);
    if (!normalized.hasMore) break;
  }
  return out;
}

export type FranchiseData = { def: FranchiseDef; games: GameSummary[]; seriesAvailable: boolean };

export function useFranchiseGames(gate: Gate, def: FranchiseDef | null, enabled: boolean) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: gameKeys.franchise(gate.fingerprint, def?.id ?? ""),
    queryFn: async ({ signal }): Promise<FranchiseData> => {
      if (!def) throw new Error("unknown franchise");
      const anchorSlug = def.seriesAnchor ?? def.artwork;
      const anchor = await qc.fetchQuery(detailQueryOptions(qc, gate, anchorSlug));
      const games: GameSummary[] = anchor ? [anchor] : [];
      let seriesAvailable = true;
      if (anchor) {
        try {
          games.push(...(await fetchSeries(gate, anchor.rawgId, signal)));
        } catch (error) {
          // A plan without series access degrades to the curated list only.
          if (isRawgError(error) && error.kind === "capability_unavailable")
            seriesAvailable = false;
          else throw error;
        }
      }
      // Curated games RAWG's series data doesn't list; capped to protect the request budget.
      const missing = missingCuratedSlugs(
        def,
        games.map((g) => g.slug),
      ).slice(0, MAX_CURATED_LOOKUPS);
      const extra = await Promise.all(
        missing.map((slug) => qc.fetchQuery(detailQueryOptions(qc, gate, slug)).catch(() => null)),
      );
      for (const game of extra) if (game) games.push(game);
      return { def, games, seriesAvailable };
    },
    enabled: enabled && gate.ready && def !== null,
    ...DETAIL,
    ...NO_RETRY,
  });
}

export function resolveFranchiseData(data: FranchiseData, sort: FranchiseSort): ResolvedFranchise {
  return resolveFranchise(data.def, data.games, sort);
}

/**
 * Card art for a franchise: in-memory detail cache first, then the 7-day
 * device cache, and only then one detail request.
 */
export function useFranchiseArt(gate: Gate, def: FranchiseDef, enabled: boolean) {
  const qc = useQueryClient();
  const cached = useMemo(() => readFranchiseArt(def.id), [def.id]);
  const known = useMemo(
    () =>
      qc.getQueryData<GameDetail | null>(gameKeys.detail(gate.fingerprint, def.artwork)) ??
      findInLoadedLists(qc, gate.fingerprint, def.artwork),
    [qc, gate.fingerprint, def.artwork],
  );
  const query = useQuery({
    ...detailQueryOptions(qc, gate, def.artwork),
    enabled: enabled && gate.ready && !cached && !known,
  });
  const game: GameSummary | null = known ?? query.data ?? null;
  useEffect(() => {
    if (game && !cached) {
      writeFranchiseArt(def.id, { rawgId: game.rawgId, slug: game.slug, image: game.image });
    }
  }, [game, cached, def.id]);
  if (game) return { image: game.image, loading: false };
  if (cached) return { image: cached.image, loading: false };
  return { image: null, loading: query.isLoading };
}

/** A game already present in a loaded row or browse page, so no request is needed. */
function findInLoadedLists(qc: QueryClient, fp: string, slug: string): GameSummary | null {
  for (const [, data] of qc.getQueriesData<GamePage>({ queryKey: [...ROOT, fp, "list"] })) {
    const hit = data?.items.find((g) => g.slug === slug);
    if (hit) return hit;
  }
  return null;
}
