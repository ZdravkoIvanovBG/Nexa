// IGDB response normalization (Stage 1 proof of concept). Pure functions: no
// requests, no app state. Anything malformed is dropped rather than guessed.

import type { NamedRef, PlatformFamily } from "../../game-discovery/types.ts";
import { igdbImage, pickArt, validImageId } from "./image.ts";
import { AGE_RATING_ORG_ESRB, THEME_EROTIC } from "./query.ts";
import type {
  IgdbGame,
  IgdbGameDetail,
  IgdbGameId,
  RawIgdbGame,
  RawIgdbNamed,
  RawIgdbPlatform,
  RawIgdbRef,
} from "./types.ts";

export function igdbGameId(igdbId: number): IgdbGameId {
  return `igdb:${igdbId}`;
}

function positiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function refId(value: RawIgdbRef | undefined | null): number | null {
  if (typeof value === "number") return positiveInt(value);
  return positiveInt(value?.id);
}

function refIds(list: readonly RawIgdbRef[] | undefined): number[] {
  const out: number[] = [];
  for (const item of list ?? []) {
    const id = refId(item);
    if (id !== null && !out.includes(id)) out.push(id);
  }
  return out;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function named(list: readonly RawIgdbNamed[] | undefined): NamedRef[] {
  const out: NamedRef[] = [];
  for (const item of list ?? []) {
    const id = positiveInt(item?.id);
    const name = text(item?.name);
    const slug = text(item?.slug);
    if (id !== null && name && slug && !out.some((n) => n.id === id)) out.push({ id, slug, name });
  }
  return out;
}

function score(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return Math.min(100, Math.round(value));
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : 0;
}

/** Unix seconds to an ISO date (UTC), or null. */
export function isoDate(seconds: unknown): string | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return null;
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

// Platform ids for families IGDB has no platform_family for.
const PLATFORM_FAMILY_BY_ID: Record<number, PlatformFamily> = {
  6: "pc", // PC (Microsoft Windows)
  14: "mac",
  3: "linux",
  39: "ios",
  34: "android",
  82: "web", // Web browser
};

// IGDB platform_family ids, for console families only. IGDB's family 4
// ("Linux") also holds Android (34) and Google Stadia (170), so Linux is
// recognised by platform id 3 alone, never by family (verified live 2026-11-05).
const FAMILY_BY_FAMILY_ID: Record<number, PlatformFamily> = {
  1: "playstation",
  2: "xbox",
  5: "nintendo",
};

export function platformFamilyOf(platform: RawIgdbPlatform | undefined): PlatformFamily | null {
  const id = positiveInt(platform?.id);
  if (id !== null && PLATFORM_FAMILY_BY_ID[id]) return PLATFORM_FAMILY_BY_ID[id];
  const family = platform?.platform_family;
  const familyId = typeof family === "number" ? positiveInt(family) : positiveInt(family?.id);
  if (familyId !== null && FAMILY_BY_FAMILY_ID[familyId]) return FAMILY_BY_FAMILY_ID[familyId];
  return id === null ? null : "other";
}

function platformFamilies(list: readonly RawIgdbPlatform[] | undefined): PlatformFamily[] {
  const out: PlatformFamily[] = [];
  for (const platform of list ?? []) {
    const family = platformFamilyOf(platform);
    if (family && !out.includes(family)) out.push(family);
  }
  return out;
}

function esrbOf(raw: RawIgdbGame): string | null {
  for (const rating of raw.age_ratings ?? []) {
    const org = rating?.organization;
    const orgId = typeof org === "number" ? org : org?.id;
    if (orgId !== AGE_RATING_ORG_ESRB) continue;
    const category = rating?.rating_category;
    const label = typeof category === "object" ? text(category?.rating) : null;
    if (label) return label;
  }
  return null;
}

function typeId(value: RawIgdbGame["game_type"]): number | null {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? value : null;
  const id = value?.id;
  return typeof id === "number" && Number.isSafeInteger(id) && id >= 0 ? id : null;
}

/** True when IGDB tags the game with the Erotic theme. */
export function isErotic(raw: RawIgdbGame): boolean {
  // `themes` arrives as objects when sub-fields are requested, as bare ids otherwise.
  const themes = (raw.themes ?? []) as unknown[];
  return themes.some(
    (t) => (typeof t === "number" ? t : (t as { id?: unknown } | null)?.id) === THEME_EROTIC,
  );
}

export function normalizeIgdbGame(raw: RawIgdbGame | null | undefined): IgdbGame | null {
  if (!raw || typeof raw !== "object") return null;
  const igdbId = positiveInt(raw.id);
  const name = text(raw.name);
  const slug = text(raw.slug);
  if (igdbId === null || !name || !slug) return null;
  const released = isoDate(raw.first_release_date);
  const cover = raw.cover?.image_id;
  const screenshots: string[] = [];
  for (const shot of raw.screenshots ?? []) {
    const shotId = shot?.image_id;
    const url = validImageId(shotId) ? igdbImage(shotId, "screenshot_big") : null;
    if (url && !screenshots.includes(url)) screenshots.push(url);
  }
  return {
    id: igdbGameId(igdbId),
    igdbId,
    slug,
    name,
    released,
    tba: released === null,
    art: pickArt(raw),
    cover: validImageId(cover) ? igdbImage(cover, "cover_big") : null,
    criticScore: score(raw.aggregated_rating),
    criticCount: count(raw.aggregated_rating_count),
    userScore: score(raw.rating),
    userCount: count(raw.rating_count),
    genres: named(raw.genres),
    themes: named(raw.themes),
    platformFamilies: platformFamilies(raw.platforms),
    esrb: esrbOf(raw),
    gameType: typeId(raw.game_type),
    versionParent: refId(raw.version_parent),
    screenshots,
  };
}

/**
 * Normalize a list response: drops malformed items and duplicates, keeps IGDB's
 * order. `publicList` (the default) also drops Erotic-themed games, a second
 * line of defence behind the query filter.
 */
export function normalizeIgdbGames(
  raw: unknown,
  options: { publicList?: boolean } = {},
): IgdbGame[] {
  if (!Array.isArray(raw)) return [];
  const publicList = options.publicList ?? true;
  const seen = new Set<number>();
  const out: IgdbGame[] = [];
  for (const item of raw as RawIgdbGame[]) {
    if (publicList && item && isErotic(item)) continue;
    const game = normalizeIgdbGame(item);
    if (!game || seen.has(game.igdbId)) continue;
    seen.add(game.igdbId);
    out.push(game);
  }
  return out;
}

function igdbPageUrl(value: unknown): string | null {
  const url = text(value);
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "www.igdb.com" ? parsed.href : null;
  } catch {
    return null;
  }
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{6,20}$/;

export function normalizeIgdbDetail(raw: RawIgdbGame | null | undefined): IgdbGameDetail | null {
  const base = normalizeIgdbGame(raw);
  if (!base || !raw) return null;
  const developers: NamedRef[] = [];
  const publishers: NamedRef[] = [];
  for (const involved of raw.involved_companies ?? []) {
    const company = typeof involved?.company === "object" ? involved.company : null;
    const [ref] = named(company ? [company] : []);
    if (!ref) continue;
    if (involved.developer && !developers.some((d) => d.id === ref.id)) developers.push(ref);
    if (involved.publisher && !publishers.some((p) => p.id === ref.id)) publishers.push(ref);
  }
  const platforms: string[] = [];
  for (const platform of raw.platforms ?? []) {
    const name = text(platform?.name);
    if (name && !platforms.includes(name)) platforms.push(name);
  }
  const alternativeNames: string[] = [];
  for (const alt of raw.alternative_names ?? []) {
    const name = text(alt?.name);
    if (name && name !== base.name && !alternativeNames.includes(name)) alternativeNames.push(name);
  }
  const videos: string[] = [];
  for (const video of raw.videos ?? []) {
    const id = text(video?.video_id);
    if (id && YOUTUBE_ID.test(id) && !videos.includes(id)) videos.push(id);
  }
  return {
    ...base,
    description: text(raw.summary),
    storyline: text(raw.storyline),
    igdbUrl: igdbPageUrl(raw.url),
    developers,
    publishers,
    platforms,
    alternativeNames,
    videos,
    collections: named(raw.collections),
    franchises: named(raw.franchises),
    related: {
      parent: refId(raw.parent_game),
      remakes: refIds(raw.remakes),
      remasters: refIds(raw.remasters),
      dlcs: refIds(raw.dlcs),
      expansions: refIds(raw.expansions),
      standaloneExpansions: refIds(raw.standalone_expansions),
      similar: refIds(raw.similar_games),
    },
  };
}
