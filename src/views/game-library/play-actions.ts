// What Currently Playing's buttons and menus do, wherever they appear: the tab,
// the Wishlist and a game's detail page. Every change goes through
// changeGameLibrary, so it is saved and queued for upload in one step, and
// writes only the state or progress group, so notes, rank and the Wishlist
// place of a game are never touched by a status change.
import { emitListToast } from "@/components/lists/list-toast";
import type { GameRef } from "@/lib/game-discovery/types";
import { libraryRef } from "@/lib/game-library/identity";
import {
  backToWishlist,
  beginPlaying,
  chainChanges,
  clearStatus,
  isEmptyPatch,
  playAgain,
  playStateOf,
  removeEntry,
  restoreState,
  setProgress,
  setProgressEnabled,
  setStatus,
  startGame,
  type ChangeContext,
  type PlayState,
} from "@/lib/game-library/rules";
import { activeGameProfile, changeGameLibrary } from "@/lib/game-library/store";
import type { GameId, GameLibraryData, LibraryPatch } from "@/lib/game-library/types";
import { requestPlayingGame, requestTab } from "./tab";
import { announce } from "./wishlist-actions";

type Translate = (key: string, vars?: Record<string, string | number>) => string;

type Change = (data: GameLibraryData, ctx: ChangeContext) => LibraryPatch;

/** Opens Currently Playing at this game, from inside the Game Library. */
export function showInPlaying(gameId: GameId): void {
  requestPlayingGame(gameId);
  requestTab("playing");
}

/** Runs a state change, returning what it replaced so it can be undone exactly. */
function changePlayState(
  gameId: GameId,
  change: Change,
): { previous: PlayState; patch: LibraryPatch } | null {
  let previous: PlayState | null = null;
  const patch = changeGameLibrary((data, ctx) => {
    const record = data.records[gameId];
    previous = record ? playStateOf(record) : null;
    return change(data, ctx);
  });
  if (!patch || !previous || isEmptyPatch(patch)) return null;
  return { previous, patch };
}

/**
 * Undo puts back the exact status and dates, and takes away a Wishlist row the
 * change added. Only on the profile the change was made in.
 */
function offerUndo(
  gameId: GameId,
  done: { previous: PlayState; patch: LibraryPatch },
  message: string,
  t: Translate,
): void {
  const profileId = activeGameProfile();
  if (!profileId) return;
  const added = done.patch.queue.filter((e) => e.deletedAt === null).map((e) => e.entryId);
  emitListToast(message, {
    label: t("Undo"),
    run: () => {
      const restored = changeGameLibrary(
        (data, ctx) =>
          chainChanges(data, ctx, [
            (d, c) => restoreState(d, gameId, done.previous, c),
            ...added.map((id) => (d: GameLibraryData, c: ChangeContext) => removeEntry(d, id, c)),
          ]),
        { profileId },
      );
      if (restored && !isEmptyPatch(restored)) announce(t("Restored"));
    },
  });
}

/**
 * Starts a game from a saved record or from Discovery. The ref goes through
 * libraryRef inside the change, so a game already saved from the other
 * provider is started on that record instead of gaining a second one.
 */
export function startPlaying(
  ref: GameRef,
  name: string,
  t: Translate,
  view: { label: string; run: () => void } | null = null,
): boolean {
  const patch = changeGameLibrary((data, ctx) => startGame(data, libraryRef(data, ref), ctx));
  if (!patch || isEmptyPatch(patch)) return false;
  const message = t("Started playing {name}", { name });
  announce(message);
  emitListToast(message, view ?? undefined);
  return true;
}

/** Starts a game already in the library, by its record. */
export function startRecord(gameId: GameId, name: string, t: Translate): boolean {
  const done = changePlayState(gameId, (data, ctx) => beginPlaying(data, gameId, ctx));
  if (!done) return false;
  const message = t("Started playing {name}", { name });
  announce(message);
  emitListToast(message, { label: t("View"), run: () => showInPlaying(gameId) });
  return true;
}

export function pauseGame(gameId: GameId, name: string, t: Translate): void {
  const done = changePlayState(gameId, (data, ctx) => setStatus(data, gameId, "paused", ctx));
  if (done) offerUndo(gameId, done, t("Paused {name}", { name }), t);
}

/** Back to Playing from Paused or Dropped: the same playthrough, so its start date stays. */
export function resumeGame(gameId: GameId, name: string, t: Translate): void {
  const done = changePlayState(gameId, (data, ctx) => setStatus(data, gameId, "playing", ctx));
  if (done) announce(t("Resumed {name}", { name }));
}

export function completeGame(gameId: GameId, name: string, t: Translate): void {
  const done = changePlayState(gameId, (data, ctx) => setStatus(data, gameId, "completed", ctx));
  if (done) offerUndo(gameId, done, t("Marked {name} as completed", { name }), t);
}

export function dropGame(gameId: GameId, name: string, t: Translate): void {
  const done = changePlayState(gameId, (data, ctx) => setStatus(data, gameId, "dropped", ctx));
  if (done) offerUndo(gameId, done, t("Dropped {name}", { name }), t);
}

/** A new playthrough of a completed game. */
export function replayGame(gameId: GameId, name: string, t: Translate): void {
  const done = changePlayState(gameId, (data, ctx) => playAgain(data, gameId, ctx));
  if (done) offerUndo(gameId, done, t("Playing {name} again", { name }), t);
}

/** Its Wishlist row comes back where it was, or one is added at the end if it had none. */
export function sendBackToWishlist(gameId: GameId, name: string, t: Translate): void {
  const done = changePlayState(gameId, (data, ctx) => backToWishlist(data, gameId, ctx));
  if (done) offerUndo(gameId, done, t("Moved {name} back to your Wishlist", { name }), t);
}

/** Only for a game on no list: the record and its notes stay for a later re-add. */
export function removeFromPlaying(gameId: GameId, name: string, t: Translate): void {
  const done = changePlayState(gameId, (data, ctx) => clearStatus(data, gameId, ctx));
  if (done) offerUndo(gameId, done, t("Removed {name} from Currently Playing", { name }), t);
}

export function setTracking(gameId: GameId, enabled: boolean): void {
  changeGameLibrary((data, ctx) => setProgressEnabled(data, gameId, enabled, ctx));
}

export function commitProgress(gameId: GameId, value: number): void {
  changeGameLibrary((data, ctx) => setProgress(data, gameId, value, ctx));
}
