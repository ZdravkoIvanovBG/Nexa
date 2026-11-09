import { useSyncExternalStore } from "react";
import { getProfilesState, useProfiles } from "@/lib/profiles";
import { gameStore, queueLibraryChange } from "./cloud/client.ts";
import { emptyNoteSafety, type NoteSafety } from "./note-drafts.ts";
import { isEmptyPatch } from "./rules.ts";
import { emptyLibrary } from "./sanitize.ts";
import type { LibraryChange } from "./store-core.ts";
import type { GameId, GameLibraryData, LibraryPatch } from "./types.ts";

const NO_LIBRARY = emptyLibrary();
const NO_NOTES = emptyNoteSafety();

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

/** This device's unsaved and replaced note versions for the active profile. */
export function useNoteSafety(): NoteSafety {
  const { activeId } = useProfiles();
  return useSyncExternalStore(gameStore.subscribe, () =>
    activeId ? gameStore.noteSafety(activeId) : NO_NOTES,
  );
}

/**
 * Saves a note typed in `profileId`. Refused once that profile is no longer the
 * active one, like an Undo: the draft written while typing stays with that
 * profile and is offered when it opens again, so nothing reaches another profile.
 */
export function saveGameNotes(
  profileId: string,
  gameId: GameId,
  text: string,
  baseAt: number,
): boolean {
  if (getProfilesState().activeId !== profileId) return false;
  const patch = gameStore.saveNotes(profileId, gameId, text, baseAt);
  if (!isEmptyPatch(patch)) queueLibraryChange(profileId, patch);
  return true;
}

/** Keeps typed text on this device until it is saved. Only for the profile it was typed in. */
export function draftGameNotes(profileId: string, gameId: GameId, text: string): void {
  // A profile deleted a moment ago has had its notes removed; don't recreate them.
  if (!getProfilesState().profiles.some((p) => p.id === profileId)) return;
  gameStore.setNoteDraft(profileId, gameId, text);
}

/** Makes the kept version the note; the replaced note is kept in its place. Active profile only. */
export function restoreGameNoteDraft(profileId: string, gameId: GameId): boolean {
  if (getProfilesState().activeId !== profileId) return false;
  const patch = gameStore.restoreNoteDraft(profileId, gameId);
  if (!isEmptyPatch(patch)) queueLibraryChange(profileId, patch);
  return true;
}

export function discardGameNoteDraft(profileId: string, gameId: GameId): void {
  gameStore.discardNoteDraft(profileId, gameId);
}
