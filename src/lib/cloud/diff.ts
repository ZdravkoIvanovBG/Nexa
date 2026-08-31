import type { LocalEntry } from "@/lib/watchlist";
import type { WatchedEntry, WatchingEntry } from "@/lib/library-tracking";

/**
 * Row-level delta between two store snapshots.
 *
 * Kept free of value imports so it runs under `node --test` -- see the
 * `import type` only rule the other tested modules follow.
 */
export type Delta<T extends { id: string }> = { upserts: T[]; deletes: string[] };

function diffById<T extends { id: string }>(
  prev: readonly T[],
  next: readonly T[],
  same: (a: T, b: T) => boolean,
): Delta<T> {
  const before = new Map<string, T>();
  for (const e of prev) before.set(e.id, e);

  const upserts: T[] = [];
  const seen = new Set<string>();
  for (const e of next) {
    seen.add(e.id);
    const old = before.get(e.id);
    if (!old || !same(old, e)) upserts.push(e);
  }

  const deletes: string[] = [];
  for (const id of before.keys()) if (!seen.has(id)) deletes.push(id);

  return { upserts, deletes };
}

function sameWatchlist(a: LocalEntry, b: LocalEntry): boolean {
  return a.type === b.type && a.name === b.name && a.poster === b.poster && a.addedAt === b.addedAt;
}

function sameWatching(a: WatchingEntry, b: WatchingEntry): boolean {
  return (
    a.type === b.type &&
    a.name === b.name &&
    a.poster === b.poster &&
    a.season === b.season &&
    a.episode === b.episode &&
    a.totalSeasons === b.totalSeasons &&
    a.status === b.status &&
    a.yearLabel === b.yearLabel &&
    a.addedAt === b.addedAt &&
    a.updatedAt === b.updatedAt
  );
}

function sameWatched(a: WatchedEntry, b: WatchedEntry): boolean {
  return (
    a.type === b.type &&
    a.name === b.name &&
    a.poster === b.poster &&
    a.tier === b.tier &&
    a.order === b.order &&
    a.finishedAt === b.finishedAt
  );
}

export function diffWatchlist(
  prev: readonly LocalEntry[],
  next: readonly LocalEntry[],
): Delta<LocalEntry> {
  return diffById(prev, next, sameWatchlist);
}

export function diffWatching(
  prev: readonly WatchingEntry[],
  next: readonly WatchingEntry[],
): Delta<WatchingEntry> {
  return diffById(prev, next, sameWatching);
}

export function diffWatched(
  prev: readonly WatchedEntry[],
  next: readonly WatchedEntry[],
): Delta<WatchedEntry> {
  return diffById(prev, next, sameWatched);
}
