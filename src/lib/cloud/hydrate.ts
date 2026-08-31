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
import { primeSnapshots } from "./mirror";
import { enqueue, flush } from "./queue";
import {
  TABLE,
  rowToWatched,
  rowToWatching,
  rowToWatchlist,
  rowUpdatedAt,
  watchedToRow,
  watchingToRow,
  watchlistToRow,
  type Owner,
  type TierRow,
  type WatchingRow,
  type WatchlistRow,
} from "./rows";

const MIGRATED_PREFIX = "harbor.cloud.migrated.v1.";

function migrationKey(o: Owner): string {
  return `${MIGRATED_PREFIX}${o.userId}.${o.profileId}`;
}

function alreadyMigrated(o: Owner): boolean {
  try {
    return localStorage.getItem(migrationKey(o)) === "1";
  } catch {
    return false;
  }
}

function markMigrated(o: Owner): void {
  try {
    localStorage.setItem(migrationKey(o), "1");
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
  const [wlRows, cwRows, tierRows] = await Promise.all([
    pull<WatchlistRow>(TABLE.watchlist, o),
    pull<WatchingRow>(TABLE.watching, o),
    pull<TierRow>(TABLE.tiers, o),
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
      mediaId: e.id,
      row: watchlistToRow(o, e, now),
    });
  }
  for (const e of cw.uploads) {
    enqueue({
      op: "upsert",
      table: TABLE.watching,
      owner: o,
      mediaId: e.id,
      row: watchingToRow(o, e),
    });
  }
  for (const e of tiers.uploads) {
    enqueue({
      op: "upsert",
      table: TABLE.tiers,
      owner: o,
      mediaId: e.id,
      row: watchedToRow(o, e, now),
    });
  }

  markMigrated(o);
  void flush();
}
