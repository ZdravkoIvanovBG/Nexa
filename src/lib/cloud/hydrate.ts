import {
  MAX_WATCHED,
  MAX_WATCHING,
  readTracking,
  replaceTracking,
  type WatchedEntry,
  type WatchingEntry,
} from "@/lib/library-tracking";
import { readLocalEntries, replaceWatchlist, type LocalEntry } from "@/lib/watchlist";
import { supabase } from "@/lib/supabase";
import { loadInstalled, replaceInstalled, type InstalledAddon } from "@/lib/addon-store";
import {
  ensureLocalProfile,
  isAutoCreatedProfile,
  loadProfiles,
  replaceProfiles,
  type Profile,
} from "@/lib/profiles";
import { markOnboarded, reloadOnboardingFromStorage, settleOnboarding } from "@/lib/onboarding";
import { MIRROR_KEY, profileKey, SHARED_KEY } from "@/lib/settings/profile-store";
import { collectSideStores, restoreSideStores, serializeSideStores } from "./side-stores";
import {
  primeAddonSnapshot,
  primeProfilesSnapshot,
  primeSettingsSnapshot,
  primeSnapshots,
} from "./mirror";
import { enqueue, flush } from "./queue";
import {
  TABLE,
  addonToRow,
  profileToRow,
  rowToAddon,
  rowToProfile,
  rowToWatched,
  rowToWatching,
  rowToWatchlist,
  rowUpdatedAt,
  settingsToRow,
  watchedToRow,
  watchingToRow,
  watchlistToRow,
  type Owner,
  type ProfileRow,
  type SettingsRow,
  type TierRow,
  type UserAddonRow,
  type WatchingRow,
  type WatchlistRow,
} from "./rows";

const MIGRATED_PREFIX = "harbor.cloud.migrated.v1.";

/**
 * Addons get their own gate, deliberately.
 *
 * Every already-signed-in user has the v1 flag set. Reusing it would make the
 * addon merge treat its very first run as "not first run", compute
 * keepLocalOnly = false, and drop every addon that is not yet in the cloud --
 * i.e. the user's entire addon list, on the first launch after this update.
 */
const ADDONS_MIGRATED_PREFIX = "harbor.cloud.addons.migrated.v1.";

function migrationKey(o: Owner, prefix = MIGRATED_PREFIX): string {
  return `${prefix}${o.userId}.${o.profileId}`;
}

function alreadyMigrated(o: Owner, prefix = MIGRATED_PREFIX): boolean {
  try {
    return localStorage.getItem(migrationKey(o, prefix)) === "1";
  } catch {
    return false;
  }
}

function markMigrated(o: Owner, prefix = MIGRATED_PREFIX): void {
  try {
    localStorage.setItem(migrationKey(o, prefix), "1");
  } catch {
    /* non-fatal: worst case the merge runs again and is idempotent */
  }
}

async function pull<T>(table: string, o: Owner): Promise<T[]> {
  const { data, error } = await supabase
    .from(table)
    .select("*")
    .eq("user_id", o.userId)
    .eq("profile_id", o.profileId);
  if (error) throw error;
  return (data ?? []) as T[];
}

/**
 * Merge one concern. Rows present on both sides resolve cloud-wins; local-only
 * rows survive and are queued for upload; cloud-only rows are adopted.
 */
function merge<E extends { id: string }, R>(
  local: E[],
  rows: R[],
  toEntry: (r: R) => E,
  localUpdatedAt: (e: E) => number,
  rowAt: (r: R) => number,
): { entries: E[]; uploads: E[] } {
  const byId = new Map<string, E>();
  for (const e of local) byId.set(e.id, e);

  const uploads: E[] = [];
  for (const r of rows) {
    const remote = toEntry(r);
    const mine = byId.get(remote.id);
    if (!mine) {
      byId.set(remote.id, remote);
      continue;
    }
    // Cloud wins on conflict, but a strictly newer local edit (made offline
    // since the last flush) is not thrown away.
    if (localUpdatedAt(mine) > rowAt(r)) uploads.push(mine);
    else byId.set(remote.id, remote);
  }

  const seen = new Set(rows.map((r) => toEntry(r).id));
  for (const e of local) if (!seen.has(e.id)) uploads.push(e);

  return { entries: Array.from(byId.values()), uploads };
}

