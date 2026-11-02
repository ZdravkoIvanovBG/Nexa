// Conflict rules between this device and the cloud. Whichever side changed a
// group of fields last wins that group, so a newer local edit is never replaced
// by an older snapshot. A tie adopts the cloud copy and uploads nothing, which
// stops two devices re-uploading the same rows at each other.
//
// `game_library_merge` in the Supabase migration applies the same groups on the
// server. tests/fixtures/game-merge-cases.json is the shared table of cases.
import { ROOT_PARENT, nextStamp } from "./types.ts";
import type { GameLibraryData, GameRecord, LibraryPatch, QueueEntry } from "./types.ts";

const STATE_FIELDS = [
  "status",
  "startedAt",
  "completedAt",
  "progressEnabled",
  "progress",
  "stateAt",
] as const;
const NOTES_FIELDS = ["notes", "notesAt"] as const;
const TIER_FIELDS = ["tier", "tierPosition", "tierAt"] as const;

function copyFields<K extends keyof GameRecord>(
  target: GameRecord,
  source: GameRecord,
  fields: readonly K[],
): void {
  for (const field of fields) target[field] = source[field];
}

function earliest(a: number, b: number): number {
  return a > 0 && b > 0 ? Math.min(a, b) : a || b;
}

/** Fields of a record, newest group by group. `upload` means the cloud is behind. */
export function mergeRecord(
  local: GameRecord,
  remote: GameRecord,
): { merged: GameRecord; upload: boolean } {
  const merged: GameRecord = { ...remote };
  let upload = false;
  if (local.stateAt > remote.stateAt) {
    copyFields(merged, local, STATE_FIELDS);
    upload = true;
  }
  if (local.notesAt > remote.notesAt) {
    copyFields(merged, local, NOTES_FIELDS);
    upload = true;
  }
  if (local.tierAt > remote.tierAt) {
    copyFields(merged, local, TIER_FIELDS);
    upload = true;
  }
  merged.createdAt = earliest(local.createdAt, remote.createdAt);
  return { merged, upload };
}

export function mergeEntry(
  local: QueueEntry,
  remote: QueueEntry,
): { merged: QueueEntry; upload: boolean } {
  return local.updatedAt > remote.updatedAt
    ? { merged: local, upload: true }
    : { merged: remote, upload: false };
}

function sameRow<T extends object>(a: T, b: T): boolean {
  return JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
}

export type MergeResult = {
  data: GameLibraryData;
  /** Rows the cloud needs from this device. */
  uploads: LibraryPatch;
  /** Whether anything local changed, so the store can skip a pointless write. */
  changed: boolean;
};

/** Row by row, never a whole-store replace: a row only one side has is kept. */
export function mergeLibrary(
  local: GameLibraryData,
  remote: GameLibraryData,
  now: number,
): MergeResult {
  const records = { ...local.records };
  const queue = { ...local.queue };
  const uploadRecords = new Map<string, GameRecord>();
  const uploadQueue = new Map<string, QueueEntry>();
  let changed = false;

  for (const [id, row] of Object.entries(remote.records)) {
    const mine = local.records[id];
    if (!mine) {
      records[id] = row;
      changed = true;
      continue;
    }
    const { merged, upload } = mergeRecord(mine, row);
    if (upload) uploadRecords.set(id, merged);
    if (!sameRow(merged, mine)) changed = true;
    records[id] = merged;
  }
  for (const [id, row] of Object.entries(local.records)) {
    if (!remote.records[id]) uploadRecords.set(id, row);
  }

  for (const [id, row] of Object.entries(remote.queue)) {
    const mine = local.queue[id];
    if (!mine) {
      queue[id] = row;
      changed = true;
      continue;
    }
    const { merged, upload } = mergeEntry(mine, row);
    if (upload) uploadQueue.set(id, merged);
    if (!sameRow(merged, mine)) changed = true;
    queue[id] = merged;
  }
  for (const [id, row] of Object.entries(local.queue)) {
    if (!remote.queue[id]) uploadQueue.set(id, row);
  }

  // A game added on one device after another removed its collection would
  // otherwise sit live under a dead parent, where nothing can show it.
  for (const entry of Object.values(queue)) {
    if (entry.parentId === ROOT_PARENT || entry.deletedAt !== null) continue;
    const parent = queue[entry.parentId];
    if (!parent || parent.deletedAt === null || entry.updatedAt <= parent.updatedAt) continue;
    const revived = {
      ...parent,
      deletedAt: null,
      updatedAt: nextStamp(parent.updatedAt, now),
    };
    queue[parent.entryId] = revived;
    uploadQueue.set(parent.entryId, revived);
    changed = true;
  }

  return {
    data: { records, queue },
    uploads: { records: [...uploadRecords.values()], queue: [...uploadQueue.values()] },
    changed,
  };
}
