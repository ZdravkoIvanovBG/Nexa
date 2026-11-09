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
import {
  isEmptyNoteSafety,
  mergeNoteSafety,
  noteSafetyKey,
  noteSaved,
  parseNoteSafety,
  reconcileNotes,
  serializeNoteSafety,
  withDraft,
  withoutDraft,
  type NoteSafety,
} from "./note-drafts.ts";
import { applyPatch, isEmptyPatch, setNotes, type ChangeContext } from "./rules.ts";
import { MAX_NOTES_LENGTH, type GameId, type GameLibraryData, type LibraryPatch } from "./types.ts";

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
  const notes = new Map<string, NoteSafety>();
  const subscribers = new Set<() => void>();
  /** Profiles whose latest change exists only in memory, because the disk refused it. */
  const unsaved = new Set<string>();

  function notify(): void {
    for (const subscriber of subscribers) subscriber();
  }

  function evict(profileId: string): void {
    loaded.delete(profileId);
    notes.delete(profileId);
    unsaved.delete(profileId);
    notify();
  }

  function forget(profileId: string): void {
    deps.remove(libraryKey(profileId));
    deps.remove(noteSafetyKey(profileId));
    evict(profileId);
  }

  function loadNotes(profileId: string): NoteSafety {
    let safety = notes.get(profileId);
    if (!safety) {
      safety = parseNoteSafety(deps.read(noteSafetyKey(profileId)));
      notes.set(profileId, safety);
    }
    return safety;
  }

  /** Best effort: a draft that can't be written still shows until restart. */
  function commitNotes(profileId: string, safety: NoteSafety): void {
    if (safety === loadNotes(profileId)) return;
    notes.set(profileId, safety);
    if (isEmptyNoteSafety(safety)) deps.remove(noteSafetyKey(profileId));
    else deps.write(noteSafetyKey(profileId), serializeNoteSafety(safety));
    notify();
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
    if (ok) {
      unsaved.delete(profileId);
    } else {
      unsaved.add(profileId);
      console.warn("[game-library] out of storage, holding changes in memory only");
    }
    notify();
  }

  function apply(profileId: string, change: LibraryChange): LibraryPatch {
    const data = load(profileId);
    const patch = change(data, { now: deps.now(), random: deps.random });
    if (!isEmptyPatch(patch)) commit(profileId, applyPatch(data, patch), true);
    return patch;
  }

  return {
    /** Stable between changes, so it can back useSyncExternalStore directly. */
    snapshot(profileId: string): GameLibraryData {
      return load(profileId);
    },

    isPlaceholderBlob(profileId: string): boolean {
      return load(profileId).autoCreated;
    },

    /**
     * The disk refused the last write, so recent changes would be lost on close
     * unless they reach the cloud first. Clears with the next successful write.
     */
    isUnsaved(profileId: string): boolean {
      return unsaved.has(profileId);
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
    apply,

    /** This device's unsaved and replaced note versions. Stable between changes. */
    noteSafety(profileId: string): NoteSafety {
      return loadNotes(profileId);
    },

    /** Called as the user types, so text survives a close inside the autosave delay. */
    setNoteDraft(profileId: string, gameId: GameId, text: string): void {
      const record = load(profileId).records[gameId];
      const safety = loadNotes(profileId);
      const capped = text.slice(0, MAX_NOTES_LENGTH);
      if (record && record.notes === capped) {
        if (safety.drafts[gameId]?.reason === "unsaved") {
          commitNotes(profileId, withoutDraft(safety, gameId));
        }
        return;
      }
      commitNotes(
        profileId,
        withDraft(safety, gameId, { text: capped, at: deps.now(), reason: "unsaved" }),
      );
    },

    /**
     * Makes a kept version the note, by the user's choice. The note it replaces
     * becomes the kept version in turn, so choosing is never a loss: the user can
     * swap back, or discard whichever they don't want.
     */
    restoreNoteDraft(profileId: string, gameId: GameId): LibraryPatch {
      const record = load(profileId).records[gameId];
      const draft = loadNotes(profileId).drafts[gameId];
      if (!record || !draft) return { records: [], queue: [] };
      const patch = apply(profileId, (data, ctx) => setNotes(data, gameId, draft.text, ctx));
      let safety = withoutDraft(loadNotes(profileId), gameId);
      if (record.notes.trim() !== "" && record.notes !== draft.text) {
        safety = withDraft(safety, gameId, {
          text: record.notes,
          at: record.notesAt,
          reason: "replaced",
        });
      }
      const saved = load(profileId).records[gameId];
      if (patch.records.length > 0 && saved) {
        safety = { ...safety, pending: { ...safety.pending, [gameId]: saved.notesAt } };
      }
      commitNotes(profileId, safety);
      return patch;
    },

    discardNoteDraft(profileId: string, gameId: GameId): void {
      commitNotes(profileId, withoutDraft(loadNotes(profileId), gameId));
    },

    /**
     * Saves typed note text. `baseAt` is the note's stamp when the editor last
     * matched the library. If another version arrived since (a sync while typing),
     * the typed text still wins, as the user's latest intent, but the version it
     * replaces is kept as a draft rather than silently lost.
     */
    saveNotes(profileId: string, gameId: GameId, text: string, baseAt: number): LibraryPatch {
      const before = load(profileId).records[gameId];
      const capped = text.slice(0, MAX_NOTES_LENGTH);
      const patch = apply(profileId, (data, ctx) => setNotes(data, gameId, capped, ctx));
      let safety = loadNotes(profileId);
      const wrote = patch.records.length > 0;
      if (
        wrote &&
        before &&
        before.notesAt !== baseAt &&
        before.notes !== capped &&
        before.notes.trim() !== ""
      ) {
        safety = withDraft(safety, gameId, {
          text: before.notes,
          at: before.notesAt,
          reason: "replaced",
        });
      }
      const saved = load(profileId).records[gameId];
      safety = noteSaved(safety, gameId, capped, wrote && saved ? saved.notesAt : null);
      commitNotes(profileId, safety);
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
      const safety = loadNotes(profileId);
      if (Object.keys(safety.pending).length > 0) {
        commitNotes(profileId, reconcileNotes(safety, current, remote));
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
      // Unsaved and replaced note versions go with the games they belong to.
      const moved = mergeNoteSafety(loadNotes(toProfileId), loadNotes(fromProfileId));
      if (!isEmptyNoteSafety(moved)) commitNotes(toProfileId, moved);
      forget(fromProfileId);
      return result.uploads;
    },

    forget,

    /** Drops what's in memory for a profile whose blob is already gone. */
    evict,
  };
}

export type GameStore = ReturnType<typeof createGameStore>;
