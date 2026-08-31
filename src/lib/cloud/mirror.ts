import type { LocalEntry } from "@/lib/watchlist";
import type { WatchedEntry, WatchingEntry } from "@/lib/library-tracking";
import { diffWatched, diffWatching, diffWatchlist, type Delta } from "./diff";
import { enqueue, flush } from "./queue";
import {
  TABLE,
  watchedToRow,
  watchingToRow,
  watchlistToRow,
  type AnyRow,
  type CloudTable,
  type Owner,
} from "./rows";

export type TrackingSnapshot = { watching: WatchingEntry[]; watched: WatchedEntry[] };

/**
 * The stores call into here from their single `write()` chokepoint, so every
 * action method (toggleWatchlist, setProgress, moveToTier, ...) syncs without
 * each one having to know the cloud exists.
 */
let owner: Owner | null = null;
let applyingRemote = false;
let prevWatchlist: LocalEntry[] = [];
let prevTracking: TrackingSnapshot = { watching: [], watched: [] };

export function cloudSyncOwner(): Owner | null {
  return owner;
}

/** Arm mirroring for a user + profile. Snapshots are primed by the hydrator. */
export function beginCloudSync(next: Owner): void {
  owner = next;
}

/** Disarm on sign-out or profile switch. Local storage is left untouched. */
export function endCloudSync(): void {
  owner = null;
  prevWatchlist = [];
  prevTracking = { watching: [], watched: [] };
}

/**
 * Run a remote-driven store write without echoing it straight back up. Without
 * this, hydrating from the cloud would re-upload everything it just pulled.
 */
export function applyRemote<T>(fn: () => T): T {
  applyingRemote = true;
  try {
    return fn();
  } finally {
    applyingRemote = false;
  }
}

/** Seed the baselines so the first user edit diffs against reality, not empty. */
export function primeSnapshots(watchlist: LocalEntry[], tracking: TrackingSnapshot): void {
  prevWatchlist = watchlist.map((e) => ({ ...e }));
  prevTracking = {
    watching: tracking.watching.map((e) => ({ ...e })),
    watched: tracking.watched.map((e) => ({ ...e })),
  };
}

function push<T extends { id: string }>(
  table: CloudTable,
  o: Owner,
  delta: Delta<T>,
  toRow: (entry: T) => AnyRow,
): void {
  for (const entry of delta.upserts) {
    enqueue({ op: "upsert", table, owner: o, mediaId: entry.id, row: toRow(entry) });
  }
  for (const id of delta.deletes) {
    enqueue({ op: "delete", table, owner: o, mediaId: id });
  }
}

export function mirrorWatchlist(next: LocalEntry[]): void {
  if (!owner || applyingRemote) return;
  const o = owner;
  const now = Date.now();
  const delta = diffWatchlist(prevWatchlist, next);
  prevWatchlist = next.map((e) => ({ ...e }));
  if (delta.upserts.length === 0 && delta.deletes.length === 0) return;
  push(TABLE.watchlist, o, delta, (e) => watchlistToRow(o, e, now));
}

export function mirrorTracking(next: TrackingSnapshot): void {
  if (!owner || applyingRemote) return;
  const o = owner;
  const now = Date.now();
  const watching = diffWatching(prevTracking.watching, next.watching);
  const watched = diffWatched(prevTracking.watched, next.watched);
  prevTracking = {
    watching: next.watching.map((e) => ({ ...e })),
    watched: next.watched.map((e) => ({ ...e })),
  };
  push(TABLE.watching, o, watching, (e) => watchingToRow(o, e));
  push(TABLE.tiers, o, watched, (e) => watchedToRow(o, e, now));
}

/** Push anything still queued, e.g. before the window closes. */
export function flushCloud(): Promise<void> {
  return flush();
}
