// IGDB records in the shapes Games Discovery renders (GameSummary,
// GameDetail). Pure.
//
// - Ids are always "igdb:N"; nothing here ever produces or reads a RAWG id.
// - Scores: Critic Score is IGDB's aggregated rating, User Score its user
//   rating, both 0–100. The RAWG-only fields (Metacritic, the 0–5 rating,
//   "added") stay null or 0, so no IGDB number is ever labelled Metacritic.
// - Art is landscape first (artwork, then screenshot) at full size; views ask
//   for smaller sizes through the image helper. A portrait cover is marked so
//   it's never cropped into a 16:9 frame.

import type { GameDetail, GameSummary, GameVariant, NamedRef } from "../../game-discovery/types.ts";
import { resizeIgdbImage } from "./image.ts";
import { GAME_TYPE, WEBSITE_TYPE_OFFICIAL } from "./query.ts";
import type { IgdbGame, IgdbGameDetail, RawIgdbGame } from "./types.ts";

/** Screenshots a summary carries, like RAWG's short_screenshots. */
export const SHORT_SCREENSHOTS = 6;

const VARIANT_BY_TYPE: Record<number, GameVariant> = {
  [GAME_TYPE.dlc]: "dlc",
  [GAME_TYPE.expansion]: "expansion",
  [GAME_TYPE.bundle]: "bundle",
  [GAME_TYPE.standaloneExpansion]: "standalone",
  [GAME_TYPE.mod]: "mod",
  [GAME_TYPE.episode]: "episode",
  [GAME_TYPE.season]: "season",
  [GAME_TYPE.remake]: "remake",
  [GAME_TYPE.remaster]: "remaster",
  [GAME_TYPE.expandedGame]: "expanded",
  [GAME_TYPE.port]: "port",
  [GAME_TYPE.fork]: "fork",
  [GAME_TYPE.pack]: "pack",
  [GAME_TYPE.update]: "update",
};

function variantOf(game: IgdbGame): GameVariant | undefined {
  if (game.versionParent !== null) return "edition";
  if (game.gameType === null || game.gameType === GAME_TYPE.main) return undefined;
  return VARIANT_BY_TYPE[game.gameType];
}

const full = (url: string) => resizeIgdbImage(url, "1080p");

export function toGameSummary(game: IgdbGame): GameSummary {
  const art = game.art;
  const portrait = art?.kind === "cover";
  const summary: GameSummary = {
    id: game.id,
    slug: game.slug,
    name: game.name,
    released: game.released,
    tba: game.tba,
    image: art ? (portrait ? art.url : full(art.url)) : null,
    metacritic: null,
    rating: null,
    ratingsCount: game.userCount,
    added: 0,
    genres: game.genres,
    platformFamilies: game.platformFamilies,
    esrb: game.esrb ? `ESRB ${game.esrb}` : null,
    shortScreenshots: game.screenshots.slice(0, SHORT_SCREENSHOTS).map(full),
    criticScore: game.criticScore,
    criticCount: game.criticCount,
    userScore: game.userScore,
    userCount: game.userCount,
  };
  summary.heroImage = game.heroArt ? full(game.heroArt.url) : null;
  if (portrait) summary.imageKind = "portrait";
  const variant = variantOf(game);
  if (variant) summary.variant = variant;
  return summary;
}

/** http(s) only; anything else (javascript:, file:, data:, junk) is dropped. */
export function webUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function officialWebsite(raw: RawIgdbGame): string | null {
  for (const site of raw.websites ?? []) {
    const type = typeof site?.type === "number" ? site.type : site?.type?.id;
    if (type !== WEBSITE_TYPE_OFFICIAL) continue;
    const url = webUrl(site?.url);
    if (url) return url;
  }
  return null;
}

const ids = (list: readonly number[]) => list.map((n) => `igdb:${n}` as const);

/** Themes worth showing as tags. Erotic never reaches a detail page (the provider refuses it). */
function tags(game: IgdbGame): NamedRef[] {
  return game.themes.slice(0, 12);
}

export function toGameDetail(detail: IgdbGameDetail, raw: RawIgdbGame): GameDetail {
  const summary = toGameSummary(detail);
  const screenshots = detail.screenshots.map(full);
  // A second landscape image (backdrop alternative), when there is one.
  const imageAlt =
    screenshots.find((url) => url !== summary.image && url !== summary.heroImage) ?? null;
  const r = detail.related;
  const parents = [r.parent, detail.versionParent].filter(
    (n, i, all): n is number => n !== null && all.indexOf(n) === i,
  );
  const versions = [...new Set([...r.remakes, ...r.remasters])];
  const additions = [...new Set([...r.dlcs, ...r.expansions, ...r.standaloneExpansions])];
  return {
    ...summary,
    description: detail.description ?? detail.storyline,
    storyline: detail.description && detail.storyline ? detail.storyline : null,
    imageAlt,
    website: officialWebsite(raw),
    providerUrl: detail.igdbUrl,
    developers: detail.developers,
    publishers: detail.publishers,
    platforms: detail.platforms.map((name) => ({ name, releasedAt: null })),
    tags: tags(detail),
    playtime: null,
    alternativeNames: detail.alternativeNames,
    screenshots,
    counts: {
      screenshots: screenshots.length,
      // Series membership is curated franchise data: Stage 5.
      series: 0,
      additions: additions.length,
      parents: parents.length,
      versions: versions.length,
      similar: r.similar.length,
    },
    relations: {
      parents: ids(parents),
      versions: ids(versions),
      additions: ids(additions),
      similar: ids(r.similar),
    },
  };
}
