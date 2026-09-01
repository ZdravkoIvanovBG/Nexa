import type { LocalEntry } from "@/lib/watchlist";
import type { WatchedEntry, WatchingEntry } from "@/lib/library-tracking";
import type { InstalledAddon } from "@/lib/addon-store";
import type { Profile } from "@/lib/profiles";
import { supabase } from "@/lib/supabase";
import { collectSideStores, serializeSideStores } from "./side-stores";
import {
  diffAddons,
  diffProfiles,
  diffWatched,
  diffWatching,
  diffWatchlist,
  type Delta,
} from "./diff";
import { enqueue, flush } from "./queue";
import {
  TABLE,
  addonToRow,
  profileToRow,
  settingsToRow,
  watchedToRow,
  watchingToRow,
  watchlistToRow,
  type AnyRow,
  type CloudTable,
  type Owner,
} from "./rows";

export type TrackingSnapshot = { watching: WatchingEntry[]; watched: WatchedEntry[] };

/**
 * The stores call into here from their single `write()` chokepoint, so every
 * action method (toggleWatchlist, setProgress, moveToTier, ...) syncs without
 * each one having to know the cloud exists.
 */
let owner: Owner | null = null;
let applyingRemote = false;
let prevWatchlist: LocalEntry[] = [];
let prevTracking: TrackingSnapshot = { watching: [], watched: [] };
let prevAddons: InstalledAddon[] = [];

// Profiles are the roster you pick a profileId *from* -- they sync at the
// account level (user_id only), independent of which profile is active on
// this device, so they get their own owner distinct from the one above.
let profilesUserId: string | null = null;
let prevProfiles: Profile[] = [];

// Settings ride the same account-level scope as profiles (armed/disarmed
// together), but are one JSON blob per (user_id, scope) rather than a roster,
// so they get their own baseline: `scope` is "" for the account's shared
// blob or a profile id for that profile's independent one.
//
// `primedSettingsScope` is the gate, not just a baseline. Settings are a
// single blob that overwrites, so the first push for a scope must wait until
// the hydrator has said what the cloud already holds for it: straight after a
// sign-out wipe the local blob is a blank default, and any stray setSettings
// (the background-image loader, the tray listener, a settings-file restore)
// would otherwise push that blank over the copy we are about to restore from.
let primedSettingsScope: string | null = null;
let prevSettingsBlob: string | null = null;
let prevSettingsExtras: string | null = null;

export function cloudSyncOwner(): Owner | null {
  return owner;
}

/** Arm mirroring for a user + profile. Snapshots are primed by the hydrator. */
export function beginCloudSync(next: Owner): void {
  owner = next;
}

/** Disarm on sign-out or profile switch. Local storage is left untouched. */
export function endCloudSync(): void {
  owner = null;
  prevWatchlist = [];
  prevTracking = { watching: [], watched: [] };
  prevAddons = [];
}

/** Arm profile-roster mirroring for a signed-in user. Primed by the hydrator. */
export function beginProfilesSync(userId: string): void {
  profilesUserId = userId;
}

/** Disarm on sign-out. Local storage is left untouched. */
export function endProfilesSync(): void {
  profilesUserId = null;
  prevProfiles = [];
  primedSettingsScope = null;
  prevSettingsBlob = null;
  prevSettingsExtras = null;
}

/**
 * Run a remote-driven store write without echoing it straight back up. Without
 * this, hydrating from the cloud would re-upload everything it just pulled.
 */
export function applyRemote<T>(fn: () => T): T {
  applyingRemote = true;
  try {
    return fn();
  } finally {
    applyingRemote = false;
  }
}

/** Seed the baselines so the first user edit diffs against reality, not empty. */
export function primeSnapshots(watchlist: LocalEntry[], tracking: TrackingSnapshot): void {
  prevWatchlist = watchlist.map((e) => ({ ...e }));
  prevTracking = {
    watching: tracking.watching.map((e) => ({ ...e })),
    watched: tracking.watched.map((e) => ({ ...e })),
  };
}

function push<T>(
  table: CloudTable,
  o: Owner,
  delta: Delta<T>,
  keyOf: (entry: T) => string,
  toRow: (entry: T) => AnyRow,
): void {
  for (const entry of delta.upserts) {
    enqueue({ op: "upsert", table, owner: o, key: keyOf(entry), row: toRow(entry) });
  }
  for (const key of delta.deletes) {
    enqueue({ op: "delete", table, owner: o, key });
  }
}

const byId = <T extends { id: string }>(e: T) => e.id;

export function mirrorWatchlist(next: LocalEntry[]): void {
  if (!owner || applyingRemote) return;
  const o = owner;
  const now = Date.now();
  const delta = diffWatchlist(prevWatchlist, next);
  prevWatchlist = next.map((e) => ({ ...e }));
  if (delta.upserts.length === 0 && delta.deletes.length === 0) return;
  push(TABLE.watchlist, o, delta, byId, (e) => watchlistToRow(o, e, now));
}

