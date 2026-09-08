/**
 * Ordering for the Currently Watching grid.
 *
 * Deliberately NOT sorted by recency (`updatedAt`): that field is bumped by
 * every season/episode stepper click, which used to send the card to
 * position 0 out from under the user's cursor. Order is by insertion
 * (`addedAt`) instead, so a card's position is fixed once it's added and
 * only changes when items are added or removed.
 */

type OrderedEntry = { id: string; addedAt: number };

export function sortWatchingEntries<T extends OrderedEntry>(entries: T[]): T[] {
  return [...entries].sort((a, b) => {
    if (a.addedAt !== b.addedAt) return a.addedAt - b.addedAt;
    // Stable tiebreak: legacy rows can share addedAt (defaulted to 0 by
    // read()'s tolerant parse), so fall back to id for a deterministic order.
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
