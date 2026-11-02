// Mapping between library rows and the Supabase columns. Every mapper writes
// every column: PostgREST upserts a batch using the union of its keys and turns
// a missing one into NULL, so a partial row would blank fields already stored.
import { sanitizeEntry, sanitizeRecord } from "../sanitize.ts";
import type {
  GameRecord,
  GameStatus,
  GameTier,
  LibraryPatch,
  QueueEntry,
  QueueKind,
} from "../types.ts";

export const GAME_TABLE = { library: "game_library", queue: "game_queue" } as const;

export type GameTable = (typeof GAME_TABLE)[keyof typeof GAME_TABLE];

export const GAME_TABLES: readonly GameTable[] = [GAME_TABLE.library, GAME_TABLE.queue];

export const GAME_CONFLICT: Record<GameTable, string> = {
  [GAME_TABLE.library]: "user_id,profile_id,game_id",
  [GAME_TABLE.queue]: "user_id,profile_id,entry_id",
};

/** Sorted by primary key, only so that pages of a pull can't overlap. */
export const GAME_PAGE_ORDER: Record<GameTable, string> = {
  [GAME_TABLE.library]: "game_id",
  [GAME_TABLE.queue]: "entry_id",
};

export type GameOwner = { userId: string; profileId: string };

export type GameLibraryRow = {
  user_id: string;
  profile_id: string;
  game_id: string;
  slug: string;
  name: string;
  released: string | null;
  image: string | null;
  status: GameStatus | null;
  started_at: number | null;
  completed_at: number | null;
  progress_enabled: boolean;
  progress: number | null;
  state_at: number;
  notes: string;
  notes_at: number;
  tier: GameTier | null;
  tier_position: string | null;
  tier_at: number;
  created_at: number;
};

export type GameQueueRow = {
  user_id: string;
  profile_id: string;
  entry_id: string;
  parent_id: string;
  kind: QueueKind;
  game_id: string | null;
  franchise_id: string | null;
  title: string;
  image: string | null;
  catalog_seen: string[];
  position: string;
  added_at: number;
  updated_at: number;
  deleted_at: number | null;
};

export type GameRow = GameLibraryRow | GameQueueRow;

export function recordToRow(o: GameOwner, r: GameRecord): GameLibraryRow {
  return {
    user_id: o.userId,
    profile_id: o.profileId,
    game_id: r.gameId,
    slug: r.slug,
    name: r.name,
    released: r.released,
    image: r.image,
    status: r.status,
    started_at: r.startedAt,
    completed_at: r.completedAt,
    progress_enabled: r.progressEnabled,
    progress: r.progress,
    state_at: r.stateAt,
    notes: r.notes,
    notes_at: r.notesAt,
    tier: r.tier,
    tier_position: r.tierPosition,
    tier_at: r.tierAt,
    created_at: r.createdAt,
  };
}

export function rowToRecord(row: GameLibraryRow): GameRecord | null {
  return sanitizeRecord({
    gameId: row.game_id,
    slug: row.slug,
    name: row.name,
    released: row.released,
    image: row.image,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    progressEnabled: row.progress_enabled,
    progress: row.progress,
    stateAt: row.state_at,
    notes: row.notes,
    notesAt: row.notes_at,
    tier: row.tier,
    tierPosition: row.tier_position,
    tierAt: row.tier_at,
    createdAt: row.created_at,
  });
}

export function entryToRow(o: GameOwner, e: QueueEntry): GameQueueRow {
  return {
    user_id: o.userId,
    profile_id: o.profileId,
    entry_id: e.entryId,
    parent_id: e.parentId,
    kind: e.kind,
    game_id: e.gameId,
    franchise_id: e.franchiseId,
    title: e.title,
    image: e.image,
    catalog_seen: e.catalogSeen,
    position: e.position,
    added_at: e.addedAt,
    updated_at: e.updatedAt,
    deleted_at: e.deletedAt,
  };
}

export function rowToEntry(row: GameQueueRow): QueueEntry | null {
  return sanitizeEntry({
    entryId: row.entry_id,
    parentId: row.parent_id,
    kind: row.kind,
    gameId: row.game_id,
    franchiseId: row.franchise_id,
    title: row.title,
    image: row.image,
    catalogSeen: row.catalog_seen,
    position: row.position,
    addedAt: row.added_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  });
}

export type GameOp = { table: GameTable; owner: GameOwner; key: string; row: GameRow };

export function patchToOps(owner: GameOwner, patch: LibraryPatch): GameOp[] {
  return [
    ...patch.records.map((record) => ({
      table: GAME_TABLE.library,
      owner,
      key: record.gameId,
      row: recordToRow(owner, record),
    })),
    ...patch.queue.map((entry) => ({
      table: GAME_TABLE.queue,
      owner,
      key: entry.entryId,
      row: entryToRow(owner, entry),
    })),
  ];
}