export function mirrorTracking(next: TrackingSnapshot): void {
  if (!owner || applyingRemote) return;
  const o = owner;
  const now = Date.now();
  const watching = diffWatching(prevTracking.watching, next.watching);
  const watched = diffWatched(prevTracking.watched, next.watched);
  prevTracking = {
    watching: next.watching.map((e) => ({ ...e })),
    watched: next.watched.map((e) => ({ ...e })),
  };
  push(TABLE.watching, o, watching, byId, (e) => watchingToRow(o, e));
  push(TABLE.tiers, o, watched, byId, (e) => watchedToRow(o, e, now));
}

/** Seed the addon baseline. Separate from primeSnapshots: addons hydrate on their own path. */
export function primeAddonSnapshot(list: InstalledAddon[]): void {
  prevAddons = list.map((a) => ({ ...a }));
}

/**
 * Called from saveInstalled(), the addon store's single writer, so install,
 * uninstall, reorder, enable/disable, seed and manifest backfill all sync.
 */
export function mirrorAddons(next: InstalledAddon[]): void {
  if (!owner || applyingRemote) return;
  const o = owner;
  const delta = diffAddons(prevAddons, next);
  prevAddons = next.map((a) => ({ ...a }));
  if (delta.upserts.length === 0 && delta.deletes.length === 0) return;
  push(
    TABLE.addons,
    o,
    delta,
    (a) => a.transportUrl,
    (a) => addonToRow(o, a, a.order ?? 0),
  );
}

/** Seed the profiles baseline. Separate from primeSnapshots: profiles hydrate on their own path. */
export function primeProfilesSnapshot(list: Profile[]): void {
  prevProfiles = list.map((p) => ({ ...p }));
}

/**
 * Called from profiles.tsx's single writer, so create, rename, re-avatar,
 * PIN changes, kid settings, and deletion all sync.
 */
export function mirrorProfiles(next: Profile[]): void {
  if (!profilesUserId || applyingRemote) return;
  const userId = profilesUserId;
  const delta = diffProfiles(prevProfiles, next);
  prevProfiles = next.map((p) => ({ ...p }));
  if (delta.upserts.length === 0 && delta.deletes.length === 0) return;
  push(
    TABLE.profiles,
    { userId, profileId: "" },
    delta,
    (p) => p.id,
    (p) => profileToRow(userId, p),
  );
}

/**
 * Open this scope for mirroring and seed its baseline. Only the hydrator
 * calls this: until it does, mirrorSettings/mirrorCredentials stay silent so
 * a blank post-wipe blob can never reach the cloud ahead of the pull.
 */
export function primeSettingsSnapshot(scope: string, blob: string, extras: string | null): void {
  primedSettingsScope = scope;
  prevSettingsBlob = blob;
  prevSettingsExtras = extras;
}

function pushSettingsRow(scope: string, blob: string, extras: string | null): void {
  const userId = profilesUserId;
  if (!userId) return;
  prevSettingsBlob = blob;
  prevSettingsExtras = extras;
  enqueue({
    op: "upsert",
    table: TABLE.settings,
    owner: { userId, profileId: scope },
    key: scope,
    row: settingsToRow(userId, scope, blob, extras, Date.now()),
  });
}

/**
 * Called from settings.tsx's single write chokepoint (the debounced persist
 * effect and switchProfile), so every settings change -- API keys included --
 * follows the user rather than living only in this device's localStorage.
 *
 * `scope` is "" for the account-wide shared blob or a profile id for that
 * profile's independent copy; see settings/profile-store.ts's sourceKeyFor.
 */
export function mirrorSettings(scope: string, blob: string): void {
  if (!profilesUserId || applyingRemote) return;
  if (primedSettingsScope !== scope) return;
  const extras = serializeSideStores(collectSideStores());
  if (blob === prevSettingsBlob && extras === prevSettingsExtras) return;
  pushSettingsRow(scope, blob, extras);
}

/**
 * Push the side stores on their own, for the changes that never touch
 * `Settings` -- connecting a tracker, finishing the onboarding wizard or
 * dismissing a nudge writes only that store's own localStorage key, so
 * nothing else would notice.
 */
export function mirrorSideStores(scope: string): void {
  if (!profilesUserId || applyingRemote) return;
  if (primedSettingsScope !== scope || prevSettingsBlob == null) return;
  const extras = serializeSideStores(collectSideStores());
  if (extras === prevSettingsExtras) return;
  pushSettingsRow(scope, prevSettingsBlob, extras);
}

/**
 * Remove everything a deleted profile owned in the cloud.
 *
 * The write queue deletes by explicit row key, and a profile you are not
 * signed into has no rows loaded locally to name -- so these go out as scoped
 * deletes instead. Best-effort by nature: a delete made offline leaves the
 * rows behind, where they are inert (nothing ever queries a profile_id that
 * is no longer in the roster) rather than wrong.
 */
export async function purgeProfileFromCloud(profileId: string): Promise<void> {
  const userId = profilesUserId;
  if (!userId || !profileId) return;
  for (const table of [
    TABLE.watchlist,
    TABLE.watching,
    TABLE.tiers,
    TABLE.addons,
    TABLE.settings,
  ]) {
    const { error } = await supabase
      .from(table)
      .delete()
      .eq("user_id", userId)
      .eq("profile_id", profileId);
    if (error) {
      console.warn(`[cloud] could not purge ${table} for the deleted profile`, error);
    }
  }
}

/** Push anything still queued, e.g. before the window closes. */
export function flushCloud(): Promise<void> {
  return flush();
}
