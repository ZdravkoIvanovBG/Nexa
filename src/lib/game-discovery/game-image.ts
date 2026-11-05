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
