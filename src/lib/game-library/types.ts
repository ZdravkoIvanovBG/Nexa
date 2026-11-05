// Personal Game Library records. Kept free of runtime imports from the app so
// these rules run under `node --test`.
import type { GameId, RawgGameId } from "../game-discovery/game-id.ts";
import type { GameRef } from "../game-discovery/types.ts";
import type { RankedTier } from "../tracking-tiers.ts";

/**
 * Provider-qualified identity: "rawg:N" or "igdb:N" (see game-id.ts). A record
 * keeps the id it was saved with forever; a future launcher or provider link
 * points at it, never replaces it.
 */
export type { GameId };

export type GameStatus = "playing" | "paused" | "completed" | "dropped";

/**
 * `null` means no decision: the game shows in Unranked only once Completed.
 * "unranked" is a deliberate placement and "hidden" a deliberate removal, so
 * Unranked never has to be written when a status changes.
 */
export type GameTier = RankedTier | "unranked" | "hidden";

/**
 * The one personal record for a game, whichever stage it is in. Each group of
 * fields has its own stamp, so a change to one can't overwrite another changed
 * on a different device: a status can't cost progress, and an edit from a device
 * with an old snapshot can't restore that snapshot. See merge.ts.
 */
export type GameRecord = GameRef & {
  gameId: GameId;
  /** Covers the snapshot fields from GameRef. */
  metaAt: number;

  status: GameStatus | null;
  startedAt: number | null;
  completedAt: number | null;
  stateAt: number;

  progressEnabled: boolean;
  /** 0–100, kept while tracking is switched off. */
  progress: number | null;
  progressAt: number;

  notes: string;
  notesAt: number;

  tier: GameTier | null;
  tierPosition: string | null;
  tierAt: number;

  createdAt: number;
};

export type QueueKind = "game" | "collection";

/**
 * A row in the play queue: a root entry, or a member of a collection. Ids are
 * deterministic, so the same game saved on two offline devices lands on one row.
 * Whether a row exists has its own stamp, separate from where it sits, so that
 * reordering on one device can't undo a removal made on another. Only adding,
 * removing and restoring change `liveAt`.
 */
export type QueueEntry = {
  entryId: string;
  /** ROOT_PARENT, or the owning collection's entryId. */
  parentId: string;
  kind: QueueKind;
  gameId: GameId | null;
  franchiseId: string | null;
  /** Collection name at save time; the catalog may rename or drop it later. */
  title: string;
  image: string | null;
  /** Catalog slugs already offered, so later catalog additions can be detected. */
  catalogSeen: string[];
  position: string;
  addedAt: number;
  updatedAt: number;
  deletedAt: number | null;
  liveAt: number;
};

export type GameLibraryData = {
  records: Record<string, GameRecord>;
  queue: Record<string, QueueEntry>;
};

/** The rows one change touched: what the store persists and queues for upload. */
export type LibraryPatch = { records: GameRecord[]; queue: QueueEntry[] };

export const ROOT_PARENT = "";

export const MAX_NOTES_LENGTH = 4000;

/** The id of a RAWG game. Only for RAWG numbers: other providers use gameIdOf. */
export function gameIdFor(rawgId: number): RawgGameId {
  return `rawg:${rawgId}`;
}

export function rootEntryId(gameId: GameId): string {
  return `g:${gameId}`;
}

export function collectionEntryId(franchiseId: string): string {
  return `c:${franchiseId}`;
}

export function memberEntryId(collectionId: string, gameId: GameId): string {
  return `${collectionId}|${gameId}`;
}

/**
 * Always later than the value it replaces, even when that value came from a
 * device whose clock runs ahead, so a newer edit can't lose to an older one.
 */
export function nextStamp(previous: number, now: number): number {
  return Math.max(now, previous + 1);
}
