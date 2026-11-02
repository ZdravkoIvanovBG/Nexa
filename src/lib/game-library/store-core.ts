// The Game Library's local truth. One blob per profile, from the start: the
// unscoped movie stores can show one profile's data to another during a switch,
// and this store has no shared "current" library for that to happen to.
//
// Storage and the clock are injected so this runs under `node --test`.
import {
  libraryKey,
  parseLibraryBlob,
  serializeLibraryBlob,
  type LibraryBlob,
} from "./backup-state.ts";
import { mergeLibrary } from "./merge.ts";
import { applyPatch, isEmptyPatch, type ChangeContext } from "./rules.ts";
import type { GameLibraryData, LibraryPatch } from "./types.ts";

export type GameStoreDeps = {
  read: (key: string) => string | null;
  /** Returns false when the disk is full. The change stays in memory. */
  write: (key: string, value: string) => boolean;
  remove: (key: string) => void;
  now: () => number;
  random: () => number;
  /** Device-invented placeholder profiles are replaced when the real roster arrives. */
  isPlaceholderProfile: (profileId: string) => boolean;
};

export type LibraryChange = (data: GameLibraryData, ctx: ChangeContext) => LibraryPatch;

export function createGameStore(deps: GameStoreDeps) {
  const loaded = new Map<string, LibraryBlob>();
  const subscribers = new Set<() => void>();

  function notify(): void {
    for (const subscriber of subscribers) subscriber();
  }

  function evict(profileId: string): void {
    loaded.delete(profileId);
    notify();
  }

  function forget(profileId: string): void {
    deps.remove(libraryKey(profileId));
    evict(profileId);
  }

  function load(profileId: string): LibraryBlob {
    let blob = loaded.get(profileId);
    if (!blob) {
      blob = parseLibraryBlob(deps.read(libraryKey(profileId)));
      loaded.set(profileId, blob);
    }
    return blob;
  }

  function commit(profileId: string, data: GameLibraryData, unsynced: boolean): void {
    const blob: LibraryBlob = {
      ...data,
      autoCreated: load(profileId).autoCreated || deps.isPlaceholderProfile(profileId),
      unsynced,
    };
    loaded.set(profileId, blob);
    const ok = deps.write(libraryKey(profileId), serializeLibraryBlob(blob));
    if (!ok) console.warn("[game-library] out of storage, holding changes in memory only");
    notify();
  }

  return {
    /** Stable between changes, so it can back useSyncExternalStore directly. */
    snapshot(profileId: string): GameLibraryData {
      return load(profileId);
    },

    isPlaceholderBlob(profileId: string): boolean {
      return load(profileId).autoCreated;
    },

    isUnsynced(profileId: string): boolean {
      return load(profileId).unsynced;
    },

    /** Only for when a hydrate and a drained queue prove the cloud has everything. */
    markSynced(profileId: string): void {
      const blob = load(profileId);
      if (blob.unsynced) commit(profileId, blob, false);
    },

    subscribe(listener: () => void): () => void {
      subscribers.add(listener);
      return () => {
        subscribers.delete(listener);
      };
    },

    /** Applies one change and returns the rows it touched. */
    apply(profileId: string, change: LibraryChange): LibraryPatch {
      const data = load(profileId);
      const patch = change(data, { now: deps.now(), random: deps.random });
      if (!isEmptyPatch(patch)) commit(profileId, applyPatch(data, patch), true);
      return patch;
    },

    /**
     * Folds a cloud pull in, returning what the cloud still needs. The library
     * is read here, not before the pull, so an edit made while the pull was in
     * flight is part of the merge.
     */
    merge(profileId: string, remote: GameLibraryData): LibraryPatch {
      const current = load(profileId);
      const result = mergeLibrary(current, remote, deps.now());
      const unsynced = current.unsynced || !isEmptyPatch(result.uploads);
      if (result.changed || unsynced !== current.unsynced) {
        commit(profileId, result.data, unsynced);
      }
      return result.uploads;
    },

    /**
     * Moves a replaced placeholder profile's games into a real profile. The
     * placeholder is passed as the local side so all of its rows get uploaded.
     */
    adopt(fromProfileId: string, toProfileId: string): LibraryPatch {
      const result = mergeLibrary(load(fromProfileId), load(toProfileId), deps.now());
      commit(toProfileId, result.data, true);
      forget(fromProfileId);
      return result.uploads;
    },

    forget,

    /** Drops what's in memory for a profile whose blob is already gone. */
    evict,
  };
}

export type GameStore = ReturnType<typeof createGameStore>;
