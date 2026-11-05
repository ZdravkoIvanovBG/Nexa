import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { rawg } from "@/lib/providers/rawg";
import { createRawgProvider } from "@/lib/providers/rawg/provider";
import { readFranchiseArt, writeFranchiseArt } from "./franchise-art-cache";
import { resolveFranchise, type FranchiseSort, type ResolvedFranchise } from "./franchise-resolve";
import type { FranchiseDef } from "./franchises";
import { rawgIdOf, type GameId } from "./game-id";
import {
  ACTIVE_GAME_PROVIDER,
  type FranchiseData,
  type GameMetadataProvider,
  type RelatedKind,
} from "./provider";
import type { GameDetail, GameListFilter, GamePage, GameSummary } from "./types";
import type { RawgGateState } from "./use-rawg";

export type { FranchiseData, RelatedKind } from "./provider";

// Every query key starts with ROOT + the provider + its cache scope (for RAWG,
// the key's fingerprint), so a provider or key change starts a fresh cache and
// no credential is ever part of a key. Ids in keys are provider-qualified.
// gcTime >= staleTime everywhere: cached data is reused until it goes stale.
const ROOT = ["harbor", "games"] as const;
const LIST = { staleTime: 30 * 60_000, gcTime: 60 * 60_000 };
const DETAIL = { staleTime: 6 * 60 * 60_000, gcTime: 6 * 60 * 60_000 };
// The client already retries transport and 5xx failures.
const NO_RETRY = { retry: false as const, refetchOnReconnect: false };

type Gate = Pick<RawgGateState, "ready" | "fingerprint" | "auth">;
type Scope = Pick<GameMetadataProvider, "id" | "scope">;

export const gameKeys = {
  all: (p: Scope) => [...ROOT, p.id, p.scope] as const,
  list: (p: Scope, filter: GameListFilter, pageSize: number) =>
    [...ROOT, p.id, p.scope, "list", filter, pageSize] as const,
  browse: (p: Scope, filter: GameListFilter) => [...ROOT, p.id, p.scope, "browse", filter] as const,
  detail: (p: Scope, idOrSlug: GameId | string) =>
    [...ROOT, p.id, p.scope, "detail", String(idOrSlug)] as const,
  screenshots: (p: Scope, id: GameId) => [...ROOT, p.id, p.scope, "screenshots", id] as const,
  related: (p: Scope, id: GameId, kind: RelatedKind) =>
    [...ROOT, p.id, p.scope, "related", kind, id] as const,
  developer: (p: Scope, developerId: number) =>
    [...ROOT, p.id, p.scope, "developer", developerId] as const,
  franchise: (p: Scope, franchiseId: string) =>
    [...ROOT, p.id, p.scope, "franchise", franchiseId] as const,
};

/**
 * The active metadata provider for this gate. Exactly one provider is active
 * (RAWG in Stage 2); memoised on the credential state, so it is created once
 * per key change, never per render.
 */
export function useGameProvider(gate: Gate): GameMetadataProvider {
  const { key, verifiedFor } = gate.auth;
  const scope = gate.fingerprint;
  return useMemo(() => {
    switch (ACTIVE_GAME_PROVIDER) {
      case "rawg":
        return createRawgProvider(rawg, { key, verifiedFor }, scope);
      default:
        throw new Error("No metadata provider is available");
    }
  }, [key, verifiedFor, scope]);
}

/** Detail by id or slug; null when the provider has no such game (cached, so a bad slug costs one request). */
async function fetchDetail(
  qc: QueryClient,
  provider: GameMetadataProvider,
  idOrSlug: GameId | string,
  signal?: AbortSignal,
): Promise<GameDetail | null> {
  const detail = await provider.detail(idOrSlug, signal);
  if (detail) {
    // Seed the id and canonical-slug keys so every lookup form shares one request.
    for (const key of [detail.id, detail.slug]) {
      if (key !== String(idOrSlug)) qc.setQueryData(gameKeys.detail(provider, key), detail);
    }
  }
  return detail;
}