/**
 * Pull the user's rows for this profile, merge them into the local stores, and
 * queue anything the cloud is missing. Primes the mirror snapshots so the next
 * user edit diffs against the merged truth.
 */
export async function hydrateFromCloud(o: Owner): Promise<void> {
  // Drain pending writes first, as the profile and settings hydrators do.
  // merge() weighs a local entry by finishedAt/addedAt, which re-ranking and
  // reordering never bump, so an un-flushed local edit would always lose to
  // the row's updated_at and be discarded.
  await flush().catch(() => {});
  const [wlRows, cwRows, tierRows, addonRows] = await Promise.all([
    pull<WatchlistRow>(TABLE.watchlist, o),
    pull<WatchingRow>(TABLE.watching, o),
    pull<TierRow>(TABLE.tiers, o),
    pull<UserAddonRow>(TABLE.addons, o),
  ]);

  const firstRun = !alreadyMigrated(o);
  const localWatchlist = readLocalEntries();
  const localTracking = readTracking();
  const now = Date.now();

  // On a device that has already merged once, local-only rows are stale
  // leftovers from another profile's session rather than un-uploaded edits.
  const keepLocalOnly = firstRun;

  const wl = merge<LocalEntry, WatchlistRow>(
    keepLocalOnly ? localWatchlist : [],
    wlRows,
    rowToWatchlist,
    (e) => e.addedAt,
    rowUpdatedAt,
  );
  const cw = merge<WatchingEntry, WatchingRow>(
    keepLocalOnly ? localTracking.watching : [],
    cwRows,
    rowToWatching,
    (e) => e.updatedAt,
    rowUpdatedAt,
  );
  const tiers = merge<WatchedEntry, TierRow>(
    keepLocalOnly ? localTracking.watched : [],
    tierRows,
    rowToWatched,
    (e) => e.finishedAt,
    rowUpdatedAt,
  );

  // The caps drop the oldest, never whatever the merge happened to order last.
  const nextWatchlist = wl.entries;
  const nextWatching = cw.entries.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_WATCHING);
  const nextWatched = tiers.entries
    .sort((a, b) => b.finishedAt - a.finishedAt)
    .slice(0, MAX_WATCHED);

  replaceWatchlist(nextWatchlist);
  replaceTracking({ watching: nextWatching, watched: nextWatched });
  primeSnapshots(nextWatchlist, { watching: nextWatching, watched: nextWatched });

  for (const e of wl.uploads) {
    enqueue({
      op: "upsert",
      table: TABLE.watchlist,
      owner: o,
      key: e.id,
      row: watchlistToRow(o, e, now),
    });
  }
  for (const e of cw.uploads) {
    enqueue({
      op: "upsert",
      table: TABLE.watching,
      owner: o,
      key: e.id,
      row: watchingToRow(o, e),
    });
  }
  for (const e of tiers.uploads) {
    enqueue({
      op: "upsert",
      table: TABLE.tiers,
      owner: o,
      key: e.id,
      row: watchedToRow(o, e, now),
    });
  }

  mergeAddons(o, addonRows, now);

  markMigrated(o);
  void flush();
}

/**
 * Addons merge local-first, with two deliberate divergences from the stores above.
 *
 * `keepLocalOnly` is always true: an addon missing from the cloud was most
 * likely installed while signed out or on a device that has not flushed, and it
 * can carry an unrecoverable secret (a debrid key baked into a Comet or
 * Torrentio URL). Uninstalling enqueues an explicit delete, so absence from the
 * cloud is never authoritative. The cost is that uninstalling on device A while
 * B is offline resurrects it on B -- the usual local-first tradeoff.
 */
