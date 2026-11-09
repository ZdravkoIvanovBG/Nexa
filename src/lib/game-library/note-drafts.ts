// Keeps a personal note from being lost on this device. Never uploaded, and not
// a second sync: the synced note is still the record's `notes`. This only holds
// text that isn't in the library, so the user can choose to bring it back.
//
//   drafts   Text typed but not saved yet (the app closed or the profile changed
//            inside the autosave delay), or a version that another version
//            replaced: a newer note from another device over one typed here, or
//            text typed here over a note that arrived while typing.
//   pending  Notes saved here that the cloud hasn't confirmed, by their stamp.
//            A pull that brings a different, newer note for one of them means it
//            displaced this device's text, which becomes a draft.
//
// One value per profile, under a portable `harbor.` key, so it lives and dies
// with the profile's library: a sign-out or account switch wipes it (after
// holding it for the same account, see backup-state.ts), deleting the profile
// removes it, and adopting a placeholder profile moves it.
import { MAX_NOTES_LENGTH, type GameLibraryData } from "./types.ts";

export type NoteDraftReason = "unsaved" | "replaced";

export type NoteDraft = { text: string; at: number; reason: NoteDraftReason };

export type NoteSafety = {
  drafts: Record<string, NoteDraft>;
  pending: Record<string, number>;
};

export const NOTES_PREFIX = "harbor.games.notes.v1.";

export function noteSafetyKey(profileId: string): string {
  return `${NOTES_PREFIX}${profileId}`;
}

export function emptyNoteSafety(): NoteSafety {
  return { drafts: {}, pending: {} };
}

export function isEmptyNoteSafety(safety: NoteSafety): boolean {
  return Object.keys(safety.drafts).length === 0 && Object.keys(safety.pending).length === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function parseNoteSafety(raw: string | null): NoteSafety {
  const safety = emptyNoteSafety();
  if (!raw) return safety;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return safety;
    if (isRecord(parsed.drafts)) {
      for (const [gameId, draft] of Object.entries(parsed.drafts)) {
        if (!isRecord(draft) || typeof draft.text !== "string" || !finite(draft.at)) continue;
        const reason = draft.reason === "replaced" ? "replaced" : "unsaved";
        safety.drafts[gameId] = {
          text: draft.text.slice(0, MAX_NOTES_LENGTH),
          at: draft.at,
          reason,
        };
      }
    }
    if (isRecord(parsed.pending)) {
      for (const [gameId, at] of Object.entries(parsed.pending)) {
        if (finite(at)) safety.pending[gameId] = at;
      }
    }
  } catch {
    /* unreadable: nothing to offer */
  }
  return safety;
}

export function serializeNoteSafety(safety: NoteSafety): string {
  return JSON.stringify({ v: 1, ...safety });
}

/** Both sides combined, the newer draft for a game winning. */
export function mergeNoteSafety(a: NoteSafety, b: NoteSafety): NoteSafety {
  const drafts = { ...a.drafts };
  for (const [gameId, draft] of Object.entries(b.drafts)) {
    const mine = drafts[gameId];
    if (!mine || draft.at > mine.at) drafts[gameId] = draft;
  }
  const pending = { ...a.pending };
  for (const [gameId, at] of Object.entries(b.pending)) {
    pending[gameId] = Math.max(pending[gameId] ?? 0, at);
  }
  return { drafts, pending };
}

export function withDraft(safety: NoteSafety, gameId: string, draft: NoteDraft): NoteSafety {
  return {
    ...safety,
    drafts: {
      ...safety.drafts,
      [gameId]: { ...draft, text: draft.text.slice(0, MAX_NOTES_LENGTH) },
    },
  };
}

export function withoutDraft(safety: NoteSafety, gameId: string): NoteSafety {
  if (!(gameId in safety.drafts)) return safety;
  const drafts = { ...safety.drafts };
  delete drafts[gameId];
  return { ...safety, drafts };
}

/**
 * After a save: the typed text is in the library now, so its unsaved draft goes,
 * and the save waits for the cloud to confirm it. `notesAt` is null when the
 * save wrote nothing because the library already had this text.
 */
export function noteSaved(
  safety: NoteSafety,
  gameId: string,
  text: string,
  notesAt: number | null,
): NoteSafety {
  let next = safety;
  const draft = safety.drafts[gameId];
  if (draft?.reason === "unsaved" && draft.text === text.slice(0, MAX_NOTES_LENGTH)) {
    next = withoutDraft(next, gameId);
  }
  if (notesAt !== null) next = { ...next, pending: { ...next.pending, [gameId]: notesAt } };
  return next;
}

/**
 * Settles pending saves against a pull. A cloud note at least as new as this
 * device's save either is that save (confirmed) or replaced it, in which case
 * the replaced text is kept as a draft. The newer cloud note is never touched:
 * bringing the old text back is the user's choice.
 */
export function reconcileNotes(
  safety: NoteSafety,
  local: GameLibraryData,
  remote: GameLibraryData,
): NoteSafety {
  let next = safety;
  for (const [gameId, savedAt] of Object.entries(safety.pending)) {
    const mine = local.records[gameId];
    const theirs = remote.records[gameId];
    if (mine && (!theirs || theirs.notesAt < savedAt)) continue; // not uploaded yet
    const pending = { ...next.pending };
    delete pending[gameId];
    next = { ...next, pending };
    if (!mine || !theirs) continue;
    const displaced =
      mine.notesAt === savedAt && theirs.notes !== mine.notes && mine.notes.trim() !== "";
    const existing = next.drafts[gameId];
    if (displaced && (!existing || existing.at <= savedAt)) {
      next = withDraft(next, gameId, { text: mine.notes, at: savedAt, reason: "replaced" });
    }
  }
  return next;
}
