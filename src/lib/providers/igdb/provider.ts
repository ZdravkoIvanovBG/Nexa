// IGDB behind the GameMetadataProvider seam (Stage 4).
//
// - Takes the client as a parameter (no app imports), so it runs under
//   `node --test`. In the app the client sends every request through the Rust
//   transport, which holds the credentials and the global rate limiter.
// - Only "igdb:N" ids are looked up. RAWG ids and catalog slugs (RAWG's) get
//   "not found" with no request, so no RAWG identifier ever reaches IGDB.
// - Every public list excludes the Erotic theme in the query and again when
//   normalizing; a detail page refuses an Erotic-themed game outright.
// - Curated franchises (Stage 5) come from the reviewed id mapping
//   (game-discovery/franchises-igdb.ts): one request per franchise page, one
//   for all franchise banners, never a title search.

import { FRANCHISES, type FranchiseDef } from "../../game-discovery/franchises.ts";
import { igdbFranchiseArtwork, igdbFranchiseIds } from "../../game-discovery/franchises-igdb.ts";
import { parseGameId, type GameId } from "../../game-discovery/game-id.ts";
import type {
  DetailLookup,
  FranchiseData,
  GameMetadataProvider,
  ListOptions,
  RelatedKind,
} from "../../game-discovery/provider.ts";
import type {
  GameDetail,
  GameListFilter,
  GamePage,
  GameSummary,
} from "../../game-discovery/types.ts";
import { IgdbError, type IgdbClient } from "./client.ts";
import { planList, promoteExactTitles, type IgdbListPlan } from "./listing.ts";
import { isErotic, normalizeIgdbDetail, normalizeIgdbGames } from "./normalize.ts";
import { blendPopularity, orderByRanking } from "./popularity.ts";
import {
  DETAIL_FIELDS,
  MAX_IDS,
  SUMMARY_FIELDS,
  THEME_EROTIC,
  popularSubqueries,
  publicFilters,
  where,
  type IgdbCondition,
  type IgdbQuery,
} from "./query.ts";
import { toGameDetail, toGameSummary } from "./summary.ts";
import type { RawIgdbGame } from "./types.ts";

/** Entries read from each popularity list (IGDB's per-query maximum). */
export const POPULARITY_POOL = 500;
/** How long a popularity ranking is reused (the list cache's freshness). */
export const RANKING_TTL_MS = 30 * 60_000;
/** Related games shown per row. */
export const RELATED_LIMIT = 30;

type Client = Pick<IgdbClient, "query" | "multiquery">;

export type IgdbProviderOptions = {
  /** Milliseconds, like Date.now. */
  now?: () => number;
};

function igdbNumber(id: GameId | string): number | null {
  const parsed = parseGameId(id);
  return parsed?.provider === "igdb" ? parsed.providerId : null;
}

function rawList(data: unknown): unknown[] {
  if (!Array.isArray(data)) throw new IgdbError("bad_response");
  return data;
}

function countOf(data: unknown): number | null {
  const count = (data as { count?: unknown } | null)?.count;
  return typeof count === "number" && Number.isSafeInteger(count) && count >= 0 ? count : null;
}

const summaries = (data: unknown): GameSummary[] =>
  normalizeIgdbGames(rawList(data)).map(toGameSummary);

