import type { Meta } from "./cinemeta";

/** Release year as a number, or 0 when the addon gave us nothing usable. */
export function releaseYear(m: Meta): number {
  return parseInt((m.releaseInfo ?? "").slice(0, 4), 10) || 0;
}

/**
 * Newest first. Sort is stable, so titles sharing a year — and the year-less
 * bucket that sinks to the bottom — keep the order the addon returned them in.
 */
export function sortByYearDesc(items: Meta[]): Meta[] {
  return [...items].sort((a, b) => releaseYear(b) - releaseYear(a));
}
