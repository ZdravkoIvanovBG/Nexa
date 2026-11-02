// Storage names and the questions the app shell asks about game data, kept in a
// leaf module so App.tsx, profiles.tsx and session.tsx pay for none of the
// library. Everything else in the feature loads on demand.
import { mergeLibrary } from "./merge.ts";
import { emptyLibrary, sanitizeLibrary } from "./sanitize.ts";
import type { GameLibraryData } from "./types.ts";

type KeyValueStore = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;

const BLOB_VERSION = 1;
const LIBRARY_PREFIX = "harbor.games.library.v1.";

// `harbor.cloud.` keeps these out of backups and out of the sign-out wipe, and
// keeps them to this device.
const HELD_PREFIX = "harbor.cloud.games.held.v1.";
export const GAME_QUEUE_KEY = "harbor.cloud.games.queue.v1";

export function libraryKey(profileId: string): string {
  return `${LIBRARY_PREFIX}${profileId}`;
}

function heldKey(userId: string, profileId: string): string {
  return `${HELD_PREFIX}${userId}.${profileId}`;
}

function keysWithPrefix(storage: KeyValueStore, prefix: string): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(prefix)) keys.push(key);
  }
  return keys;
}

export type LibraryBlob = GameLibraryData & {
  autoCreated: boolean;
  /**
   * Written with every local change, in the same write, so a change can't exist
   * on disk without this saying so. Cleared only once a hydrate has compared both
   * sides and the queue has drained. Everything that could destroy local data
   * asks this, rather than comparing timestamps a wrong clock could fool.
   */
  unsynced: boolean;
};

export function serializeLibraryBlob(blob: LibraryBlob): string {
  return JSON.stringify({ v: BLOB_VERSION, ...blob });
}

export function parseLibraryBlob(raw: string | null): LibraryBlob {
  if (!raw) return { ...emptyLibrary(), autoCreated: false, unsynced: false };
  try {
    const parsed = JSON.parse(raw) as { autoCreated?: unknown; unsynced?: unknown } | null;
    return {
      ...sanitizeLibrary(parsed),
      autoCreated: parsed?.autoCreated === true,
      unsynced: parsed?.unsynced === true,
    };
  } catch {
    return { ...emptyLibrary(), autoCreated: false, unsynced: false };
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
    return libraryProfiles(storage).every(
      (profileId) => !parseLibraryBlob(storage.getItem(libraryKey(profileId))).unsynced,
    );
  } catch {
    return false;
  }
}

/**
 * Reads what a wipe is about to destroy that the cloud doesn't have yet, and
 * returns the step that stores it, to run once the wipe has freed the space.
 *
 * Local data has to be wiped when another account signs in, or that account
 * would adopt and upload it. Held copies are safe from that: they are filed under
 * the owner's account, the store never reads them, backups leave them out, and
 * only restoreHeldGames() for that same account brings them back.
 */
export function prepareGameHold(
  ownerId: string | null,
  storage: KeyValueStore = localStorage,
): () => void {
  const held = new Map<string, string>();
  if (ownerId) {
    try {
      for (const profileId of libraryProfiles(storage)) {
        const blob = parseLibraryBlob(storage.getItem(libraryKey(profileId)));
        if (!blob.unsynced) continue;
        const key = heldKey(ownerId, profileId);
        const earlier = parseLibraryBlob(storage.getItem(key));
        const { data } = mergeLibrary(blob, earlier, Date.now());
        held.set(
          key,
          serializeLibraryBlob({ ...data, autoCreated: blob.autoCreated, unsynced: true }),
        );
      }
    } catch (error) {
      console.error("[game-library] could not read unsynced games before a wipe", error);
    }
  }
  return () => {
    for (const [key, value] of held) {
      try {
        storage.setItem(key, value);
      } catch (error) {
        console.error("[game-library] could not hold unsynced games through a wipe", error);
      }
    }
  };
}

/**
 * Puts this account's held games back, newest field by newest field, before
 * anything reads them. Returns true if it did, because a store already in memory
 * would miss them and the caller has to reload. A copy is only removed once it
 * has been written back, so a failure here costs a retry rather than the data.
 */
export function restoreHeldGames(userId: string, storage: KeyValueStore = localStorage): boolean {
  const prefix = `${HELD_PREFIX}${userId}.`;
  let restored = false;
  for (const key of keysWithPrefix(storage, prefix)) {
    const profileId = key.slice(prefix.length);
    try {
      const held = parseLibraryBlob(storage.getItem(key));
      const current = parseLibraryBlob(storage.getItem(libraryKey(profileId)));
      const { data } = mergeLibrary(held, current, Date.now());
      const autoCreated = held.autoCreated || current.autoCreated;
      storage.setItem(
        libraryKey(profileId),
        serializeLibraryBlob({ ...data, autoCreated, unsynced: true }),
      );
      storage.removeItem(key);
      restored = true;
    } catch (error) {
      console.error("[game-library] could not restore held games", error);
    }
  }
  return restored;
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
    for (const key of keysWithPrefix(storage, HELD_PREFIX)) {
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
