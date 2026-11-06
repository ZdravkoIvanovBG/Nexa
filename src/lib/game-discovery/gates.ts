import type { Settings } from "../settings/types.ts";
import type { GameProvider } from "./game-id.ts";
import type { IgdbStatusLike } from "./igdb-status.ts";

// Two independent gates:
//  - the feature gate is the user's preference and decides visibility;
//  - the request gate decides whether any request may be sent to the active
//    metadata provider (RAWG: a verified key; IGDB: verified device credentials).
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

/** Global search offers Games only when it's usable; kid profiles can't open Games at all. */
export function gamesSearchAvailable(
  gate: { featureEnabled: boolean; ready: boolean },
  isKid: boolean,
): boolean {
  return gate.featureEnabled && gate.ready && !isKid;
}

/** The enable toggle needs a ready key to turn on; turning off is always allowed. */
export function canToggleGames(
  settings: FeatureFields & KeyFields,
  isRejected: (fingerprint: string) => boolean,
): boolean {
  return gamesFeatureEnabled(settings) || rawgReady(settings, isRejected);
}

/** Why IGDB requests aren't allowed yet, or "ready". */
export type IgdbConfigState =
  | "ready"
  /** The first credential-store read hasn't finished. */
  | "igdb_checking"
  | "igdb_missing"
  | "igdb_unverified"
  | "igdb_rejected"
  /** No secure store here: the web build, or a platform without one. */
  | "igdb_unsupported"
  /** The credential store couldn't be opened. */
  | "igdb_unavailable";

/** Every not-ready state the Games frame can explain. */
export type GamesConfigState = Exclude<RawgConfigState | IgdbConfigState, "ready">;

/**
 * IGDB request readiness from the stored credential status. Only "verified"
 * credentials (verified with Twitch on this device) open the gate.
 */
export function igdbConfigState(
  status: IgdbStatusLike | null,
  nativeAvailable: boolean,
  /** The first status read failed: say so rather than "checking" forever. */
  readFailed = false,
): IgdbConfigState {
  if (!nativeAvailable) return "igdb_unsupported";
  if (!status) return readFailed ? "igdb_unavailable" : "igdb_checking";
  if (status.storage === "unsupported") return "igdb_unsupported";
  if (status.storage === "unavailable" || status.state === "unavailable") return "igdb_unavailable";
  switch (status.state) {
    case "verified":
      return "ready";
    case "configured":
      return "igdb_unverified";
    case "invalid":
      return "igdb_rejected";
    case "corrupted":
    case "not_configured":
      return "igdb_missing";
  }
}

/**
 * The Games toggle turns on only when the active provider is ready; turning
 * it off is always allowed.
 */
export function gamesToggleAllowed(enabled: boolean, activeReady: boolean): boolean {
  return enabled || activeReady;
}

/** Per-provider request readiness: RAWG has a verified key, IGDB has verified device credentials. */
export type GameProviderReadiness = Record<GameProvider, boolean>;

/**
 * Whether the active provider can serve Discovery requests. Only the active
 * provider counts, so verified IGDB credentials unlock nothing while RAWG is
 * active, and a RAWG key stops mattering while IGDB is.
 */
export function activeProviderReady(
  active: GameProvider,
  readiness: GameProviderReadiness,
): boolean {
  return readiness[active] === true;
}
