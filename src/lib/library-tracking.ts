import { useEffect, useState, useSyncExternalStore } from "react";
import { setItemWithRecovery, freeStorageSpace } from "@/lib/storage-recovery";
import { applyRemote, mirrorTracking } from "@/lib/cloud/mirror";
import { ALL_TIERS, normalizeTier, type Tier } from "@/lib/tracking-tiers";
import {
  bucketByTier,
  countsByKind,
  mergeWatchedMovies,
  nextOrderFor,
  placeInTier,
  type MediaKind,
} from "@/lib/tier-order";
import {
  isMovieWatchedLocal,
  listMovieWatchedLocal,
  movieWatchedVersion,
  setMovieWatchedLocal,
  subscribeMovieWatched,
} from "@/lib/movie-watched";
import { readPlayback } from "@/lib/playback-history";
import { tmdbFromImdbCached, tmdbImdbCached } from "@/lib/providers/tmdb/tmdb-imdb-resolve";
import { setWatchedFlag } from "@/lib/watched-flag";
import { sortWatchingEntries } from "@/lib/watching-order";

const KEY = "harbor.librarytracking.v1";
const subs = new Set<() => void>();

export { ALL_TIERS, TIERS, type RankedTier, type Tier } from "@/lib/tracking-tiers";
export { type MediaKind } from "@/lib/tier-order";

export type TrackedInput = {
  id: string;
  type?: string;
  name?: string;
  poster?: string;
};

export type WatchingSeed = {
  season?: number;
  episode?: number;
  totalSeasons?: number;
  status?: string;
  yearLabel?: string;
};

export type WatchingEntry = {
  id: string;
  type: MediaKind;
  name: string;
  poster?: string;
  season: number;
  episode: number;
  totalSeasons?: number;
  status?: string;
  yearLabel?: string;
  addedAt: number;
  updatedAt: number;
};

export type WatchedEntry = {
  id: string;
  type: MediaKind;
  name: string;
  poster?: string;
  tier: Tier;
  order: number;
  finishedAt: number;
};

type Store = { watching: WatchingEntry[]; watched: WatchedEntry[] };

export const MAX_WATCHING = 200;
export const MAX_WATCHED = 1000;

let memoryFallback: Store | null = null;
let boardVersion = 0;
const boardCache = new Map<
  MediaKind,
  { version: number; movieVersion: number; view: TierBoardView }
>();

function inferType(id: string): MediaKind {
  return id.includes(":tv:") || id.includes(":series:") ? "series" : "movie";
}

function normalizeType(type: string | undefined, id: string): MediaKind {
  if (type === "series" || type === "tv" || type === "anime") return "series";
  if (type === "movie") return "movie";
  return inferType(id);
}

function clampStep(n: unknown, fallback: number): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.round(n) : fallback;
  return v < 1 ? 1 : v;
}

function cloneStore(s: Store): Store {
  return { watching: s.watching.map((e) => ({ ...e })), watched: s.watched.map((e) => ({ ...e })) };
}

function read(): Store {
  if (memoryFallback) return cloneStore(memoryFallback);
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { watching: [], watched: [] };
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return { watching: [], watched: [] };
    const p = parsed as Record<string, unknown>;
    const watching: WatchingEntry[] = [];
    if (Array.isArray(p.watching)) {
      for (const el of p.watching) {
        if (!el || typeof el !== "object") continue;
        const e = el as Record<string, unknown>;
        if (typeof e.id !== "string") continue;
        watching.push({
          id: e.id,
          type: e.type === "series" ? "series" : "movie",
          name: typeof e.name === "string" ? e.name : "",
          poster: typeof e.poster === "string" ? e.poster : undefined,
          season: clampStep(e.season, 1),
          episode: clampStep(e.episode, 1),
          totalSeasons:
            typeof e.totalSeasons === "number" && e.totalSeasons > 0 ? e.totalSeasons : undefined,
          status: typeof e.status === "string" ? e.status : undefined,
          yearLabel: typeof e.yearLabel === "string" ? e.yearLabel : undefined,
          addedAt: typeof e.addedAt === "number" ? e.addedAt : 0,
          updatedAt: typeof e.updatedAt === "number" ? e.updatedAt : 0,
        });
      }
    }
    const watched: WatchedEntry[] = [];
    if (Array.isArray(p.watched)) {
      for (const el of p.watched) {
        if (!el || typeof el !== "object") continue;
        const e = el as Record<string, unknown>;
        if (typeof e.id !== "string") continue;
        watched.push({
          id: e.id,
          // normalizeType, not a bare === "series": a "tv"/"anime" blob that
          // collapsed to "movie" used to be invisible on the single combined
          // board, but now it would be stranded in the wrong list with no way
          // to drag it across.
          type: normalizeType(typeof e.type === "string" ? e.type : undefined, e.id),
          name: typeof e.name === "string" ? e.name : "",
          poster: typeof e.poster === "string" ? e.poster : undefined,
          tier: normalizeTier(e.tier),
          order: typeof e.order === "number" ? e.order : Number.MAX_SAFE_INTEGER,
          finishedAt: typeof e.finishedAt === "number" ? e.finishedAt : 0,
        });
      }
    }
    return { watching, watched };
  } catch {
    return { watching: [], watched: [] };
  }
}

