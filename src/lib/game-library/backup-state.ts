// Storage names and the questions the app shell asks about game data, kept in a
// leaf module so App.tsx, profiles.tsx and session.tsx pay for none of the
// library. Everything else in the feature loads on demand.
import { emptyLibrary, maxStamp, sanitizeLibrary } from "./sanitize.ts";
import type { GameLibraryData } from "./types.ts";

type KeyValueStore = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;

const LIBRARY_PREFIX = "harbor.games.library.v1.";
const SYNCED_PREFIX = "harbor.cloud.games.synced.v1.";

/** `harbor.cloud.` keeps this device's queue out of backups and sign-out wipes. */
export const GAME_QUEUE_KEY = "harbor.cloud.games.queue.v1";

export function libraryKey(profileId: string): string {
  return `${LIBRARY_PREFIX}${profileId}`;
}

function syncedKey(userId: string, profileId: string): string {
  return `${SYNCED_PREFIX}${userId}.${profileId}`;
}

function keysWithPrefix(storage: KeyValueStore, prefix: string): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(prefix)) keys.push(key);
  }
  return keys;
}

export type LibraryBlob = GameLibraryData & { autoCreated: boolean };

export function parseLibraryBlob(raw: string | null): LibraryBlob {
  if (!raw) return { ...emptyLibrary(), autoCreated: false };
  try {
    const parsed = JSON.parse(raw) as { autoCreated?: unknown } | null;
    return { ...sanitizeLibrary(parsed), autoCreated: parsed?.autoCreated === true };
  } catch {
    return { ...emptyLibrary(), autoCreated: false };
  }
}

/** Profile ids that have a library on this device. */
export function libraryProfiles(storage: KeyValueStore = localStorage): string[] {
  return keysWithPrefix(storage, LIBRARY_PREFIX).map((key) => key.slice(LIBRARY_PREFIX.length));
}

type QueuedOp = { owner?: { userId?: string; profileId?: string } };

function readQueuedOps(storage: KeyValueStore): QueuedOp[] {
  try {
    const parsed = JSON.parse(storage.getItem(GAME_QUEUE_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? (parsed as QueuedOp[]) : [];
  } catch {
    return [];
  }
}

export function hasQueuedGameOps(storage: KeyValueStore = localStorage): boolean {
  try {
    return readQueuedOps(storage).length > 0;
  } catch {
    return false;
  }
}

/** Records that everything in this library up to `stamp` is known to be in the cloud. */
export function markGamesSynced(
  userId: string,
  profileId: string,
  stamp: number,
  storage: KeyValueStore = localStorage,
): void {
  try {
    storage.setItem(syncedKey(userId, profileId), String(stamp));
  } catch {
    /* non-fatal: worst case the next sign-out keeps local data instead of wiping it */
  }
}

/**
 * Whether signing out may wipe this device's game data. Asks what is on disk
 * rather than only what is queued: a change made while the cloud was unreachable
 * or the tables were missing is in no queue, and the wipe would destroy the only
 * copy. A device with no game data always passes, so nothing changes for anyone
 * who doesn't use the Game Library.
 */
export function gamesBackedUp(userId: string, storage: KeyValueStore = localStorage): boolean {
  try {
    if (readQueuedOps(storage).some((op) => op.owner?.userId === userId)) return false;
    for (const profileId of libraryProfiles(storage)) {
      const latest = maxStamp(parseLibraryBlob(storage.getItem(libraryKey(profileId))));
      if (latest === 0) continue;
      const synced = Number(storage.getItem(syncedKey(userId, profileId)) ?? 0);
      if (latest > synced) return false;
    }
    return true;
  } catch {
    return false;
  }
}

const forgetListeners = new Set<(profileId: string) => void>();

/** Lets a loaded store or queue drop what it holds in memory for a deleted profile. */
export function onGameProfileForgotten(listener: (profileId: string) => void): void {
  forgetListeners.add(listener);
}

/**
 * Removes a deleted profile's games from this device. Runs before the cloud
 * purge so a queued write can't recreate the rows the purge just removed.
 */
export function forgetGameProfile(profileId: string, storage: KeyValueStore = localStorage): void {
  try {
    storage.removeItem(libraryKey(profileId));
    for (const key of keysWithPrefix(storage, SYNCED_PREFIX)) {
      if (key.endsWith(`.${profileId}`)) storage.removeItem(key);
    }
    const ops = readQueuedOps(storage);
    const kept = ops.filter((op) => op.owner?.profileId !== profileId);
    if (kept.length !== ops.length) storage.setItem(GAME_QUEUE_KEY, JSON.stringify(kept));
  } catch {
    /* non-fatal: a stranded blob is inert once its profile is gone */
  }
  for (const listener of forgetListeners) listener(profileId);
}

/** Sends anything queued. Loads the sync code only when there is something to send. */
export async function flushGames(): Promise<void> {
  if (!hasQueuedGameOps()) return;
  const { gameQueue } = await import("./cloud/client.ts");
  await gameQueue.drain();
}
