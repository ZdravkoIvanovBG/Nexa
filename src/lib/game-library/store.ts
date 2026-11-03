import { useSyncExternalStore } from "react";
import { getProfilesState, useProfiles } from "@/lib/profiles";
import { gameStore, queueLibraryChange } from "./cloud/client.ts";
import { isEmptyPatch } from "./rules.ts";
import { emptyLibrary } from "./sanitize.ts";
import type { LibraryChange } from "./store-core.ts";
import type { GameLibraryData, LibraryPatch } from "./types.ts";

const NO_LIBRARY = emptyLibrary();

export function activeGameProfile(): string | null {
  return getProfilesState().activeId;
}

/** The active profile's library. `ready` is false until a real profile exists. */
export function useGameLibrary(): { data: GameLibraryData; ready: boolean } {
  const { activeId } = useProfiles();
  const data = useSyncExternalStore(gameStore.subscribe, () =>
    activeId ? gameStore.snapshot(activeId) : NO_LIBRARY,
  );
  return { data, ready: activeId !== null };
}

/** Whether the active profile's latest change failed to save to this device. */
export function useGameLibraryUnsaved(): boolean {
  const { activeId } = useProfiles();
  return useSyncExternalStore(gameStore.subscribe, () =>
    activeId ? gameStore.isUnsaved(activeId) : false,
  );
}

/**
 * The only way to change a library. With no profile yet there is nowhere safe to
 * write, so the change is refused rather than filed under a placeholder.
 *
 * Saves and queues in one synchronous step on purpose. If the queue could drain
 * in between, the library would be marked synced with this change never sent,
 * and the next sign-out would wipe it.
 */
export function changeGameLibrary(
  change: LibraryChange,
  options: { profileId?: string } = {},
): LibraryPatch | null {
  const { activeId } = getProfilesState();
  if (!activeId) return null;
  // An Undo offered before a profile switch belongs to the earlier profile. Ids
  // are the same across profiles, so applying it here would edit the wrong one.
  if (options.profileId !== undefined && options.profileId !== activeId) return null;
  const patch = gameStore.apply(activeId, change);
  if (!isEmptyPatch(patch)) queueLibraryChange(activeId, patch);
  return patch;
}