function write(store: Store): void {
  const payload = JSON.stringify(store);
  const ok = setItemWithRecovery(KEY, payload);
  if (!ok) {
    freeStorageSpace();
    const retry = setItemWithRecovery(KEY, payload);
    if (!retry) {
      memoryFallback = store;
      console.warn("[library-tracking] localStorage exhausted, holding tracking in memory only");
    } else {
      memoryFallback = null;
    }
  } else {
    memoryFallback = null;
  }
  boardVersion += 1;
  for (const s of subs) s();
  mirrorTracking(store);
}

/**
 * Overwrite both tracked lists from a cloud pull. Wrapped in applyRemote so
 * the mirror treats it as inbound and does not push it back.
 */
export function replaceTracking(next: {
  watching: WatchingEntry[];
  watched: WatchedEntry[];
}): void {
  applyRemote(() =>
    write({
      watching: next.watching.slice(0, MAX_WATCHING),
      watched: next.watched.slice(0, MAX_WATCHED),
    }),
  );
}

/** Current snapshot of both lists, for merge and snapshot priming. */
export function readTracking(): { watching: WatchingEntry[]; watched: WatchedEntry[] } {
  return read();
}

export function subscribeTracking(fn: () => void): () => void {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

export function readWatching(): WatchingEntry[] {
  return sortWatchingEntries(read().watching);
}

export function readWatched(): WatchedEntry[] {
  return read().watched;
}

export type TierBoardView = {
  board: Record<Tier, WatchedEntry[]>;
  counts: Record<MediaKind, number>;
};

/** The cached tt <-> tmdb:movie counterpart of a movie id, if known. */
function movieAlias(id: string): string | undefined {
  const alias = id.startsWith("tt") ? tmdbFromImdbCached(id) : tmdbImdbCached(id);
  return alias ?? undefined;
}

function unrankedMovie(id: string, order: number): WatchedEntry {
  return {
    id,
    type: "movie",
    name: readPlayback(id)?.title ?? "",
    tier: "unranked",
    order,
    finishedAt: 0,
  };
}

/**
 * Tier rows for one media kind, plus the watched totals for both kinds.
 *
 * Movies marked watched before marking wrote through to this store live only
 * in movie-watched.ts's device-local set. They are merged in here, unranked,
 * rather than copied over: that set is not per profile, so a bulk copy would
 * push one profile's history into whichever profile opened the board first.
 * moveToTier() adopts one into this store once it is actually ranked.
 */
export function readTierBoard(kind: MediaKind): TierBoardView {
  const watched = mergeWatchedMovies(
    read().watched,
    listMovieWatchedLocal(),
    movieAlias,
    unrankedMovie,
  );
  return {
    board: bucketByTier(watched, kind, ALL_TIERS),
    counts: countsByKind(watched),
  };
}

export function addToWatching(input: TrackedInput, seed?: WatchingSeed): void {
  const store = read();
  if (store.watching.some((e) => e.id === input.id)) return;
  if (store.watching.length >= MAX_WATCHING) return;
  const now = Date.now();
  store.watching.push({
    id: input.id,
    type: normalizeType(input.type, input.id),
    name: input.name ?? "",
    poster: input.poster,
    season: clampStep(seed?.season, 1),
    episode: clampStep(seed?.episode, 1),
    totalSeasons:
      typeof seed?.totalSeasons === "number" && seed.totalSeasons > 0
        ? seed.totalSeasons
        : undefined,
    status: seed?.status || undefined,
    yearLabel: seed?.yearLabel || undefined,
    addedAt: now,
    updatedAt: now,
  });
  // Intentionally does NOT clear a matching `watched` entry: a series can be
  // both "watched" (previous seasons, keeping its Tier List spot) and
  // "currently watching" (a new season) at the same time. See markWatched()
  // for the inverse case.
  write(store);
}

export function removeFromWatching(id: string): void {
  const store = read();
  const next = store.watching.filter((e) => e.id !== id);
  if (next.length === store.watching.length) return;
  store.watching = next;
  write(store);
}

export function setProgress(id: string, season: number, episode: number): void {
  const store = read();
  const entry = store.watching.find((e) => e.id === id);
  if (!entry) return;
  let nextSeason = clampStep(season, entry.season);
  if (entry.totalSeasons && nextSeason > entry.totalSeasons) nextSeason = entry.totalSeasons;
  const nextEpisode = clampStep(episode, entry.episode);
  if (entry.season === nextSeason && entry.episode === nextEpisode) return;
  entry.season = nextSeason;
  entry.episode = nextEpisode;
  entry.updatedAt = Date.now();
  write(store);
}

export function markWatched(input: TrackedInput): void {
  const store = read();
  const existing = store.watched.find((e) => e.id === input.id);
  const fromWatching = store.watching.find((e) => e.id === input.id);
  if (existing) {
    if (!existing.name) existing.name = input.name ?? fromWatching?.name ?? "";
    if (!existing.poster) existing.poster = input.poster ?? fromWatching?.poster;
    // A fresher type re-files an entry that landed on the wrong board.
    if (input.type) existing.type = normalizeType(input.type, input.id);
    store.watching = store.watching.filter((e) => e.id !== input.id);
    write(store);
    return;
  }
  if (store.watched.length >= MAX_WATCHED) {
    // At the cap, nothing is added to the Tier List -- leave it in Currently
    // Watching too, rather than silently dropping it from both lists.
    return;
  }
  const kind = normalizeType(input.type ?? fromWatching?.type, input.id);
  store.watched.push({
    id: input.id,
    type: kind,
    name: input.name ?? fromWatching?.name ?? "",
    poster: input.poster ?? fromWatching?.poster,
    tier: "unranked",
    order: nextOrderFor(store.watched, "unranked", kind),
    finishedAt: Date.now(),
  });
  // Finishing a show moves it out of the active queue but preserves its
  // (now freshly-created) Tier List entry -- see addToWatching() for how a
  // later new season can re-add it to Currently Watching without touching
  // this entry.
  store.watching = store.watching.filter((e) => e.id !== input.id);
  write(store);
}

export function removeFromWatched(id: string): void {
  const store = read();
  const entry = store.watched.find((e) => e.id === id);
  // The board also shows movies from the device-local watched set, so a movie
  // must leave both or it would reappear unranked. Shows never touch it.
  if (entry?.type === "movie" || (!entry && isMovieWatchedLocal(id))) {
    for (const key of [id, movieAlias(id)]) {
      if (!key) continue;
      setMovieWatchedLocal(key, false);
      setWatchedFlag(key, false);
    }
  }
  if (!entry) return;
  store.watched = store.watched.filter((e) => e.id !== id);
  write(store);
}

export function moveToTier(id: string, tier: Tier, index: number): void {
  const store = read();
  if (
    !store.watched.some((e) => e.id === id) &&
    isMovieWatchedLocal(id) &&
    store.watched.length < MAX_WATCHED
  ) {
    store.watched.push(unrankedMovie(id, nextOrderFor(store.watched, "unranked", "movie")));
  }
  // Ranking is scoped to the dragged entry's own media kind, so the other
  // board keeps its positions untouched.
  if (!placeInTier(store.watched, id, tier, index)) return;
  write(store);
}

export type TrackingState = { watching: boolean; watched: boolean; tier: Tier | null };

export function trackingStateOf(id: string | undefined): TrackingState {
  if (!id) return { watching: false, watched: false, tier: null };
  const store = read();
  const watched = store.watched.find((e) => e.id === id);
  return {
    watching: store.watching.some((e) => e.id === id),
    watched: !!watched,
    tier: watched?.tier ?? null,
  };
}

export function useWatching(): WatchingEntry[] {
  const [items, setItems] = useState<WatchingEntry[]>(readWatching);
  useEffect(() => {
    const tick = () => setItems(readWatching());
    subs.add(tick);
    return () => {
      subs.delete(tick);
    };
  }, []);
  return items;
}

/**
 * useSyncExternalStore needs a snapshot that keeps its identity between
 * renders, and readTierBoard() builds a fresh object every call. Caching per
 * kind against the store version also means several subscribers share one
 * parse per change instead of each re-reading localStorage.
 */
function tierBoardSnapshot(kind: MediaKind): TierBoardView {
  const cached = boardCache.get(kind);
  const movieVersion = movieWatchedVersion();
  if (cached && cached.version === boardVersion && cached.movieVersion === movieVersion) {
    return cached.view;
  }
  const view = readTierBoard(kind);
  boardCache.set(kind, { version: boardVersion, movieVersion, view });
  return view;
}

function subscribeTierBoard(fn: () => void): () => void {
  const offTracking = subscribeTracking(fn);
  const offMovie = subscribeMovieWatched(fn);
  return () => {
    offTracking();
    offMovie();
  };
}

export function useTierBoard(kind: MediaKind): TierBoardView {
  const snapshot = () => tierBoardSnapshot(kind);
  return useSyncExternalStore(subscribeTierBoard, snapshot, snapshot);
}

export function useTrackingState(id: string | undefined): TrackingState {
  const [state, setState] = useState<TrackingState>(() => trackingStateOf(id));
  useEffect(() => {
    setState(trackingStateOf(id));
    const tick = () => setState(trackingStateOf(id));
    subs.add(tick);
    return () => {
      subs.delete(tick);
    };
  }, [id]);
  return state;
}
