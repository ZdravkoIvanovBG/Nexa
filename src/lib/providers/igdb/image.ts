// IGDB image URLs. Images are served from IGDB's public CDN (no credentials).
// Format: https://images.igdb.com/igdb/image/upload/t_<size>[_2x]/<image_id>.jpg

import type { IgdbArt } from "./types.ts";

export const IGDB_IMAGE_BASE = "https://images.igdb.com/igdb/image/upload";

export type IgdbImageSize =
  | "cover_small" // 90x128
  | "cover_big" // 264x374
  | "screenshot_med" // 569x320
  | "screenshot_big" // 889x500
  | "screenshot_huge" // 1280x720
  | "logo_med" // 284x160
  | "thumb" // 90x90
  | "micro" // 35x35
  | "720p" // 1280x720
  | "1080p"; // 1920x1080

const SIZES: ReadonlySet<string> = new Set<IgdbImageSize>([
  "cover_small",
  "cover_big",
  "screenshot_med",
  "screenshot_big",
  "screenshot_huge",
  "logo_med",
  "thumb",
  "micro",
  "720p",
  "1080p",
]);

const IMAGE_ID = /^[a-z0-9]{1,64}$/i;

export function validImageId(value: unknown): value is string {
  return typeof value === "string" && IMAGE_ID.test(value);
}

/** CDN URL for an image id, or null when the id or size is invalid. */
export function igdbImage(
  imageId: unknown,
  size: IgdbImageSize,
  options: { retina?: boolean } = {},
): string | null {
  if (!validImageId(imageId) || !SIZES.has(size)) return null;
  return `${IGDB_IMAGE_BASE}/t_${size}${options.retina ? "_2x" : ""}/${imageId}.jpg`;
}

const URL_PATTERN =
  /^https:\/\/images\.igdb\.com\/igdb\/image\/upload\/t_([a-z0-9_]+?)(_2x)?\/([a-z0-9]+)\.(jpg|png|webp)$/i;

/** Re-size a URL produced by `igdbImage`. Any other URL comes back unchanged. */
export function resizeIgdbImage(url: string, size: IgdbImageSize, retina = false): string {
  const match = URL_PATTERN.exec(url);
  if (!match || !SIZES.has(match[1])) return url;
  return igdbImage(match[3], size, { retina }) ?? url;
}

type ImageLike = { image_id?: unknown } | null | undefined;

function firstId(list: readonly ImageLike[] | undefined): string | null {
  for (const item of list ?? []) {
    const id = item?.image_id;
    if (validImageId(id)) return id;
  }
  return null;
}

/**
 * Landscape-first art: artwork, then a screenshot, then the portrait cover
 * (flagged `blur` so the UI can fill 16:9 with a blurred copy).
 */
export function pickArt(
  game: { artworks?: ImageLike[]; screenshots?: ImageLike[]; cover?: ImageLike },
  size: IgdbImageSize = "screenshot_big",
): IgdbArt | null {
  const artwork = firstId(game.artworks);
  if (artwork) return { url: igdbImage(artwork, size)!, kind: "artwork", blur: false };
  const shot = firstId(game.screenshots);
  if (shot) return { url: igdbImage(shot, size)!, kind: "screenshot", blur: false };
  const cover = game.cover?.image_id;
  if (validImageId(cover))
    return { url: igdbImage(cover, "cover_big")!, kind: "cover", blur: true };
  return null;
}
