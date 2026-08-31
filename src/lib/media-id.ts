/**
 * Which meta ids are safe to use as a cross-device key.
 *
 * Anything matching is stable and globally meaningful (IMDb, TMDB, or one of the
 * anime databases), so two devices that saw the same title agree on the id.
 * Addon-local ids are not, and must never reach a shared store.
 */
export const CLOUD_OK = /^(tt\d|kitsu:|mal:|anilist:|anidb:|tmdb:)/;

/** The id to write for `metaId`, preferring a verified IMDb resolution. Null when there is no shareable id. */
export function cloudWriteId(
  metaId: string,
  resolved: string | null,
  verified: boolean,
): string | null {
  if (metaId.startsWith("tt")) return metaId;
  if (verified && resolved && resolved.startsWith("tt")) return resolved;
  return CLOUD_OK.test(metaId) ? metaId : null;
}
