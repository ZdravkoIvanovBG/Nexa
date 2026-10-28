import type { RawgGameDetail } from "./types.ts";

// RAWG answers a renamed or merged slug with HTTP 200 and
// `{ "redirect": true, "slug": "<canonical slug>" }` instead of the game.

/** The canonical slug a RAWG redirect body points to, or null if `raw` isn't a redirect. */
export function redirectTarget(raw: unknown, requested: string | number): string | null {
  if (!raw || typeof raw !== "object") return null;
  const body = raw as { redirect?: unknown; slug?: unknown };
  if (body.redirect !== true || typeof body.slug !== "string") return null;
  const slug = body.slug.trim();
  if (!slug || slug === String(requested)) return null;
  return slug;
}

/**
 * GET /games/{idOrSlug}, following a RAWG slug redirect at most once (one
 * extra request; never chained). Null when RAWG redirects again.
 */
export async function getGameDetailRaw(
  get: (path: string) => Promise<unknown>,
  idOrSlug: string | number,
): Promise<RawgGameDetail | null> {
  const first = await get(`/games/${encodeURIComponent(String(idOrSlug))}`);
  const target = redirectTarget(first, idOrSlug);
  if (!target) return first as RawgGameDetail;
  const second = await get(`/games/${encodeURIComponent(target)}`);
  return redirectTarget(second, target) ? null : (second as RawgGameDetail);
}
