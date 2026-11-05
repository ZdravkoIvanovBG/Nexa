// A saved game's snapshot in the shape Discovery pages expect, so a detail page
// opened from the library paints at once, and without the provider if it has
// to. Every list is present and empty: the detail page reads them without
// checking.
import { gameImageKind } from "../game-discovery/game-image.ts";
import type { GameSummary } from "../game-discovery/types.ts";
import type { GameRecord } from "./types.ts";

export function snapshotSummary(record: GameRecord): GameSummary {
  const summary: GameSummary = {
    id: record.gameId,
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
  // A RAWG snapshot stays exactly as it always was: landscape art, no extras.
  if (record.provider === "rawg") return summary;
  // An IGDB record saved its cover (or landscape art when it had none). The
  // snapshot has no hero-sized art, so the page never stretches the cover.
  const portrait = gameImageKind(record.image) === "cover";
  summary.cover = portrait ? record.image : null;
  summary.heroImage = null;
  if (portrait) summary.imageKind = "portrait";
  return summary;
}
