import { useEffect, useState } from "react";
import { setItemWithRecovery, freeStorageSpace } from "@/lib/storage-recovery";
import { applyRemote, mirrorTracking } from "@/lib/cloud/mirror";
import { ALL_TIERS, normalizeTier, type Tier } from "@/lib/tracking-tiers";
import { sortWatchingEntries } from "@/lib/watching-order";

const KEY = "harbor.librarytracking.v1";
const subs = new Set<() => void>();

export { ALL_TIERS, TIERS, type RankedTier, type Tier } from "@/lib/tracking-tiers";

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
  type: "movie" | "series";
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
  type: "movie" | "series";
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

function inferType(id: string): "movie" | "series" {
  return id.includes(":tv:") || id.includes(":series:") ? "series" : "movie";
}

function normalizeType(type: string | undefined, id: string): "movie" | "series" {
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
          type: e.type === "series" ? "series" : "movie",
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

function nextOrder(watched: WatchedEntry[], tier: Tier): number {
  let max = -1;
  for (const e of watched) if (e.tier === tier && e.order > max) max = e.order;
  return max + 1;
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

export function readTierBoard(): Record<Tier, WatchedEntry[]> {
  const board = {} as Record<Tier, WatchedEntry[]>;
  for (const tier of ALL_TIERS) board[tier] = [];
  for (const entry of read().watched) board[entry.tier].push(entry);
  for (const tier of ALL_TIERS) board[tier].sort((a, b) => a.order - b.order);
  return board;
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
    store.watching = store.watching.filter((e) => e.id !== input.id);
    write(store);
    return;
  }
  if (store.watched.length >= MAX_WATCHED) {
    // At the cap, nothing is added to the Tier List -- leave it in Currently
    // Watching too, rather than silently dropping it from both lists.
    return;
  }
  store.watched.push({
    id: input.id,
    type: normalizeType(input.type ?? fromWatching?.type, input.id),
    name: input.name ?? fromWatching?.name ?? "",
    poster: input.poster ?? fromWatching?.poster,
    tier: "unranked",
    order: nextOrder(store.watched, "unranked"),
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
  const next = store.watched.filter((e) => e.id !== id);
  if (next.length === store.watched.length) return;
  store.watched = next;
  write(store);
}

export function moveToTier(id: string, tier: Tier, index: number): void {
  const store = read();
  const entry = store.watched.find((e) => e.id === id);
  if (!entry) return;
  const from = entry.tier;
  const target = store.watched
    .filter((e) => e.tier === tier && e.id !== id)
    .sort((a, b) => a.order - b.order);
  const at = Math.max(0, Math.min(index, target.length));
  target.splice(at, 0, entry);
  entry.tier = tier;
  target.forEach((e, i) => {
    e.order = i;
  });
  if (from !== tier) {
    store.watched
      .filter((e) => e.tier === from)
      .sort((a, b) => a.order - b.order)
      .forEach((e, i) => {
        e.order = i;
      });
  }
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

export function useTierBoard(): Record<Tier, WatchedEntry[]> {
  const [board, setBoard] = useState<Record<Tier, WatchedEntry[]>>(readTierBoard);
  useEffect(() => {
    const tick = () => setBoard(readTierBoard());
    subs.add(tick);
    return () => {
      subs.delete(tick);
    };
  }, []);
  return board;
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
