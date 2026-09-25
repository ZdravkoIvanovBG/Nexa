/**
 * Ordering rules for the ranking board.
 *
 * `order` is dense per (tier, media kind) rather than per tier: the Tier List
 * shows one kind at a time, so re-ranking a movie must leave the shows sharing
 * that tier untouched, and vice versa.
 *
 * Kept as a leaf module with no runtime imports -- like watching-order.ts --
 * so these rules run under `node --test`. library-tracking.ts itself reaches
 * localStorage and the cloud mirror and cannot be imported from a test.
 */
import type { Tier } from "./tracking-tiers";

export type MediaKind = "movie" | "series";

type Rankable = {
  id: string;
  type: MediaKind;
  tier: Tier;
  order: number;
  finishedAt: number;
};

/**
 * Keeps a new entry inside the int4 range of the cloud's `order_index` column.
 * read() defaults a missing order to Number.MAX_SAFE_INTEGER, and `max + 1` on
 * one of those would be rejected by Postgres with 22003 -- a code the write
 * queue does not treat as fatal, so it would retry forever.
 */
const MAX_ORDER = 1_000_000;

/**
 * Entries can collide on `order`: rows interleaved across kinds from before
 * the split, a partially merged cloud pull, or the MAX_SAFE_INTEGER fallback.
 * Tiebreak so every device resolves a collision the same way.
 */
function byOrder(a: Rankable, b: Rankable): number {
  if (a.order !== b.order) return a.order - b.order;
  if (a.finishedAt !== b.finishedAt) return a.finishedAt - b.finishedAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Groups one media kind into tier rows, each sorted by rank. `tiers` is passed
 * in rather than imported so this module stays free of runtime imports; every
 * tier gets a row, empty or not.
 */
export function bucketByTier<T extends Rankable>(
  items: readonly T[],
  kind: MediaKind,
  tiers: readonly Tier[],
): Record<Tier, T[]> {
  const board = {} as Record<Tier, T[]>;
  for (const tier of tiers) board[tier] = [];
  for (const item of items) {
    if (item.type === kind) board[item.tier]?.push(item);
  }
  for (const tier of tiers) board[tier].sort(byOrder);
  return board;
}

/** Next free rank at the end of (tier, kind). */
export function nextOrderFor<T extends Rankable>(
  items: readonly T[],
  tier: Tier,
  kind: MediaKind,
): number {
  let max = -1;
  for (const item of items) {
    if (item.tier === tier && item.type === kind && item.order > max) max = item.order;
  }
  return max < 0 ? 0 : Math.min(max + 1, MAX_ORDER);
}

/**
 * Moves `id` into `tier` at `index`, renumbering densely within that entry's
 * own media kind only. Mutates `items` in place; returns false for an unknown
 * id so the caller can skip the write.
 */
export function placeInTier<T extends Rankable>(
  items: T[],
  id: string,
  tier: Tier,
  index: number,
): boolean {
  const entry = items.find((e) => e.id === id);
  if (!entry) return false;
  const from = entry.tier;
  const kind = entry.type;
  const target = items
    .filter((e) => e.tier === tier && e.type === kind && e.id !== id)
    .sort(byOrder);
  const at = Math.max(0, Math.min(index, target.length));
  target.splice(at, 0, entry);
  entry.tier = tier;
  target.forEach((e, i) => {
    e.order = i;
  });
  if (from !== tier) {
    // entry.tier was already reassigned above, so it drops out of this filter.
    items
      .filter((e) => e.tier === from && e.type === kind)
      .sort(byOrder)
      .forEach((e, i) => {
        e.order = i;
      });
  }
  return true;
}

/**
 * Folds movie ids from the device-local watched set into the ranking entries,
 * so a movie marked watched by any path is on the board. Ids already present
 * -- directly or through `aliasOf` (a tt id vs its tmdb:movie id) -- are
 * skipped, which keeps the entry's tier untouched. New ones arrive unranked
 * after the existing unranked movies. `entries` is not mutated.
 */
export function mergeWatchedMovies<T extends Rankable>(
  entries: readonly T[],
  movieIds: readonly string[],
  aliasOf: (id: string) => string | undefined,
  make: (id: string, order: number) => T,
): T[] {
  const known = new Set<string>();
  const remember = (id: string) => {
    known.add(id);
    const alias = aliasOf(id);
    if (alias) known.add(alias);
  };
  for (const entry of entries) remember(entry.id);
  const out = entries.slice();
  let order = nextOrderFor(entries, "unranked", "movie");
  for (const id of movieIds) {
    const alias = aliasOf(id);
    if (known.has(id) || (alias && known.has(alias))) continue;
    remember(id);
    out.push(make(id, order));
    order += 1;
  }
  return out;
}

export function countsByKind<T extends { type: MediaKind }>(
  items: readonly T[],
): Record<MediaKind, number> {
  const counts: Record<MediaKind, number> = { movie: 0, series: 0 };
  for (const item of items) counts[item.type] += 1;
  return counts;
}