function mergeAddons(o: Owner, rows: UserAddonRow[], now: number): void {
  const local = loadInstalled();
  const byUrl = new Map<string, InstalledAddon>();
  for (const a of local) byUrl.set(a.transportUrl, a);

  const uploads: InstalledAddon[] = [];
  const cloudOrder = new Map<string, number>();
  for (const r of rows) {
    cloudOrder.set(r.addon_url, r.order_index);
    const remote = rowToAddon(r);
    const mine = byUrl.get(r.addon_url);
    if (!mine) {
      byUrl.set(r.addon_url, remote);
      continue;
    }
    if ((mine.updatedAt ?? 0) > (remote.updatedAt ?? 0)) uploads.push(mine);
    else byUrl.set(r.addon_url, { ...remote, manifest: remote.manifest ?? mine.manifest });
  }

  const seen = new Set(rows.map((r) => r.addon_url));
  for (const a of local) if (!seen.has(a.transportUrl)) uploads.push(a);

  // Renumber densely so the two devices agree on a canonical sequence.
  const merged = Array.from(byUrl.values()).sort((a, b) => {
    const ca = cloudOrder.get(a.transportUrl);
    const cb = cloudOrder.get(b.transportUrl);
    if (ca != null && cb != null && ca !== cb) return ca - cb;
    if (ca != null && cb == null) return -1;
    if (ca == null && cb != null) return 1;
    const oa = a.order ?? 0;
    const ob = b.order ?? 0;
    if (oa !== ob) return oa - ob;
    return a.installedAt - b.installedAt;
  });

  const uploadUrls = new Set(uploads.map((a) => a.transportUrl));
  const next = merged.map((a, i) => {
    // Only a row whose order actually moved is re-uploaded, or two devices
    // ping-pong N upserts forever.
    if ((a.order ?? 0) !== i && !uploadUrls.has(a.transportUrl)) {
      uploadUrls.add(a.transportUrl);
      uploads.push(a);
    }
    return { ...a, order: i };
  });

  replaceInstalled(next);
  primeAddonSnapshot(next);

  const orderOf = new Map(next.map((a, i) => [a.transportUrl, i]));
  for (const a of uploads) {
    const i = orderOf.get(a.transportUrl);
    if (i == null) continue;
    enqueue({
      op: "upsert",
      table: TABLE.addons,
      owner: o,
      key: a.transportUrl,
      row: addonToRow(o, { ...a, order: i, updatedAt: a.updatedAt ?? now }, i),
    });
  }

  markMigrated(o, ADDONS_MIGRATED_PREFIX);
}

/**
 * Profiles get their own gate too, and it is keyed by user id alone.
 *
 * Unlike every other table, a profile row is not scoped by a profile_id --
 * profiles are the roster you pick a profile_id *from*. Pulling them has to
 * happen once per signed-in account, independent of which local profile
 * happens to be active on this device right now.
 */
const PROFILES_MIGRATED_PREFIX = "harbor.cloud.profiles.migrated.v1.";

function profilesAlreadyMigrated(userId: string): boolean {
  try {
    return localStorage.getItem(`${PROFILES_MIGRATED_PREFIX}${userId}`) === "1";
  } catch {
    return false;
  }
}

/**
 * Whether this device has completed at least one profile sync for the account,
 * i.e. whether the cloud is known to hold a copy of the roster. Sign-out reads
 * this before clearing local data, so a roster that never made it up (missing
 * table, RLS, offline) is not destroyed as the only copy.
 */
export function profilesSyncedFor(userId: string): boolean {
  return profilesAlreadyMigrated(userId);
}

function markProfilesMigrated(userId: string): void {
  try {
    localStorage.setItem(`${PROFILES_MIGRATED_PREFIX}${userId}`, "1");
  } catch {
    /* non-fatal: worst case the merge runs again and is idempotent */
  }
}

async function pullProfiles(userId: string): Promise<ProfileRow[]> {
  const { data, error } = await supabase.from(TABLE.profiles).select("*").eq("user_id", userId);
  if (error) throw error;
  return (data ?? []) as ProfileRow[];
}

