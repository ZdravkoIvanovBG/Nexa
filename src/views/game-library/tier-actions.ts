// What the Tier List's drag, keys and X do. Every change goes through
// changeGameLibrary. Ranking writes only the tier group, so it never touches a
// game's status, dates, notes, progress or Wishlist place; Remove also clears a
// completed game's status, as the movie Tier List does (removeFromTierList).
import { emitListToast } from "@/components/lists/list-toast";
import {
  addToBoard,
  applyPatch,
  chainChanges,
  boardDropIndex,
  boardPlace,
  boardTier,
  isEmptyPatch,
  moveToTier,
  playStateOf,
  removeFromTierList,
  restoreState,
  restoreTier,
  stepOnBoard,
  tierBoard,
  tierStateOf,
  type BoardStep,
  type ChangeContext,
  type PlayState,
  type TierState,
} from "@/lib/game-library/rules";
import { activeGameProfile, changeGameLibrary } from "@/lib/game-library/store";
import type { GameId, GameLibraryData, LibraryPatch } from "@/lib/game-library/types";
import type { Tier } from "@/lib/tracking-tiers";
import { requestTab, requestTierGame } from "./tab";
import { announce } from "./wishlist-actions";

type Translate = (key: string, vars?: Record<string, string | number>) => string;

export function tierName(t: Translate, tier: Tier): string {
  return tier === "unranked" ? t("Unranked") : tier;
}

/** Reads out where a game now sits, for screen readers and keyboard users. */
function announcePlace(t: Translate, data: GameLibraryData, gameId: GameId): void {
  const place = boardPlace(tierBoard(data), gameId);
  const record = data.records[gameId];
  if (!place || !record) return;
  announce(
    t("{name} moved to {tier}, position {n} of {total}", {
      name: record.name,
      tier: tierName(t, place.tier),
      n: place.index + 1,
      total: place.count,
    }),
  );
}

/** Keeps keyboard focus on the tile that moved, wherever React put it. */
export function focusTile(gameId: GameId): void {
  window.setTimeout(() => {
    document
      .querySelector<HTMLElement>(`[data-tile-handle="${CSS.escape(gameId)}"]`)
      ?.focus({ preventScroll: false });
  }, 0);
}

/** Runs a board change and reads out where the game landed. */
function move(
  gameId: GameId,
  t: Translate,
  change: (data: GameLibraryData, ctx: ChangeContext) => LibraryPatch,
): boolean {
  let before: GameLibraryData | null = null;
  const patch = changeGameLibrary((data, ctx) => {
    before = data;
    return change(data, ctx);
  });
  if (!patch || isEmptyPatch(patch) || !before) return false;
  announcePlace(t, applyPatch(before, patch), gameId);
  return true;
}

/** A drop at `slot` among the tier's other tiles. */
export function dropTile(gameId: GameId, tier: Tier, slot: number, t: Translate): boolean {
  return move(gameId, t, (data, ctx) =>
    moveToTier(data, gameId, tier, boardDropIndex(tierBoard(data), gameId, tier, slot), ctx),
  );
}

export function moveTileTo(gameId: GameId, tier: Tier, t: Translate): boolean {
  // To the end of the tier, after its placed tiles.
  return dropTile(gameId, tier, Number.MAX_SAFE_INTEGER, t);
}

export function stepTile(gameId: GameId, step: BoardStep, t: Translate): boolean {
  return move(gameId, t, (data, ctx) => stepOnBoard(data, gameId, step, ctx));
}

/** Whether a step would move the tile, for disabling menu items. */
export function canStep(data: GameLibraryData, gameId: GameId, step: BoardStep): boolean {
  return !isEmptyPatch(stepOnBoard(data, gameId, step, { now: Date.now() }));
}

/**
 * The X's Remove: off the board, and a completed game is no longer completed
 * (removeFromTierList). Notes, progress and the Wishlist place stay. Undo puts
 * back the exact status, dates, tier and position, in one write.
 */
export function removeTile(gameId: GameId, name: string, t: Translate): void {
  const profileId = activeGameProfile();
  let previous: { play: PlayState; tier: TierState } | null = null;
  const patch = changeGameLibrary((data, ctx) => {
    const record = data.records[gameId];
    previous = record ? { play: playStateOf(record), tier: tierStateOf(record) } : null;
    return removeFromTierList(data, gameId, ctx);
  });
  if (!patch || isEmptyPatch(patch) || !previous || !profileId) return;
  const before: { play: PlayState; tier: TierState } = previous;
  const message = t("Removed {name} from your Tier List", { name });
  announce(message);
  emitListToast(message, {
    label: t("Undo"),
    run: () => {
      const restored = changeGameLibrary(
        (data, ctx) =>
          chainChanges(data, ctx, [
            (d, c) => restoreState(d, gameId, before.play, c),
            (d, c) => restoreTier(d, gameId, before.tier, c),
          ]),
        { profileId },
      );
      if (restored && !isEmptyPatch(restored)) announce(t("Restored"));
    },
  });
}

/** Puts a saved game in Unranked, after any placed there. */
export function addTile(gameId: GameId, name: string, t: Translate): boolean {
  const patch = changeGameLibrary((data, ctx) => addToBoard(data, gameId, ctx));
  if (!patch || isEmptyPatch(patch)) return false;
  announce(t("Added {name} to Unranked", { name }));
  return true;
}

/** Opens the Tier List at this game. */
export function showInTiers(gameId: GameId): void {
  requestTierGame(gameId);
  requestTab("tiers");
}

/**
 * "Rank it" and "Add to Tier List": a game that isn't on the board joins
 * Unranked first, even one removed earlier on purpose, since this is a
 * deliberate request. Returns false when there's no such game.
 */
export function rankGame(
  data: GameLibraryData,
  gameId: GameId,
  name: string,
  t: Translate,
): boolean {
  const record = data.records[gameId];
  if (!record) return false;
  if (boardTier(record) === null) addTile(gameId, name, t);
  showInTiers(gameId);
  return true;
}

/** Adds without leaving the current page, with a way there. */
export function addToTierList(gameId: GameId, name: string, t: Translate, view: () => void): void {
  if (!addTile(gameId, name, t)) return;
  emitListToast(t("Added {name} to your Tier List", { name }), {
    label: t("View"),
    run: view,
  });
}