export function createIgdbProvider(
  client: Client,
  scope: string,
  options: IgdbProviderOptions = {},
): GameMetadataProvider {
  const now = options.now ?? (() => Date.now());
  const nowSec = () => Math.floor(now() / 1000);

  // The blended popularity ranking, shared by the Popular row, the hero and
  // Popular's Browse pages. One multiquery per RANKING_TTL_MS. It's shared, so
  // one caller giving up doesn't cancel it for the others.
  let ranking: { at: number; ids: Promise<number[]> } | null = null;
  const popularRanking = (): Promise<number[]> => {
    if (ranking && now() - ranking.at < RANKING_TTL_MS) return ranking.ids;
    const ids = client
      .multiquery(popularSubqueries(POPULARITY_POOL))
      .then((lists) => blendPopularity([lists.playing, lists.want_to_play]));
    const entry = { at: now(), ids };
    ranking = entry;
    // A failed or cancelled read is never reused.
    ids.catch(() => {
      if (ranking === entry) ranking = null;
    });
    return ids;
  };

  async function queryPage(
    plan: Extract<IgdbListPlan, { kind: "query" }>,
    page: number,
    pageSize: number,
    signal: AbortSignal | undefined,
    withCount: boolean,
  ): Promise<GamePage> {
    const offset = (page - 1) * pageSize;
    const spec: IgdbQuery = {
      fields: SUMMARY_FIELDS,
      where: plan.where,
      limit: pageSize,
      offset,
      ...(plan.search ? { search: plan.search } : {}),
      ...(plan.sort ? { sort: plan.sort } : {}),
    };
    const counting =
      withCount && page === 1
        ? client.query(
            "games/count",
            { fields: [], where: plan.where, ...(plan.search ? { search: plan.search } : {}) },
            signal,
          )
        : null;
    const [data, total] = await Promise.all([
      client.query("games", spec, signal),
      counting?.then(countOf, () => null) ?? null,
    ]);
    const raw = rawList(data);
    const ordered = plan.search && page === 1 ? promoteExactTitles(raw, plan.search) : raw;
    return { items: summaries(ordered), count: total, hasMore: raw.length === pageSize };
  }

  async function popularPage(
    plan: Extract<IgdbListPlan, { kind: "popular" }>,
    page: number,
    pageSize: number,
    signal: AbortSignal | undefined,
    withCount: boolean,
  ): Promise<GamePage> {
    const ranked = await popularRanking();
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (plan.sort || plan.narrowed) {
      // Another ordering, or a genre/platform/name filter: query the ranked
      // pool, so every page is full. Filtered "Popular" orders the pool by how
      // many people rated each game.
      const pool = ranked.slice(0, MAX_IDS);
      if (pool.length === 0) return { items: [], count: 0, hasMore: false };
      return queryPage(
        {
          kind: "query",
          where: [where.anyOf("id", pool), ...plan.where],
          sort: plan.sort ?? { field: "total_rating_count", dir: "desc" },
          search: null,
        },
        page,
        pageSize,
        signal,
        withCount,
      );
    }
    const start = (page - 1) * pageSize;
    const chunk = ranked.slice(start, start + pageSize);
    if (chunk.length === 0) return { items: [], count: null, hasMore: false };
    const data = await client.query(
      "games",
      {
        fields: SUMMARY_FIELDS,
        where: [where.anyOf("id", chunk), ...plan.where],
        limit: chunk.length,
      },
      signal,
    );
    const games = normalizeIgdbGames(rawList(data));
    return {
      items: orderByRanking(games, chunk).map(toGameSummary),
      // Ranked entries the filters drop (DLC, unreleased, editions) aren't
      // known until fetched, so there's no honest total.
      count: null,
      hasMore: start + pageSize < ranked.length,
    };
  }

  async function detail(
    idOrSlug: GameId | string,
    signal?: AbortSignal,
  ): Promise<GameDetail | null> {
    const id = igdbNumber(idOrSlug);
    if (id === null) return null;
    const data = await client.query(
      "games",
      { fields: DETAIL_FIELDS, where: [where.eq("id", id)], limit: 1 },
      signal,
    );
    const raw = rawList(data)[0] as RawIgdbGame | undefined;
    if (!raw || isErotic(raw)) return null;
    const normalized = normalizeIgdbDetail(raw);
    return normalized ? toGameDetail(normalized, raw) : null;
  }

  const lookupOrFetch = (id: GameId, lookup: DetailLookup | undefined, signal?: AbortSignal) =>
    lookup ? lookup(id) : detail(id, signal);

  /** Conditions for a related row: DLC rows keep DLC; the others are public lists. */
  function relatedConditions(kind: RelatedKind): IgdbCondition[] {
    if (kind === "additions" || kind === "parent-games") {
      return [where.noneOf("themes", [THEME_EROTIC])];
    }
    return publicFilters();
  }

  async function related(
    id: GameId,
    kind: RelatedKind,
    signal?: AbortSignal,
    lookup?: DetailLookup,
  ): Promise<GameSummary[]> {
    if (igdbNumber(id) === null) return [];
    const key =
      kind === "additions"
        ? "additions"
        : kind === "parent-games"
          ? "parents"
          : kind === "versions"
            ? "versions"
            : kind === "similar"
              ? "similar"
              : null;
    // "game-series" is curated franchise data (Stage 5).
    if (!key) return [];
    const base = await lookupOrFetch(id, lookup, signal);
    const wanted = (base?.relations?.[key] ?? [])
      .map(igdbNumber)
      .filter((n): n is number => n !== null && n !== igdbNumber(id))
      .slice(0, RELATED_LIMIT);
    if (wanted.length === 0) return [];
    const data = await client.query(
      "games",
      {
        fields: SUMMARY_FIELDS,
        where: [where.anyOf("id", wanted), ...relatedConditions(kind)],
        limit: wanted.length,
      },
      signal,
    );
    const games = normalizeIgdbGames(rawList(data));
    if (kind === "similar") return orderByRanking(games, wanted).map(toGameSummary);
    // Editions, remasters and DLC read best in release order.
    return games
      .map(toGameSummary)
      .sort(
        (a, b) =>
          (a.released ?? "9999").localeCompare(b.released ?? "9999") ||
          a.name.localeCompare(b.name),
      );
  }

  return {
    id: "igdb",
    scope,

    async list(
      filter: GameListFilter,
      page: number,
      pageSize: number,
      signal?: AbortSignal,
      options: ListOptions = {},
    ): Promise<GamePage> {
      const plan = planList(filter, nowSec());
      const withCount = options.withCount === true;
      switch (plan.kind) {
        case "none":
          return { items: [], count: 0, hasMore: false };
        case "popular":
          return popularPage(plan, page, pageSize, signal, withCount);
        case "query":
          return queryPage(plan, page, pageSize, signal, withCount);
      }
    },

    detail,

    async screenshots(id, signal, lookup) {
      if (igdbNumber(id) === null) return [];
      const base = await lookupOrFetch(id, lookup, signal);
      return base?.screenshots ?? [];
    },

    related,

    async franchise(def: FranchiseDef, _lookup, signal): Promise<FranchiseData> {
      // Reviewed ids only: no catalog slug (a RAWG slug) is ever sent to IGDB.
      const slugs = igdbFranchiseIds(def.id);
      const empty = {
        def,
        games: [],
        aliases: new Map(),
        seriesAvailable: false,
        curatedOnly: true,
      };
      if (slugs.size === 0) return empty;
      const ids = [...slugs.keys()];
      const data = await client.query(
        "games",
        {
          fields: SUMMARY_FIELDS,
          // The catalog curates editions, bundles and remasters on purpose, so
          // only the content filter applies here.
          where: [where.anyOf("id", ids), where.noneOf("themes", [THEME_EROTIC])],
          limit: ids.length,
        },
        signal,
      );
      const games = normalizeIgdbGames(rawList(data)).map(toGameSummary);
      const aliases = new Map<GameId, string>();
      for (const game of games) {
        const slug = slugs.get(igdbNumber(game.id) ?? 0);
        if (slug) aliases.set(game.id, slug);
      }
      return { ...empty, games, aliases };
    },

    async franchiseArt(signal) {
      // The 11 banner games in one request; hero art (large, logo-free
      // landscape) first, then the card's landscape art.
      const byGame = new Map<number, string>();
      for (const def of FRANCHISES) {
        const id = igdbFranchiseArtwork(def.id);
        if (id !== null) byGame.set(id, def.id);
      }
      const out: Record<string, string | null> = {};
      for (const def of FRANCHISES) out[def.id] = null;
      if (byGame.size === 0) return out;
      const data = await client.query(
        "games",
        {
          fields: SUMMARY_FIELDS,
          where: [where.anyOf("id", [...byGame.keys()]), where.noneOf("themes", [THEME_EROTIC])],
          limit: byGame.size,
        },
        signal,
      );
      for (const game of normalizeIgdbGames(rawList(data)).map(toGameSummary)) {
        const franchiseId = byGame.get(igdbNumber(game.id) ?? 0);
        if (!franchiseId) continue;
        out[franchiseId] =
          game.heroImage ?? (game.imageKind === "portrait" ? null : game.image) ?? null;
      }
      return out;
    },
  };
}
