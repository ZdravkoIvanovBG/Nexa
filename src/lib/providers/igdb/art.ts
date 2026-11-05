// Landscape art selection for IGDB games (Stage 4A). Pure and deterministic.
//
// What IGDB gives us, per image (verified live 2026-11-05):
// - artworks carry `artwork_type` (1 artwork, 2 key art without logo, 3 key
//   art with logo, 4 concept art, 5–7 game logos, 8 infographic, 9–11 covers,
//   12 icon, 13 historical logo, 14 historical icon, 15 historical artwork),
//   `width`, `height` and `alpha_channel`. Logos are mostly transparent PNGs.
// - screenshots carry `width` and `height`; about 30% of popular games'
//   screenshots are under 1280 px wide.
// - The CDN's `720p`/`1080p` sizes fit the image (aspect kept) and upscale
//   small sources; `screenshot_med/big/huge` crop-fill to 16:9 from the centre.
//
// What this can and can't do: metadata tells us an image is a logo, an icon,
// a cover, transparent, too small or too far from 16:9 to frame. It can't tell
// a cinematic scene from busy key art; curated overrides (art-overrides.ts)
// cover the high-visibility games where that matters.

import { igdbImage, validImageId } from "./image.ts";

export type ArtUse = "hero" | "card";

export type ArtCandidate = {
  kind: "artwork" | "screenshot";
  imageId: string;
  width: number | null;
  height: number | null;
  /** IGDB artwork_type id; null for screenshots or when IGDB omits it. */
  artworkType: number | null;
  alpha: boolean;
  animated: boolean;
  /** Position in IGDB's list, the last tie-breaker. */
  index: number;
};

export type ArtRef = { kind: "artwork" | "screenshot"; imageId: string };

export const ARTWORK_TYPE = {
  artwork: 1,
  keyArtWithoutLogo: 2,
  keyArtWithLogo: 3,
  conceptArt: 4,
  logoWhite: 5,
  logoBlack: 6,
  logoColor: 7,
  infographic: 8,
  alternativeCover: 9,
  historicalCover: 10,
  squareCover: 11,
  icon: 12,
  historicalLogo: 13,
  historicalIcon: 14,
  historicalArtwork: 15,
} as const;