/**
 * At most one profile may be `isPrimary`. isAutoCreatedProfile() above is now
 * the primary defense (provenance, not a name/avatar guess), so this is a
 * safety net rather than the main fix: if a rival local primary ever does
 * slip through -- a profile stored before the autoCreated flag existed and
 * personalised enough to dodge the legacy heuristic too, say -- it would
 * otherwise win the roster's `.find(isPrimary)` lookup ahead of the real one
 * (map insertion order puts local entries first), reset the active profile's
 * name, surface first-run UI on a login that should have adopted the
 * existing account, and get uploaded as a second primary.
 */
function enforceSinglePrimary(entries: Profile[], rows: ProfileRow[]): Profile[] {
  const primaries = entries.filter((p) => p.isPrimary);
  if (primaries.length <= 1) return entries;
  const cloudIds = new Set(rows.map((r) => r.id));
  const keep = primaries.find((p) => cloudIds.has(p.id)) ?? primaries[0];
  return entries.map((p) =>
    p.isPrimary && p.id !== keep.id ? { ...p, isPrimary: false, updatedAt: Date.now() } : p,
  );
}

/**
 * Pull the account's profile roster, merge it into the local list, and queue
 * anything the cloud is missing. On the very first sync, whatever profile(s)
 * exist locally (created before this account ever had a cloud roster, e.g. a
 * fresh device or the transient default created right after a local wipe)
 * become the account's roster and get uploaded. On every sync after that, the
 * cloud roster wins outright: a stray local profile is not a real edit worth
 * defending, it's what's left over from before this pull landed.
 */
export async function hydrateProfilesFromCloud(userId: string): Promise<void> {
  // Drain first, then pull. An edit made just before the last sign-out is
  // still queued; pulling ahead of it would hand us a stale server copy and
  // then overwrite the local one with it.
  await flush().catch(() => {});

  const rows = await pullProfiles(userId);
  const firstRun = !profilesAlreadyMigrated(userId);
  const stored = loadProfiles();
  // Once the account has a roster, a placeholder this device invented while
  // it had none is not an offline edit worth keeping -- drop it rather than
  // merging it in beside the real profiles (and uploading it forever).
  // isAutoCreatedProfile() checks provenance (the autoCreated flag) rather
  // than guessing from name/avatar, so a device-invented default that picked
  // up a Together display name or a settings avatar before sign-in is still
  // caught -- see makeDefaultPrimary() and the comment on enforceSinglePrimary
  // below for the bug this used to let through.
  const local = rows.length > 0 ? stored.filter((p) => !isAutoCreatedProfile(p)) : stored;

  const result = merge<Profile, ProfileRow>(
    firstRun ? local : [],
    rows,
    rowToProfile,
    (p) => p.updatedAt,
    rowUpdatedAt,
  );

  const entries = enforceSinglePrimary(result.entries, rows);
  // Reflect any demotion in what gets uploaded too, or the stale `isPrimary`
  // would round-trip straight back to the cloud as a second primary.
  const byId = new Map(entries.map((p) => [p.id, p]));
  const uploads = result.uploads.map((p) => byId.get(p.id) ?? p);

  // An account that already has a roster has been through setup before, on
  // this device or another one -- so a device that has never seen this
  // account skips the wizard rather than greeting a years-old account with
  // it. Either way the question is now answered, and the wizard can stop
  // holding.
  if (rows.length > 0) markOnboarded();
  else settleOnboarding();

  replaceProfiles(entries);
  primeProfilesSnapshot(entries);
  // Cloud had nothing and neither did we: this account has no roster yet, so
  // seed one now that waiting has been proven pointless. This is the ONLY
  // place `adopt: true` is used -- the pull above genuinely succeeded and
  // came back empty, so this really is the account's first profile, and it
  // mirrors rather than living only on this device.
  ensureLocalProfile({ adopt: true });

  for (const p of uploads) {
    enqueue({
      op: "upsert",
      table: TABLE.profiles,
      owner: { userId, profileId: "" },
      key: p.id,
      row: profileToRow(userId, p),
    });
  }

  markProfilesMigrated(userId);
  void flush();
}

