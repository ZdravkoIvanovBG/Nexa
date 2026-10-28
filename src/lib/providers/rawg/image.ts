// RAWG serves images from media.rawg.io and supports server-side resizing via
// /media/resize/<width>/-/<path>. That path is used by rawg.io itself but isn't
// documented, so callers always get the original URL as a fallback.

export type RawgImageWidth = 420 | 640 | 1280;

const MEDIA_RE = /^(https:\/\/media\.rawg\.io\/media\/)((?:games|screenshots)\/.+)$/;

/** [preferred, ...fallbacks]; empty when there is no image. */
export function rawgImage(url: string | null | undefined, width: RawgImageWidth | null): string[] {
  if (!url) return [];
  if (width === null) return [url];
  const match = MEDIA_RE.exec(url);
  if (!match) return [url];
  return [`${match[1]}resize/${width}/-/${match[2]}`, url];
}
