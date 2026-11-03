// What the Wishlist's buttons, menus and keys do. Every change goes through
// changeGameLibrary, so it is saved and queued for upload in one step.
import { emitListToast } from "@/components/lists/list-toast";
import {
  moveEntry,
  moveToTop,
  playNext,
  removeEntry,
  restoreEntries,
  shiftEntry,
} from "@/lib/game-library/rules";
import { activeGameProfile, changeGameLibrary } from "@/lib/game-library/store";
import type { LibraryPatch } from "@/lib/game-library/types";

type Translate = (key: string, vars?: Record<string, string | number>) => string;

const ANNOUNCE = "harbor:game-library-announce";

/** Read out by the Wishlist's live region, for moves a screen reader can't see. */
export function announce(text: string): void {
  window.dispatchEvent(new CustomEvent<string>(ANNOUNCE, { detail: text }));
}

export function onAnnounce(listener: (text: string) => void): () => void {
  const handler = (e: Event) => listener((e as CustomEvent<string>).detail);
  window.addEventListener(ANNOUNCE, handler);
  return () => window.removeEventListener(ANNOUNCE, handler);
}

/**
 * Keeps keyboard focus on the row that moved, wherever React put it. A store
 * change renders before the next task, so a zero-delay timeout sees the new
 * order without waiting for a frame, which never comes in a hidden window.
 */
export function focusHandle(entryId: string): void {
  window.setTimeout(() => {
    const handle = document.querySelector<HTMLElement>(
      `[data-sort-handle="${CSS.escape(entryId)}"]`,
    );
    handle?.focus({ preventScroll: false });
  }, 0);
}

function moved(patch: LibraryPatch | null): boolean {
  return !!patch && patch.queue.length > 0;
}

export function moveTo(entryId: string, index: number): boolean {
  return moved(changeGameLibrary((data, ctx) => moveEntry(data, entryId, index, ctx)));
}

export function shift(entryId: string, delta: number): boolean {
  return moved(changeGameLibrary((data, ctx) => shiftEntry(data, entryId, delta, ctx)));
}

export function toTop(entryId: string): boolean {
  return moved(changeGameLibrary((data, ctx) => moveToTop(data, entryId, ctx)));
}

export function toNext(entryId: string): boolean {
  return moved(changeGameLibrary((data, ctx) => playNext(data, entryId, ctx)));
}

/**
 * Removes a game or a whole collection, with Undo. Undo restores exactly the
 * rows this removal took, and only on the profile they were taken from.
 */
export function removeWithUndo(entryId: string, message: string, t: Translate): void {
  const profileId = activeGameProfile();
  const patch = changeGameLibrary((data, ctx) => removeEntry(data, entryId, ctx));
  if (!patch || !profileId) return;
  const removed = patch.queue.filter((e) => e.deletedAt !== null).map((e) => e.entryId);
  if (removed.length === 0) return;
  emitListToast(message, {
    label: t("Undo"),
    run: () => {
      const restored = changeGameLibrary((data, ctx) => restoreEntries(data, removed, ctx), {
        profileId,
      });
      if (moved(restored)) announce(t("Restored"));
    },
  });
}
