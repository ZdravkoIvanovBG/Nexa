import { useSyncExternalStore } from "react";
import { getProfilesState, useProfiles } from "@/lib/profiles";
import { gameStore, queueLibraryChange } from "./cloud/client.ts";
import { isEmptyPatch } from "./rules.ts";
import { emptyLibrary } from "./sanitize.ts";
import type { LibraryChange } from "./store-core.ts";
import type { GameLibraryData, LibraryPatch } from "./types.ts";

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
 * The only way to change a library. With no profile yet there is nowhere safe to
 * write, so the change is refused rather than filed under a placeholder.
 *
 * Saves and queues in one synchronous step on purpose. If the queue could drain
 * in between, the library would be marked synced with this change never sent,
 * and the next sign-out would wipe it.
 */
export function changeGameLibrary(change: LibraryChange): LibraryPatch | null {
  const { activeId } = getProfilesState();
  if (!activeId) return null;
  const patch = gameStore.apply(activeId, change);
  if (!isEmptyPatch(patch)) queueLibraryChange(activeId, patch);
  return patch;
}
