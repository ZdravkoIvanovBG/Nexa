import type {
  GameDetail,
  GamePage,
  GameSummary,
  NamedRef,
  PlatformFamily,
} from "../../game-discovery/types.ts";
import type {
  RawgGameDetail,
  RawgListGame,
  RawgNamed,
  RawgPage,
  RawgPlatformWrap,
  RawgScreenshot,
} from "./types.ts";

function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * A parsed http(s) URL, or null. RAWG's website field is third-party data and
 * openUrl falls back to an in-app browser with no scheme check, so nothing else
 * may reach it. Returns the parsed form: what gets opened is what was checked.
 */
export function webUrl(value: unknown): string | null {
  const text = str(value);
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function date(value: unknown): string | null {
  const s = str(value);
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return Number.isNaN(Date.parse(s)) ? null : s;
}

function named(list: RawgNamed[] | null | undefined): NamedRef[] {
  if (!Array.isArray(list)) return [];
  const out: NamedRef[] = [];
  for (const item of list) {
    const id = num(item?.id);
    const name = str(item?.name);
    if (id === null || !name) continue;
    out.push({ id, slug: str(item?.slug) ?? String(id), name });
  }
  return out;
}

const FAMILY_BY_SLUG: Record<string, PlatformFamily> = {
  pc: "pc",
  playstation: "playstation",
  xbox: "xbox",
  nintendo: "nintendo",
  mac: "mac",
  linux: "linux",
  ios: "ios",
  android: "android",
  web: "web",
};

function families(list: RawgPlatformWrap[] | null | undefined): PlatformFamily[] {
  if (!Array.isArray(list)) return [];
  const out: PlatformFamily[] = [];
  for (const wrap of list) {
    const slug = str(wrap?.platform?.slug);
    if (!slug) continue;
    const family = FAMILY_BY_SLUG[slug] ?? "other";
    if (!out.includes(family)) out.push(family);
  }
  return out;
}

/** Plain text from RAWG's HTML description, for when description_raw is absent. */
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Null when the item lacks an id, slug or name (unusable for navigation). */
export function normalizeGameSummary(raw: RawgListGame | null | undefined): GameSummary | null {
  const rawgId = num(raw?.id);
  const name = str(raw?.name);
  const slug = str(raw?.slug);
  if (rawgId === null || !name || !slug) return null;
  const rating = num(raw?.rating);
  const metacritic = num(raw?.metacritic);
  const screenshots = Array.isArray(raw?.short_screenshots) ? raw.short_screenshots : [];
  const image = str(raw?.background_image);
  return {
    rawgId,
    slug,
    name,
    released: date(raw?.released),
    tba: raw?.tba === true,
    image,
    metacritic: metacritic !== null && metacritic > 0 ? metacritic : null,
    rating: rating !== null && rating > 0 ? rating : null,
    ratingsCount: num(raw?.ratings_count) ?? 0,
    added: num(raw?.added) ?? 0,
    genres: named(raw?.genres),
    platformFamilies: families(raw?.parent_platforms),
    esrb: str(raw?.esrb_rating?.name),
    // RAWG repeats background_image as the first short screenshot.
    shortScreenshots: screenshots
      .map((s) => str(s?.image))
      .filter((u): u is string => u !== null && u !== image),
  };
}

export function normalizeGameDetail(raw: RawgGameDetail | null | undefined): GameDetail | null {
  const summary = normalizeGameSummary(raw);
  if (!summary || !raw) return null;
  const description =
    str(raw.description_raw) ?? (str(raw.description) ? stripHtml(raw.description!) : null);
  const platforms = Array.isArray(raw.platforms)
    ? raw.platforms
        .map((p) => ({ name: str(p?.platform?.name), releasedAt: date(p?.released_at) }))
        .filter((p): p is { name: string; releasedAt: string | null } => p.name !== null)
    : [];
  const tags = Array.isArray(raw.tags)
    ? named(raw.tags.filter((tag) => !tag?.language || tag.language === "eng"))
    : [];
  const playtime = num(raw.playtime);
  return {
    ...summary,
    description: description || null,
    imageAlt: str(raw.background_image_additional),
    website: webUrl(raw.website),
    developers: named(raw.developers),
    publishers: named(raw.publishers),
    platforms,
    tags,
    playtime: playtime !== null && playtime > 0 ? playtime : null,
    alternativeNames: Array.isArray(raw.alternative_names)
      ? raw.alternative_names.map(str).filter((n): n is string => n !== null)
      : [],
    counts: {
      screenshots: num(raw.screenshots_count) ?? 0,
      series: num(raw.game_series_count) ?? 0,
      additions: num(raw.additions_count) ?? 0,
      parents: num(raw.parents_count) ?? 0,
    },
  };
}

export function normalizeGamePage(raw: RawgPage<RawgListGame> | null | undefined): GamePage {
  const results = Array.isArray(raw?.results) ? raw.results : [];
  const items: GameSummary[] = [];
  const seen = new Set<number>();
  for (const entry of results) {
    const game = normalizeGameSummary(entry);
    if (!game || seen.has(game.rawgId)) continue;
    seen.add(game.rawgId);
    items.push(game);
  }
  return { items, count: num(raw?.count) ?? items.length, hasMore: !!str(raw?.next) };
}

export function normalizeScreenshots(raw: RawgPage<RawgScreenshot> | null | undefined): string[] {
  const results = Array.isArray(raw?.results) ? raw.results : [];
  return results.map((s) => str(s?.image)).filter((u): u is string => u !== null);
}
