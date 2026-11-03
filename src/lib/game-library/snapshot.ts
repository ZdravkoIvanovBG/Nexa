// A saved game's snapshot in the shape Discovery pages expect, so a detail page
// opened from the library paints at once, and without RAWG if it has to. Every
// list is present and empty: the detail page reads them without checking.
import type { GameSummary } from "../game-discovery/types.ts";
import type { GameRecord } from "./types.ts";

export function snapshotSummary(record: GameRecord): GameSummary {
  return {
    rawgId: record.rawgId,
    slug: record.slug,
    name: record.name,
    released: record.released,
    tba: false,
    image: record.image,
    metacritic: null,
    rating: null,
    ratingsCount: 0,
    added: 0,
    genres: [],
    platformFamilies: [],
    esrb: null,
    shortScreenshots: [],
  };
}