/** Never a background: logos, icons, covers and infographics. */
const NEVER: ReadonlySet<number> = new Set([5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);

/**
 * Preference by source, best first, per use (judged in the contact sheet):
 * - Key art without a logo is made to be a background: first everywhere.
 * - Hero: real screenshots next, because they never carry the logo, which
 *   would sit under the hero title; key art with a logo goes last.
 * - Card: key art with a logo is the game's poster and reads well small
 *   (Control Resonant, Gears of War: E-Day); screenshots follow.
 * - Generic "artwork" is often a text-heavy promo (RDR2's quote posters),
 *   concept and historical art are hit and miss: after screenshots.
 */
function tier(c: ArtCandidate, use: ArtUse): number {
  if (c.kind === "screenshot") return use === "hero" ? 2 : 3;
  switch (c.artworkType) {
    case ARTWORK_TYPE.keyArtWithoutLogo:
      return 1;
    case ARTWORK_TYPE.keyArtWithLogo:
      return use === "hero" ? 6 : 2;
    case ARTWORK_TYPE.artwork:
    case null:
      return 4;
    case ARTWORK_TYPE.conceptArt:
    case ARTWORK_TYPE.historicalArtwork:
      return 5;
    default:
      return 7;
  }
}

type Rule = {
  /** Smallest source width that won't look soft at this use's size. */
  minWidth: number;
  /** Smallest source height, so a short banner isn't blown up to fill the frame. */
  minHeight: number;
  /** Aspect ratios the frame can show without a severe crop. */
  minRatio: number;
  maxRatio: number;
  /**
   * Key art may be a wider banner (IGDB has many 3840×1240 ones): its subject
   * sits in the middle, so a centre crop keeps it. Ranked after images that fit.
   */
  bannerMaxRatio: number;
  /** The frame's own aspect ratio, preferred when ranking. */
  target: number;
};

export const ART_RULES: Record<ArtUse, Rule> = {
  // Full-bleed, 78vh: around 1920×840–1000 on a 1080p screen.
  hero: {
    minWidth: 1600,
    minHeight: 800,
    minRatio: 1.5,
    maxRatio: 2.5,
    bannerMaxRatio: 3.2,
    target: 1.9,
  },
  // 16:9 cards, roughly 260–360 px wide (up to ~600 device px).
  card: {
    minWidth: 640,
    minHeight: 300,
    minRatio: 1.3,
    maxRatio: 2.2,
    bannerMaxRatio: 3.2,
    target: 16 / 9,
  },
};

const KEY_ART: ReadonlySet<number> = new Set([1, 2, 3]);

/** A wide key-art banner: allowed beyond `maxRatio`, ranked after images that fit. */
function banner(c: ArtCandidate, use: ArtUse): boolean {
  const ratio = ratioOf(c);
  return ratio !== null && ratio > ART_RULES[use].maxRatio;
}

const ratioOf = (c: ArtCandidate) => (c.width && c.height ? c.width / c.height : null);

/**
 * True when the image can be used as landscape art for `use` at all.
 * `allowAlpha` is for curated overrides only: IGDB flags some fully opaque key
 * art as having an alpha channel, which only a person looking at it can rule out.
 */
export function suitable(
  c: ArtCandidate,
  use: ArtUse,
  options: { allowAlpha?: boolean } = {},
): boolean {
  if (!validImageId(c.imageId) || c.animated) return false;
  if (c.alpha && !options.allowAlpha) return false;
  if (c.kind === "artwork" && c.artworkType !== null && NEVER.has(c.artworkType)) return false;
  const rule = ART_RULES[use];
  const ratio = ratioOf(c);
  if (ratio === null) {
    // Unknown size: a screenshot is a 16:9-ish frame grab, fine on a card;
    // a hero needs proof that the image is big enough.
    return use === "card" && c.kind === "screenshot";
  }
  const keyArt = c.kind === "artwork" && c.artworkType !== null && KEY_ART.has(c.artworkType);
  const maxRatio = keyArt ? rule.bannerMaxRatio : rule.maxRatio;
  if (ratio < rule.minRatio || ratio > maxRatio) return false;
  return (c.width ?? 0) >= rule.minWidth && (c.height ?? 0) >= rule.minHeight;
}

/** Candidates usable for `use`, best first. Deterministic for equal input. */
export function rankArt(candidates: readonly ArtCandidate[], use: ArtUse): ArtCandidate[] {
  const rule = ART_RULES[use];
  return candidates
    .filter((c) => suitable(c, use))
    .sort((a, b) => {
      const byTier = tier(a, use) - tier(b, use);
      if (byTier !== 0) return byTier;
      const byBanner = Number(banner(a, use)) - Number(banner(b, use));
      if (byBanner !== 0) return byBanner;
      // More pixels up to the size we'll show; beyond that it doesn't matter.
      const cap = use === "hero" ? 1920 : 1280;
      const byWidth = Math.min(b.width ?? 0, cap) - Math.min(a.width ?? 0, cap);
      if (byWidth !== 0) return byWidth;
      const fit = (c: ArtCandidate) => Math.abs((ratioOf(c) ?? rule.target) - rule.target);
      const byFit = fit(a) - fit(b);
      if (Math.abs(byFit) > 0.02) return byFit;
      if (a.kind !== b.kind) return a.kind === "artwork" ? -1 : 1;
      return a.index - b.index;
    });
}

/**
 * The art to show for `use`: the curated override when it names one of the
 * game's own images and that image is usable, otherwise the best candidate.
 */
export function selectArt(
  candidates: readonly ArtCandidate[],
  use: ArtUse,
  override?: ArtRef | null,
): ArtCandidate | null {
  if (override) {
    const own = candidates.find((c) => c.kind === override.kind && c.imageId === override.imageId);
    // An override can lift a candidate the rules rank low, never one they
    // reject, except for IGDB's alpha flag (see `suitable`).
    if (own && suitable(own, use, { allowAlpha: true })) return own;
  }
  return rankArt(candidates, use)[0] ?? null;
}

/** Full-size URL ("1080p" fits the image and keeps its aspect). */
export function artUrl(c: Pick<ArtCandidate, "imageId">): string | null {
  return igdbImage(c.imageId, "1080p");
}

type RawImage = {
  image_id?: unknown;
  width?: unknown;
  height?: unknown;
  artwork_type?: unknown;
  alpha_channel?: unknown;
  animated?: unknown;
};

function positive(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function typeId(value: unknown): number | null {
  if (typeof value === "number") return positive(value);
  return positive((value as { id?: unknown } | null)?.id);
}

/** Candidates from a raw IGDB game's artworks and screenshots (deduped by image id). */
export function artCandidates(raw: {
  artworks?: readonly (RawImage | null | undefined)[];
  screenshots?: readonly (RawImage | null | undefined)[];
}): ArtCandidate[] {
  const out: ArtCandidate[] = [];
  const seen = new Set<string>();
  const add = (
    kind: ArtCandidate["kind"],
    list: readonly (RawImage | null | undefined)[] | undefined,
  ) => {
    (list ?? []).forEach((item, index) => {
      const imageId = item?.image_id;
      if (!validImageId(imageId) || seen.has(imageId)) return;
      seen.add(imageId);
      out.push({
        kind,
        imageId,
        width: positive(item?.width),
        height: positive(item?.height),
        artworkType: kind === "artwork" ? typeId(item?.artwork_type) : null,
        alpha: item?.alpha_channel === true,
        animated: item?.animated === true,
        index,
      });
    });
  };
  add("artwork", raw.artworks);
  add("screenshot", raw.screenshots);
  return out;
}
