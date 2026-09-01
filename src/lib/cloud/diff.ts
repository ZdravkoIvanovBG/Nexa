import type { LocalEntry } from "@/lib/watchlist";
import type { WatchedEntry, WatchingEntry } from "@/lib/library-tracking";
import type { InstalledAddon } from "@/lib/addon-store";
import type { Profile } from "@/lib/profiles";

type AddonLike = InstalledAddon;

/**
 * Row-level delta between two store snapshots.
 *
 * Kept free of value imports so it runs under `node --test` -- see the
 * `import type` only rule the other tested modules follow.
 */
export type Delta<T> = { upserts: T[]; deletes: string[] };

/** Diff on an arbitrary key, so stores keyed by something other than `id` fit. */
export function diffByKey<T>(
  prev: readonly T[],
  next: readonly T[],
  keyOf: (e: T) => string,
  same: (a: T, b: T) => boolean,
): Delta<T> {
  const before = new Map<string, T>();
  for (const e of prev) before.set(keyOf(e), e);

  const upserts: T[] = [];
  const seen = new Set<string>();
  for (const e of next) {
    const k = keyOf(e);
    seen.add(k);
    const old = before.get(k);
    if (!old || !same(old, e)) upserts.push(e);
  }

  const deletes: string[] = [];
  for (const k of before.keys()) if (!seen.has(k)) deletes.push(k);

  return { upserts, deletes };
}

function diffById<T extends { id: string }>(
  prev: readonly T[],
  next: readonly T[],
  same: (a: T, b: T) => boolean,
): Delta<T> {
  return diffByKey(prev, next, (e) => e.id, same);
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

/**
 * Addons are keyed by transport URL, and fingerprinted rather than deep-compared.
 *
 * fetchInstalledAddons writes a backfilled manifest once per addon from three
 * different screens; a deep compare would turn each of those into an upsert
 * storm. manifestFetchedAt is deliberately ignored for the same reason.
 */
function sameAddon(a: AddonLike, b: AddonLike): boolean {
  return (
    a.id === b.id &&
    (a.enabled !== false) === (b.enabled !== false) &&
    (a.order ?? 0) === (b.order ?? 0) &&
    a.installedAt === b.installedAt &&
    a.manifest?.version === b.manifest?.version &&
    a.manifest?.name === b.manifest?.name &&
    (a.manifest?.catalogs?.length ?? 0) === (b.manifest?.catalogs?.length ?? 0)
  );
}

export function diffAddons(
  prev: readonly AddonLike[],
  next: readonly AddonLike[],
): Delta<AddonLike> {
  return diffByKey(prev, next, (a) => a.transportUrl, sameAddon);
}

function sameProfile(a: Profile, b: Profile): boolean {
  return (
    a.name === b.name &&
    a.avatar === b.avatar &&
    a.color === b.color &&
    a.isPrimary === b.isPrimary &&
    a.passwordHash === b.passwordHash &&
    JSON.stringify(a.hideContent) === JSON.stringify(b.hideContent) &&
    JSON.stringify(a.lockedTabs) === JSON.stringify(b.lockedTabs) &&
    JSON.stringify(a.kid) === JSON.stringify(b.kid) &&
    (a.settingsLinked !== false) === (b.settingsLinked !== false) &&
    a.updatedAt === b.updatedAt
  );
}

export function diffProfiles(prev: readonly Profile[], next: readonly Profile[]): Delta<Profile> {
  return diffById(prev, next, sameProfile);
}
