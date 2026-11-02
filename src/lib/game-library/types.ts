// Personal Game Library records. Kept free of runtime imports from the app so
// these rules run under `node --test`.
import type { GameRef } from "../game-discovery/types.ts";
import type { RankedTier } from "../tracking-tiers.ts";

/** Provider-prefixed identity. A future launcher links to this, never replaces it. */
export type GameId = `rawg:${number}`;

export type GameStatus = "playing" | "paused" | "completed" | "dropped";

/**
 * `null` means no decision: the game shows in Unranked only once Completed.
 * "unranked" is a deliberate placement and "hidden" a deliberate removal, so
 * Unranked never has to be written when a status changes.
 */
export type GameTier = RankedTier | "unranked" | "hidden";

/**
 * The one personal record for a game, whichever stage it is in. Its fields are
 * split into groups, each with its own stamp, so editing notes on one device
 * cannot overwrite a status changed on another. See merge.ts.
 */
export type GameRecord = GameRef & {
  gameId: GameId;

  status: GameStatus | null;
  startedAt: number | null;
  completedAt: number | null;
  progressEnabled: boolean;
  /** 0–100, kept while tracking is switched off. */
  progress: number | null;
  stateAt: number;

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
};

export type GameLibraryData = {
  records: Record<string, GameRecord>;
  queue: Record<string, QueueEntry>;
};

/** The rows one change touched: what the store persists and queues for upload. */
export type LibraryPatch = { records: GameRecord[]; queue: QueueEntry[] };

export const ROOT_PARENT = "";

export const MAX_NOTES_LENGTH = 4000;

export function gameIdFor(rawgId: number): GameId {
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
