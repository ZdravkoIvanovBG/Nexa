// Conflict rules between this device and the cloud. Whichever side changed a
// group of fields last wins that group, so a newer local edit is never replaced
// by an older snapshot. A tie adopts the cloud copy and uploads nothing, which
// stops two devices re-uploading the same rows at each other.
//
// `game_library_merge` and `game_queue_merge` in the Supabase migration apply the
// same groups on the server. tests/fixtures/game-merge-cases.json is the shared
// table of cases.
import { ROOT_PARENT, nextStamp } from "./types.ts";
import type { GameLibraryData, GameRecord, LibraryPatch, QueueEntry } from "./types.ts";

type RecordStamp = "metaAt" | "stateAt" | "progressAt" | "notesAt" | "tierAt";

const RECORD_GROUPS: readonly { stamp: RecordStamp; fields: readonly (keyof GameRecord)[] }[] = [
  { stamp: "metaAt", fields: ["slug", "name", "released", "image", "metaAt"] },
  { stamp: "stateAt", fields: ["status", "startedAt", "completedAt", "stateAt"] },
  { stamp: "progressAt", fields: ["progressEnabled", "progress", "progressAt"] },
  { stamp: "notesAt", fields: ["notes", "notesAt"] },
  { stamp: "tierAt", fields: ["tier", "tierPosition", "tierAt"] },
];

function copyField<K extends keyof GameRecord>(
  target: GameRecord,
  source: GameRecord,
  field: K,
): void {
  target[field] = source[field];
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
  for (const { stamp, fields } of RECORD_GROUPS) {
    if (local[stamp] <= remote[stamp]) continue;
    for (const field of fields) copyField(merged, local, field);
    upload = true;
  }
  merged.createdAt = earliest(local.createdAt, remote.createdAt);
  return { merged, upload };
}

/** Where a row sits and whether it exists resolve separately, as in `game_queue_merge`. */
export function mergeEntry(
  local: QueueEntry,
  remote: QueueEntry,
): { merged: QueueEntry; upload: boolean } {
  const merged: QueueEntry = { ...remote };
  let upload = false;
  if (local.updatedAt > remote.updatedAt) {
    Object.assign(merged, local, { deletedAt: remote.deletedAt, liveAt: remote.liveAt });
    upload = true;
  }
  if (local.liveAt > remote.liveAt) {
    merged.deletedAt = local.deletedAt;
    merged.liveAt = local.liveAt;
    upload = true;
  }
  return { merged, upload };
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
  // otherwise sit live under a dead parent, where nothing can show it. Only a
  // real addition counts: reordering a member doesn't bring a collection back.
  for (const entry of Object.values(queue)) {
    if (entry.parentId === ROOT_PARENT || entry.deletedAt !== null) continue;
    const parent = queue[entry.parentId];
    if (!parent || parent.deletedAt === null || entry.liveAt <= parent.liveAt) continue;
    const revived = {
      ...parent,
      deletedAt: null,
      liveAt: nextStamp(parent.liveAt, now),
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
