import type { Settings } from "../settings/types.ts";

// Two independent gates:
//  - the feature gate is the user's preference and decides visibility;
//  - the request gate decides whether any RAWG request may be sent.
// Once Games is on it stays visible through key removal, rejection or RAWG
// outages, so Nexa-owned data (the future Game Library) is never hidden by them.

type FeatureFields = Pick<Settings, "gamesEnabled">;
type KeyFields = Pick<Settings, "rawgApiKey" | "rawgKeyVerifiedFor">;

export type RawgConfigState = "ready" | "missing_key" | "unverified" | "rejected";

/**
 * Non-cryptographic 53-bit hash (cyrb53) of the trimmed key. Used only to tell
 * whether the stored verification belongs to the current key; it reveals
 * nothing the key stored beside it doesn't already.
 */
export function keyFingerprint(key: string): string {
  const value = key.trim();
  if (!value) return "";
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < value.length; i++) {
    const ch = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hash = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return hash.toString(16).padStart(14, "0");
}

export function gamesFeatureEnabled(settings: FeatureFields): boolean {
  return settings.gamesEnabled === true;
}

export function rawgConfigState(
  settings: KeyFields,
  isRejected: (fingerprint: string) => boolean,
): RawgConfigState {
  const fingerprint = keyFingerprint(settings.rawgApiKey ?? "");
  if (!fingerprint) return "missing_key";
  // Checked before verification: a rejected key's verification is cleared, and
  // the user should still see why for the rest of the session.
  if (isRejected(fingerprint)) return "rejected";
  if (settings.rawgKeyVerifiedFor !== fingerprint) return "unverified";
  return "ready";
}

export function rawgReady(
  settings: KeyFields,
  isRejected: (fingerprint: string) => boolean,
): boolean {
  return rawgConfigState(settings, isRejected) === "ready";
}

/** The enable toggle needs a ready key to turn on; turning off is always allowed. */
export function canToggleGames(
  settings: FeatureFields & KeyFields,
  isRejected: (fingerprint: string) => boolean,
): boolean {
  return gamesFeatureEnabled(settings) || rawgReady(settings, isRejected);
}