function detailQueryOptions(
  qc: QueryClient,
  provider: GameMetadataProvider,
  idOrSlug: GameId | string,
) {
  return {
    queryKey: gameKeys.detail(provider, idOrSlug),
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchDetail(qc, provider, idOrSlug, signal),
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
  const provider = useGameProvider(gate);
  return useQuery({
    queryKey: gameKeys.list(provider, filter, pageSize),
    queryFn: ({ signal }) => provider.list(filter, 1, pageSize, signal),
    enabled: enabled && gate.ready,
    ...LIST,
    ...NO_RETRY,
  });
}

export function useGameDetail(gate: Gate, idOrSlug: GameId | string | null, enabled: boolean) {
  const qc = useQueryClient();
  const provider = useGameProvider(gate);
  return useQuery({
    ...detailQueryOptions(qc, provider, idOrSlug ?? ""),
    enabled: enabled && gate.ready && idOrSlug !== null && idOrSlug !== "",
  });
}

export function useGameScreenshots(gate: Gate, id: GameId, enabled: boolean) {
  const provider = useGameProvider(gate);
  return useQuery({
    queryKey: gameKeys.screenshots(provider, id),
    queryFn: ({ signal }) => provider.screenshots(id, signal),
    enabled: enabled && gate.ready,
    ...DETAIL,
    ...NO_RETRY,
  });
}

export function useGameRelated(gate: Gate, id: GameId, kind: RelatedKind, enabled: boolean) {
  const provider = useGameProvider(gate);
  return useQuery({
    queryKey: gameKeys.related(provider, id, kind),
    queryFn: ({ signal }) => provider.related(id, kind, signal),
    enabled: enabled && gate.ready,
    ...DETAIL,
    ...NO_RETRY,
  });
}

/** Games by a developer, by the active provider's developer id. */
export function useDeveloperGames(gate: Gate, developerId: number | null, enabled: boolean) {
  const provider = useGameProvider(gate);
  return useQuery({
    queryKey: gameKeys.developer(provider, developerId ?? 0),
    queryFn: ({ signal }) =>
      provider
        .list({ developers: String(developerId), ordering: "-added" }, 1, 20, signal)
        .then((page) => page.items),
    enabled: enabled && gate.ready && developerId !== null,
    ...DETAIL,
    ...NO_RETRY,
  });
}

const BROWSE_PAGE_SIZE = 40;

export function useGameBrowse(gate: Gate, filter: GameListFilter, enabled: boolean) {
  const provider = useGameProvider(gate);
  return useInfiniteQuery({
    queryKey: gameKeys.browse(provider, filter),
    queryFn: ({ pageParam, signal }) => provider.list(filter, pageParam, BROWSE_PAGE_SIZE, signal),
    initialPageParam: 1,
    getNextPageParam: (last, pages) =>
      last.hasMore && last.items.length > 0 ? pages.length + 1 : undefined,
    enabled: enabled && gate.ready,
    ...LIST,
    ...NO_RETRY,
  });
}

export function useFranchiseGames(gate: Gate, def: FranchiseDef | null, enabled: boolean) {
  const qc = useQueryClient();
  const provider = useGameProvider(gate);
  return useQuery({
    queryKey: gameKeys.franchise(provider, def?.id ?? ""),
    queryFn: async ({ signal }): Promise<FranchiseData> => {
      if (!def) throw new Error("unknown franchise");
      return provider.franchise(
        def,
        (idOrSlug) => qc.fetchQuery(detailQueryOptions(qc, provider, idOrSlug)),
        signal,
      );
    },
    enabled: enabled && gate.ready && def !== null,
    ...DETAIL,
    ...NO_RETRY,
  });
}

export function resolveFranchiseData(data: FranchiseData, sort: FranchiseSort): ResolvedFranchise {
  return resolveFranchise(data.def, data.games, sort, data.aliases);
}

/**
 * Card art for a franchise: in-memory detail cache first, then the 7-day
 * device cache, and only then one detail request.
 */
export function useFranchiseArt(gate: Gate, def: FranchiseDef | null, enabled: boolean) {
  const qc = useQueryClient();
  const provider = useGameProvider(gate);
  const id = def?.id ?? "";
  const artwork = def?.artwork ?? "";
  const cached = useMemo(() => (id ? readFranchiseArt(id) : null), [id]);
  const known = useMemo(
    () =>
      artwork
        ? (qc.getQueryData<GameDetail | null>(gameKeys.detail(provider, artwork)) ??
          findInLoadedLists(qc, provider, artwork))
        : null,
    [qc, provider, artwork],
  );
  const query = useQuery({
    ...detailQueryOptions(qc, provider, artwork),
    enabled: enabled && gate.ready && !!artwork && !cached && !known,
  });
  const game: GameSummary | null = known ?? query.data ?? null;
  useEffect(() => {
    // The device cache holds RAWG art only (its entries carry a RAWG id).
    const rawgId = game ? rawgIdOf(game.id) : null;
    if (game && rawgId !== null && !cached && id) {
      writeFranchiseArt(id, { rawgId, slug: game.slug, image: game.image });
    }
  }, [game, cached, id]);
  if (game) return { image: game.image, loading: false };
  if (cached) return { image: cached.image, loading: false };
  return { image: null, loading: query.isLoading };
}

/** A game already present in a loaded row or browse page, so no request is needed. */
function findInLoadedLists(qc: QueryClient, provider: Scope, slug: string): GameSummary | null {
  for (const [, data] of qc.getQueriesData<GamePage>({
    queryKey: [...ROOT, provider.id, provider.scope, "list"],
  })) {
    const hit = data?.items.find((g) => g.slug === slug);
    if (hit) return hit;
  }
  return null;
}