// ── settings ────────────────────────────────────────────────────────────────
//
// Settings (including API keys) used to live only in plain `harbor.*`
// localStorage keys with no cloud copy at all -- signing out wiped them via
// wipePortableLocalData() the same as every other portable key, and signing
// back in had nothing to restore them from. They now sync as their own table,
// keyed by (user_id, scope) where scope is "" for the account's shared blob or
// a profile id for that profile's independent one -- see profile-store.ts.

/** Where a scope's blob lives on disk; the same key persistEffective writes. */
export function settingsStorageKey(scope: string): string {
  return scope === "" ? SHARED_KEY : profileKey(scope);
}

/** The blob this device currently holds for a scope, if any. */
export function readLocalSettingsBlob(scope: string): string | null {
  try {
    return localStorage.getItem(settingsStorageKey(scope));
  } catch {
    return null;
  }
}

async function pullSettings(userId: string, scope: string): Promise<SettingsRow | null> {
  const { data, error } = await supabase
    .from(TABLE.settings)
    .select("*")
    .eq("user_id", userId)
    .eq("profile_id", scope)
    .limit(1);
  if (error) throw error;
  return ((data?.[0] as SettingsRow | undefined) ?? null) as SettingsRow | null;
}

export type SettingsHydrateResult = { settings: boolean; sideStores: boolean };

/**
 * Pull this scope's settings blob plus its credential bundle and adopt them
 * locally, or -- if the cloud has nothing yet -- push the local copy up as the
 * seed. Priming the mirror snapshot at the end is what opens this scope for
 * mirroring, so nothing is ever pushed before we know what the cloud holds.
 *
 * Deliberately NOT gated on a "already migrated" flag. Those flags live under
 * `harbor.cloud.` and wipePortableLocalData() leaves them behind on sign-out,
 * so a gate here would make the second sign-in on a device skip the pull
 * entirely and leave every key blank -- which is exactly what it did. Every
 * other hydrator pulls unconditionally too; draining the queue first (below)
 * is what makes cloud-wins safe, since anything this device had pending is
 * already up there by the time the pull runs.
 *
 * Reports what changed so the caller can refresh the stores that already read
 * these keys at mount.
 */
export async function hydrateSettingsFromCloud(
  userId: string,
  scope: string,
): Promise<SettingsHydrateResult> {
  await flush().catch(() => {});

  const row = await pullSettings(userId, scope);
  const key = settingsStorageKey(scope);
  const result: SettingsHydrateResult = { settings: false, sideStores: false };

  if (row && typeof row.blob === "string" && row.blob.length > 0) {
    if (localStorage.getItem(key) !== row.blob) {
      localStorage.setItem(key, row.blob);
      // The mirror key is what a dozen modules read settings from directly
      // (downloads, the torrent engine, the updater, the adult filter...), so
      // it has to move with the source key or they keep reading the blank
      // copy until the next persistEffective happens to rewrite it.
      localStorage.setItem(MIRROR_KEY, row.blob);
      result.settings = true;
    }
    result.sideStores = restoreSideStores(row.extras);
    if (result.sideStores) reloadOnboardingFromStorage();
    primeSettingsSnapshot(scope, row.blob, row.extras ?? null);
    // A stored blob means this account was configured before. Rows written
    // before the side-store bundle existed carry no onboarding flag to
    // restore, so mark it here rather than relying on the bundle alone.
    markOnboarded();
  } else {
    const local = localStorage.getItem(key);
    const extras = serializeSideStores(collectSideStores());
    if (local != null) {
      enqueue({
        op: "upsert",
        table: TABLE.settings,
        owner: { userId, profileId: scope },
        key: scope,
        row: settingsToRow(userId, scope, local, extras, Date.now()),
      });
    }
    primeSettingsSnapshot(scope, local ?? "", extras);
  }

  void flush();
  return result;
}
