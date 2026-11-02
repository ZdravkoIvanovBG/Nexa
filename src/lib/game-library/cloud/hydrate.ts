// Reconciles this device with the cloud. Unlike the movie hydrate there is no
// first-run flag and the cloud never replaces local data: tombstones say what was
// deleted, so a row only this device has can only be one the cloud hasn't seen.
import type { GameLibraryData, LibraryPatch } from "../types.ts";
import { classifyCloudError, type CloudError, type DrainOutcome } from "./queue.ts";
import {
  GAME_TABLE,
  patchToOps,
  rowToEntry,
  rowToRecord,
  type GameLibraryRow,
  type GameOp,
  type GameOwner,
  type GameQueueRow,
  type GameTable,
} from "./rows.ts";

/** Below Supabase's default 1000-row cap, which truncates a pull without saying so. */
const PAGE_SIZE = 500;
const MAX_PAGES = 200;

export type PullPage = (
  table: GameTable,
  owner: GameOwner,
  from: number,
  to: number,
) => Promise<{ rows: unknown[]; error: CloudError | null }>;

async function pullTable(
  pull: PullPage,
  table: GameTable,
  owner: GameOwner,
): Promise<{ rows: unknown[]; error: CloudError | null }> {
  const rows: unknown[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await pull(table, owner, rows.length, rows.length + PAGE_SIZE - 1);
    if (result.error) return { rows, error: result.error };
    // Only an empty page ends the pull: the server may cap pages below PAGE_SIZE.
    if (result.rows.length === 0) break;
    rows.push(...result.rows);
  }
  return { rows, error: null };
}

export async function pullLibrary(
  pull: PullPage,
  owner: GameOwner,
): Promise<{ data: GameLibraryData; error: CloudError | null }> {
  const data: GameLibraryData = { records: {}, queue: {} };

  const library = await pullTable(pull, GAME_TABLE.library, owner);
  if (library.error) return { data, error: library.error };
  const queue = await pullTable(pull, GAME_TABLE.queue, owner);
  if (queue.error) return { data, error: queue.error };

  for (const row of library.rows) {
    const record = rowToRecord(row as GameLibraryRow);
    if (record) data.records[record.gameId] = record;
  }
  for (const row of queue.rows) {
    const entry = rowToEntry(row as GameQueueRow);
    if (entry) data.queue[entry.entryId] = entry;
  }
  return { data, error: null };
}

/**
 * Decides when a library may be recorded as safely in the cloud. Sign-out reads
 * that record before it wipes anything, so this errs towards "not yet". An empty
 * queue alone proves nothing, because a change made while the cloud was
 * unavailable was never queued. Only after a hydrate has compared both sides
 * does an empty queue mean the cloud has everything.
 */
export function createSyncTracker(
  latestStamp: (owner: GameOwner) => number,
  markSynced: (owner: GameOwner, stamp: number) => void,
) {
  const reconciled = new Map<string, GameOwner>();
  return {
    reconciled(owner: GameOwner): void {
      reconciled.set(`${owner.userId}|${owner.profileId}`, owner);
    },
    drained(): void {
      for (const owner of reconciled.values()) markSynced(owner, latestStamp(owner));
    },
    forget(profileId: string): void {
      for (const [key, owner] of reconciled) {
        if (owner.profileId === profileId) reconciled.delete(key);
      }
    },
  };
}

export type HydrateDeps = {
  owner: GameOwner;
  pull: PullPage;
  drain: () => Promise<DrainOutcome>;
  enqueue: (ops: readonly GameOp[]) => void;
  /** Folds the pull into the store, re-reading local state, and returns what to upload. */
  merge: (remote: GameLibraryData) => LibraryPatch;
  /** False once the profile has changed, so a late pull can't land on the wrong one. */
  isCurrent: () => boolean;
  markBlocked: () => void;
  /** Local and cloud now agree, apart from what's queued. */
  onReconciled: () => void;
};

export type HydrateOutcome = "synced" | "pending" | "stale" | "blocked" | "failed";

export async function hydrateGameLibrary(deps: HydrateDeps): Promise<HydrateOutcome> {
  const { owner } = deps;

  // Drained first so the pull sees this device's own recent edits. A failure
  // here is harmless: the merge is by stamp, so unsent edits stay ahead.
  await deps.drain().catch(() => "failed");
  if (!deps.isCurrent()) return "stale";

  const { data, error } = await pullLibrary(deps.pull, owner);
  if (!deps.isCurrent()) return "stale";
  if (error) {
    if (classifyCloudError(error) === "blocked") {
      deps.markBlocked();
      return "blocked";
    }
    console.warn("[game-library] could not pull from the cloud, keeping local data", error);
    return "failed";
  }

  const uploads = deps.merge(data);
  deps.enqueue(patchToOps(owner, uploads));
  deps.onReconciled();

  const outcome = await deps.drain();
  if (outcome === "blocked") return "blocked";
  return outcome === "drained" ? "synced" : "pending";
}
