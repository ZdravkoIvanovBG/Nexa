// Card, hero and thumbnail sizes for game art from any provider. Returns
// [preferred, ...fallbacks]; empty when there is no image.
//
// - RAWG media goes through RAWG's resize path, exactly as before.
// - IGDB art is stored full size (1080p, "fit"); views get a smaller landscape
//   size. A portrait cover keeps its own size: asking IGDB for a landscape
//   size of a cover would crop it.
// - Any other URL comes back as is.

import { resizeIgdbImage, type IgdbImageSize } from "../providers/igdb/image.ts";
import { rawgImage, type RawgImageWidth } from "../providers/rawg/image.ts";

export type GameImageWidth = RawgImageWidth;

const IGDB_PREFIX = "https://images.igdb.com/igdb/image/upload/";

const IGDB_SIZE: Record<GameImageWidth, IgdbImageSize> = {
  420: "screenshot_med", // 569x320
  640: "screenshot_med",
  1280: "720p",
};

export function gameImage(url: string | null | undefined, width: GameImageWidth | null): string[] {
  if (!url) return [];
  if (!url.startsWith(IGDB_PREFIX)) return rawgImage(url, width);
  if (width === null || url.includes("/t_cover_")) return [url];
  const sized = resizeIgdbImage(url, IGDB_SIZE[width]);
  return sized === url ? [url] : [sized, url];
}

/**
 * What a saved image URL shows: an IGDB portrait cover, or landscape art (every
 * RAWG image, and IGDB artwork and screenshots). Saved records keep one image,
 * and Nexa builds every IGDB URL itself, so the size in the path says which.
 */
export function gameImageKind(url: string | null | undefined): "cover" | "landscape" | null {
  if (!url) return null;
  return url.startsWith(IGDB_PREFIX) && url.includes("/t_cover_") ? "cover" : "landscape";
}

/**
 * Cover card sizes: IGDB's `cover_big` (264×352, fitted, ~25 KB) covers cards
 * up to ~300 device px; the 2x size (528×704, ~75 KB) only on 2x displays.
 * The stored URL comes last as the fallback. Other URLs are returned as is.
 */
export function coverImage(
  url: string | null | undefined,
  dpr: number = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1,
): string[] {
  if (!url) return [];
  if (!url.startsWith(IGDB_PREFIX) || dpr < 1.75) return [url];
  const sharp = resizeIgdbImage(url, "cover_big", true);
  return sharp === url ? [url] : [sharp, url];
}
