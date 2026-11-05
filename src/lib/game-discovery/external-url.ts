/**
 * An outbound link that's safe to hand to the system browser: absolute http(s)
 * only, so provider data can never open javascript:, file: or app URLs.
 */
export function safeExternalUrl(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

const RAWG_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The game's page on its provider's own site: rawg.io for a RAWG game, the
 * igdb.com page IGDB reported (https, www.igdb.com only) for an IGDB game.
 * Null when there's no safe link.
 */
export function providerPageUrl(
  provider: "rawg" | "igdb",
  slug: string,
  providerUrl?: string | null,
): string | null {
  if (provider === "rawg") return RAWG_SLUG.test(slug) ? `https://rawg.io/games/${slug}` : null;
  const url = safeExternalUrl(providerUrl);
  if (!url) return null;
  const parsed = new URL(url);
  return parsed.protocol === "https:" && parsed.hostname === "www.igdb.com" ? url : null;
}
