/**
 * The stores that must follow the account but are not fields on `Settings`.
 *
 * The API keys a user types in (TMDB, MDBList, OpenSubtitles, every debrid
 * provider, the Trakt client id/secret) are fields on `Settings`, so the
 * settings blob already carries them. These are the ones that are not:
 *
 * - the trackers' OAuth sessions, one per-profile key each for Trakt, Simkl,
 *   AniList and MAL, plus one account-wide key for Letterboxd;
 * - `harbor.onboarding`, which records that the first-run wizard has been
 *   seen and which nudges were dismissed.
 *
 * wipePortableLocalData() clears all of them on sign-out like any other
 * `harbor.*` key, so without carrying them next to the blob a returning user
 * comes back with their API keys restored but signed out of every tracker and
 * facing the welcome wizard again.
 *
 * Matched by prefix rather than enumerated per profile: the tracker key names
 * embed the profile id that owns them, so a restore lands back on exactly the
 * profile that recorded it instead of leaking across the roster.
 */
const CARRIED_PREFIXES = [
  "harbor.trakt.session.v1",
  "harbor.simkl.session.v1",
  "harbor.anilist.session.v1",
  "harbor.mal.session.v1",
  "harbor.letterboxd.session.v1",
  "harbor.onboarding",
] as const;

export type SideStoreBundle = Record<string, string>;

function isCarriedKey(key: string): boolean {
  return CARRIED_PREFIXES.some((p) => key === p || key.startsWith(`${p}.`));
}

/** Snapshot every carried key currently on this device. */
export function collectSideStores(): SideStoreBundle {
  const out: SideStoreBundle = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !isCarriedKey(key)) continue;
      const value = localStorage.getItem(key);
      if (value != null) out[key] = value;
    }
  } catch {
    /* an unreadable store just means nothing to carry */
  }
  return out;
}

/** Stable JSON for the bundle, or null when there is nothing to store. */
export function serializeSideStores(bundle: SideStoreBundle): string | null {
  const keys = Object.keys(bundle).sort();
  if (keys.length === 0) return null;
  const ordered: SideStoreBundle = {};
  for (const k of keys) ordered[k] = bundle[k];
  return JSON.stringify(ordered);
}

/**
 * Write a pulled bundle back into the individual keys each store reads from.
 * Returns true when anything actually changed, so the caller knows to reset
 * the in-memory caches rather than resetting them on every sign-in.
 */
export function restoreSideStores(raw: string | null | undefined): boolean {
  if (!raw) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;

  let changed = false;
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    // Only keys this module owns: a bundle is remote data, and it must not be
    // able to write to arbitrary storage slots.
    if (typeof value !== "string" || !isCarriedKey(key)) continue;
    try {
      if (localStorage.getItem(key) === value) continue;
      localStorage.setItem(key, value);
      changed = true;
    } catch {
      /* a full disk must not abort the rest of the restore */
    }
  }
  return changed;
}
