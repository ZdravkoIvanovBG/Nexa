import { useSyncExternalStore } from "react";
import { getProfilesState, loadProfiles, useProfiles } from "@/lib/profiles";
import { freeStorageSpace, setItemWithRecovery } from "@/lib/storage-recovery";
import { onGameProfileForgotten } from "./backup-state.ts";
import { isEmptyPatch } from "./rules.ts";
import { emptyLibrary } from "./sanitize.ts";
import { createGameStore, type LibraryChange } from "./store-core.ts";
import type { GameLibraryData, LibraryPatch } from "./types.ts";

function persist(key: string, value: string): boolean {
  try {
    if (setItemWithRecovery(key, value)) return true;
    freeStorageSpace();
    return setItemWithRecovery(key, value);
  } catch {
    return false;
  }
}

export const gameStore = createGameStore({
  read: (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  write: persist,
  remove: (key) => {
    try {
      localStorage.removeItem(key);
    } catch {
      /* a stranded blob is inert once its profile is gone */
    }
  },
  now: Date.now,
  random: Math.random,
  isPlaceholderProfile: (profileId) =>
    loadProfiles().find((p) => p.id === profileId)?.autoCreated === true,
});

// Covers a profile deleted before the sync code has loaded.
onGameProfileForgotten((profileId) => gameStore.evict(profileId));

const NO_LIBRARY = emptyLibrary();

/** The active profile's library. `ready` is false until a real profile exists. */
export function useGameLibrary(): { data: GameLibraryData; ready: boolean } {
  const { activeId } = useProfiles();
  const data = useSyncExternalStore(gameStore.subscribe, () =>
    activeId ? gameStore.snapshot(activeId) : NO_LIBRARY,
  );
  return { data, ready: activeId !== null };
}

/**
 * Applies a change to the active profile's library, then hands the rows to the
 * upload queue. With no profile yet there is nowhere safe to write, so the
 * change is refused rather than filed under a placeholder. If the queue can't
 * load, the rows stay ahead by stamp and the next hydrate sends them.
 */
export function changeGameLibrary(change: LibraryChange): LibraryPatch | null {
  const { activeId } = getProfilesState();
  if (!activeId) return null;
  const patch = gameStore.apply(activeId, change);
  if (!isEmptyPatch(patch)) {
    void import("./cloud/client.ts")
      .then(({ queueLibraryChange }) => queueLibraryChange(activeId, patch))
      .catch(() => {});
  }
  return patch;
}
