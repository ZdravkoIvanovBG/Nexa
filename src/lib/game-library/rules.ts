// What the Game Library means: which stage a game is in, what each view shows,
// and what every change writes. Pure, like tier-order.ts, so these rules run
// under `node --test`. Changes return a LibraryPatch of the rows they touched,
// which is all the store needs to persist them and queue them for upload.
import type { GameRef } from "../game-discovery/types.ts";
import { ALL_TIERS, type Tier } from "../tracking-tiers.ts";
import { compareRank, keyBetween, placeAt, spreadKeys, type Ranked } from "./rank-key.ts";
import {
  MAX_NOTES_LENGTH,
  ROOT_PARENT,
  collectionEntryId,
  gameIdFor,
  memberEntryId,
  nextStamp,
  rootEntryId,
  type GameId,
  type GameLibraryData,
  type GameRecord,
  type GameStatus,
  type LibraryPatch,
  type QueueEntry,
} from "./types.ts";

export type ChangeContext = { now: number; random?: () => number };

export type CollectionDef = { franchiseId: string; title: string; image: string | null };

export type CollectionMember = { entry: QueueEntry; record: GameRecord };

export type CollectionSummary = {
  members: CollectionMember[];
  completed: number;
  nextUp: GameRecord | null;
};

export type WishlistItem =
  | { kind: "game"; rank: number; entry: QueueEntry; record: GameRecord }
  | ({ kind: "collection"; rank: number; entry: QueueEntry } & CollectionSummary);

export type GameStage = "none" | "wishlist" | "collection" | GameStatus;

export type BoardTile = { record: GameRecord; notCompleted: boolean };

function emptyPatch(): LibraryPatch {
  return { records: [], queue: [] };
}

export function isEmptyPatch(patch: LibraryPatch): boolean {
  return patch.records.length === 0 && patch.queue.length === 0;
}

export function applyPatch(data: GameLibraryData, patch: LibraryPatch): GameLibraryData {
  const records = { ...data.records };
  const queue = { ...data.queue };
  for (const record of patch.records) records[record.gameId] = record;
  for (const entry of patch.queue) queue[entry.entryId] = entry;
  return { records, queue };
}

export function newRecord(ref: GameRef, now: number): GameRecord {
  return {
    ...ref,
    gameId: gameIdFor(ref.rawgId),
    metaAt: now,
    status: null,
    startedAt: null,
    completedAt: null,
    stateAt: 0,
    progressEnabled: false,
    progress: null,
    progressAt: 0,
    notes: "",
    notesAt: 0,
    tier: null,
    tierPosition: null,
    tierAt: 0,
    createdAt: now,
  };
}

function rankedEntry(entry: QueueEntry): Ranked {
  return { id: entry.entryId, position: entry.position };
}

function byQueueRank(a: QueueEntry, b: QueueEntry): number {
  return compareRank(rankedEntry(a), rankedEntry(b));
}

function childrenOf(data: GameLibraryData, parentId: string): QueueEntry[] {
  return Object.values(data.queue)
    .filter((e) => e.parentId === parentId && e.deletedAt === null)
    .sort(byQueueRank);
}

function recordOf(data: GameLibraryData, entry: QueueEntry): GameRecord | null {
  return entry.gameId ? (data.records[entry.gameId] ?? null) : null;
}

/** Root entries the Wishlist shows. A started game keeps its row, hidden, and its place. */
function visibleRoot(data: GameLibraryData): QueueEntry[] {
  return childrenOf(data, ROOT_PARENT).filter((entry) => {
    if (entry.kind === "collection") return true;
    const record = recordOf(data, entry);
    return record !== null && record.status === null;
  });
}

function siblingsFor(data: GameLibraryData, entry: QueueEntry): QueueEntry[] {
  return entry.parentId === ROOT_PARENT ? visibleRoot(data) : childrenOf(data, entry.parentId);
}

function endKey(siblings: QueueEntry[], ctx: ChangeContext): string {
  return keyBetween(siblings.at(-1)?.position ?? null, null, ctx.random);
}

/** A live row, reviving the tombstone at this id if there is one. */
function liveEntry(
  data: GameLibraryData,
  fields: Pick<QueueEntry, "entryId" | "parentId" | "kind" | "position"> & Partial<QueueEntry>,
  ctx: ChangeContext,
): QueueEntry {
  const previous = data.queue[fields.entryId];
  return {
    gameId: null,
    franchiseId: null,
    title: "",
    image: null,
    catalogSeen: [],
    ...fields,
    addedAt: ctx.now,
    updatedAt: nextStamp(previous?.updatedAt ?? 0, ctx.now),
    deletedAt: null,
    liveAt: nextStamp(previous?.liveAt ?? 0, ctx.now),
  };
}

function tombstone(entry: QueueEntry, ctx: ChangeContext): QueueEntry {
  const liveAt = nextStamp(entry.liveAt, ctx.now);
  return { ...entry, liveAt, deletedAt: liveAt };
}

function withRecord(data: GameLibraryData, ref: GameRef, ctx: ChangeContext): LibraryPatch {
  const patch = emptyPatch();
  if (!data.records[gameIdFor(ref.rawgId)]) patch.records.push(newRecord(ref, ctx.now));
  return patch;
}

function addRootGame(data: GameLibraryData, gameId: GameId, ctx: ChangeContext): QueueEntry {
  return liveEntry(
    data,
    {
      entryId: rootEntryId(gameId),
      parentId: ROOT_PARENT,
      kind: "game",
      gameId,
      position: endKey(childrenOf(data, ROOT_PARENT), ctx),
    },
    ctx,
  );
}

function liveCollection(data: GameLibraryData, collectionId: string): QueueEntry | null {
  const entry = data.queue[collectionId];
  return entry && entry.kind === "collection" && entry.deletedAt === null ? entry : null;
}

// ── wishlist changes ────────────────────────────────────────────────────────

export function saveGame(data: GameLibraryData, ref: GameRef, ctx: ChangeContext): LibraryPatch {
  const gameId = gameIdFor(ref.rawgId);
  if (data.queue[rootEntryId(gameId)]?.deletedAt === null) return emptyPatch();
  const patch = withRecord(data, ref, ctx);
  patch.queue.push(addRootGame(data, gameId, ctx));
  return patch;
}

/**
 * Copies a franchise into the user's own collection. From here on the catalog
 * never changes it: new catalog games are offered through catalogAdditions().
 * Saving again after a removal starts fresh from the catalog.
 */
export function saveCollection(
  data: GameLibraryData,
  def: CollectionDef,
  refs: readonly GameRef[],
  catalogSlugs: readonly string[],
  ctx: ChangeContext,
): LibraryPatch {
  const entryId = collectionEntryId(def.franchiseId);
  if (data.queue[entryId]?.deletedAt === null) return emptyPatch();

  const unique = new Map(refs.map((ref) => [gameIdFor(ref.rawgId), ref]));
  const patch = emptyPatch();
  patch.queue.push(
    liveEntry(
      data,
      {
        entryId,
        parentId: ROOT_PARENT,
        kind: "collection",
        franchiseId: def.franchiseId,
        title: def.title,
        image: def.image,
        catalogSeen: [...catalogSlugs],
        position: endKey(childrenOf(data, ROOT_PARENT), ctx),
      },
      ctx,
    ),
  );

  const keys = spreadKeys(unique.size, ctx.random);
  let index = 0;
  for (const [gameId, ref] of unique) {
    patch.records.push(...withRecord(data, ref, ctx).records);
    patch.queue.push(
      liveEntry(
        data,
        {
          entryId: memberEntryId(entryId, gameId),
          parentId: entryId,
          kind: "game",
          gameId,
          position: keys[index++],
        },
        ctx,
      ),
    );
  }

  // Left live by a device that hadn't seen the removal.
  for (const member of childrenOf(data, entryId)) {
    if (member.gameId && !unique.has(member.gameId)) patch.queue.push(tombstone(member, ctx));
  }
  return patch;
}

export function addMember(
  data: GameLibraryData,
  collectionId: string,
  ref: GameRef,
  ctx: ChangeContext,
): LibraryPatch {
  if (!liveCollection(data, collectionId)) return emptyPatch();
  const gameId = gameIdFor(ref.rawgId);
  const entryId = memberEntryId(collectionId, gameId);
  if (data.queue[entryId]?.deletedAt === null) return emptyPatch();
  const patch = withRecord(data, ref, ctx);
  patch.queue.push(
    liveEntry(
      data,
      {
        entryId,
        parentId: collectionId,
        kind: "game",
        gameId,
        position: endKey(childrenOf(data, collectionId), ctx),
      },
      ctx,
    ),
  );
  return patch;
}

/** Removes a game row, or a collection with its members. Pass the ids to restoreEntries to undo. */
export function removeEntry(
  data: GameLibraryData,
  entryId: string,
  ctx: ChangeContext,
): LibraryPatch {
  const entry = data.queue[entryId];
  if (!entry || entry.deletedAt !== null) return emptyPatch();
  const patch = emptyPatch();
  patch.queue.push(tombstone(entry, ctx));
  if (entry.kind === "collection") {
    for (const member of childrenOf(data, entryId)) patch.queue.push(tombstone(member, ctx));
  }
  return patch;
}

/** A forward write with fresh stamps: restoring old ones would lose to the tombstone. */
export function restoreEntries(
  data: GameLibraryData,
  entryIds: readonly string[],
  ctx: ChangeContext,
): LibraryPatch {
  const patch = emptyPatch();
  for (const id of entryIds) {
    const entry = data.queue[id];
    if (!entry || entry.deletedAt === null) continue;
    patch.queue.push({ ...entry, deletedAt: null, liveAt: nextStamp(entry.liveAt, ctx.now) });
  }
  return patch;
}

/** Moves within the entry's own parent, so a member can never move its collection. */
export function moveEntry(
  data: GameLibraryData,
  entryId: string,
  index: number,
  ctx: ChangeContext,
): LibraryPatch {
  const entry = data.queue[entryId];
  if (!entry || entry.deletedAt !== null) return emptyPatch();
  const siblings = siblingsFor(data, entry);
  if (!siblings.some((e) => e.entryId === entryId)) return emptyPatch();

  const others = siblings.filter((e) => e.entryId !== entryId);
  const at = Math.max(0, Math.min(index, others.length));
  if (siblings[at]?.entryId === entryId) return emptyPatch();

  const { position, rewrites } = placeAt(others.map(rankedEntry), at, ctx.random);
  const patch = emptyPatch();
  patch.queue.push({ ...entry, position, updatedAt: nextStamp(entry.updatedAt, ctx.now) });
  for (const rewrite of rewrites) {
    const sibling = data.queue[rewrite.id];
    patch.queue.push({
      ...sibling,
      position: rewrite.position,
      updatedAt: nextStamp(sibling.updatedAt, ctx.now),
    });
  }
  return patch;
}

export function shiftEntry(
  data: GameLibraryData,
  entryId: string,
  delta: number,
  ctx: ChangeContext,
): LibraryPatch {
  const entry = data.queue[entryId];
  if (!entry) return emptyPatch();
  const index = siblingsFor(data, entry).findIndex((e) => e.entryId === entryId);
  return index < 0 ? emptyPatch() : moveEntry(data, entryId, index + delta, ctx);
}

export function moveToTop(
  data: GameLibraryData,
  entryId: string,
  ctx: ChangeContext,
): LibraryPatch {
  return moveEntry(data, entryId, 0, ctx);
}

/** Directly behind the current top pick, which keeps its place. */
export function playNext(data: GameLibraryData, entryId: string, ctx: ChangeContext): LibraryPatch {
  return moveEntry(data, entryId, 1, ctx);
}

/** Catalog games the user hasn't been offered yet. Slugs survive RAWG redirects. */
export function catalogAdditions(entry: QueueEntry, catalogSlugs: readonly string[]): string[] {
  const seen = new Set(entry.catalogSeen);
  return catalogSlugs.filter((slug) => !seen.has(slug));
}

/**
 * Only on a user action. This shares a stamp with the row's position, so a
 * review and a reorder of the same collection on two devices keep the later one.
 */
export function markCatalogSeen(
  data: GameLibraryData,
  collectionId: string,
  slugs: readonly string[],
  ctx: ChangeContext,
): LibraryPatch {
  const entry = liveCollection(data, collectionId);
  const patch = emptyPatch();
  if (!entry || catalogAdditions(entry, slugs).length === 0) return patch;
  patch.queue.push({
    ...entry,
    catalogSeen: [...new Set([...entry.catalogSeen, ...slugs])],
    updatedAt: nextStamp(entry.updatedAt, ctx.now),
  });
  return patch;
}

// ── play state ──────────────────────────────────────────────────────────────

function changeState(
  record: GameRecord,
  fields: Partial<GameRecord>,
  ctx: ChangeContext,
): LibraryPatch {
  const patch = emptyPatch();
  patch.records.push({ ...record, ...fields, stateAt: nextStamp(record.stateAt, ctx.now) });
  return patch;
}

function changeProgress(
  record: GameRecord,
  fields: Pick<Partial<GameRecord>, "progressEnabled" | "progress">,
  ctx: ChangeContext,
): LibraryPatch {
  const patch = emptyPatch();
  patch.records.push({
    ...record,
    ...fields,
    progressAt: nextStamp(record.progressAt, ctx.now),
  });
  return patch;
}

/**
 * Writes only the state group. Notes, progress and rank have their own stamps,
 * so a status change can't cost any of them, even one synced from another device.
 */
export function setStatus(
  data: GameLibraryData,
  gameId: GameId,
  status: GameStatus,
  ctx: ChangeContext,
): LibraryPatch {
  const record = data.records[gameId];
  if (!record || record.status === status) return emptyPatch();
  return changeState(
    record,
    {
      status,
      startedAt: status === "playing" ? (record.startedAt ?? ctx.now) : record.startedAt,
      completedAt: status === "completed" ? ctx.now : record.completedAt,
    },
    ctx,
  );
}

/** Starts a game from anywhere, including one that was never saved. */
export function startGame(data: GameLibraryData, ref: GameRef, ctx: ChangeContext): LibraryPatch {
  const gameId = gameIdFor(ref.rawgId);
  const record = data.records[gameId] ?? newRecord(ref, ctx.now);
  return setStatus(
    { ...data, records: { ...data.records, [gameId]: record } },
    gameId,
    "playing",
    ctx,
  );
}

/** Leaves Currently Playing. The record stays, so notes return if the game is saved again. */
export function clearStatus(
  data: GameLibraryData,
  gameId: GameId,
  ctx: ChangeContext,
): LibraryPatch {
  const record = data.records[gameId];
  if (!record || record.status === null) return emptyPatch();
  return changeState(record, { status: null }, ctx);
}

export function backToWishlist(
  data: GameLibraryData,
  gameId: GameId,
  ctx: ChangeContext,
): LibraryPatch {
  const patch = clearStatus(data, gameId, ctx);
  const placed = placementsOf(data, gameId);
  if (data.records[gameId] && !placed.standalone && placed.collections.length === 0) {
    patch.queue.push(addRootGame(data, gameId, ctx));
  }
  return patch;
}

export function setProgressEnabled(
  data: GameLibraryData,
  gameId: GameId,
  enabled: boolean,
  ctx: ChangeContext,
): LibraryPatch {
  const record = data.records[gameId];
  if (!record || record.progressEnabled === enabled) return emptyPatch();
  return changeProgress(record, { progressEnabled: enabled }, ctx);
}

export function setProgress(
  data: GameLibraryData,
  gameId: GameId,
  value: number,
  ctx: ChangeContext,
): LibraryPatch {
  const record = data.records[gameId];
  if (!record || !Number.isFinite(value)) return emptyPatch();
  const progress = Math.max(0, Math.min(100, Math.round(value)));
  if (record.progress === progress) return emptyPatch();
  return changeProgress(record, { progress }, ctx);
}

export function setNotes(
  data: GameLibraryData,
  gameId: GameId,
  notes: string,
  ctx: ChangeContext,
): LibraryPatch {
  const record = data.records[gameId];
  const capped = notes.slice(0, MAX_NOTES_LENGTH);
  const patch = emptyPatch();
  if (!record || record.notes === capped) return patch;
  patch.records.push({ ...record, notes: capped, notesAt: nextStamp(record.notesAt, ctx.now) });
  return patch;
}

/** The first line with text, which is what a card previews. */
export function notesPreview(notes: string): string {
  return (
    notes
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ""
  );
}

/** Keeps a fresher image and name from Discovery. */
export function refreshSnapshot(
  data: GameLibraryData,
  ref: GameRef,
  ctx: ChangeContext,
): LibraryPatch {
  const patch = emptyPatch();
  const record = data.records[gameIdFor(ref.rawgId)];
  if (!record) return patch;
  const image = ref.image ?? record.image;
  if (
    record.slug === ref.slug &&
    record.name === ref.name &&
    record.released === ref.released &&
    record.image === image
  ) {
    return patch;
  }
  patch.records.push({
    ...record,
    slug: ref.slug,
    name: ref.name,
    released: ref.released,
    image,
    metaAt: nextStamp(record.metaAt, ctx.now),
  });
  return patch;
}

// ── tier list ───────────────────────────────────────────────────────────────

/** Where a game sits on the board, or null if it isn't on it. */
export function boardTier(record: GameRecord): Tier | null {
  if (record.tier === "hidden") return null;
  if (record.tier === null) return record.status === "completed" ? "unranked" : null;
  return record.tier;
}

function rankedRecord(record: GameRecord): Ranked {
  return { id: record.gameId, position: record.tierPosition ?? "" };
}

function byTierRank(a: GameRecord, b: GameRecord): number {
  return compareRank(rankedRecord(a), rankedRecord(b));
}

/** A tile that somehow lost its position still shows, and the next move repairs it. */
function placedInTier(data: GameLibraryData, tier: Tier): GameRecord[] {
  return Object.values(data.records)
    .filter((r) => r.tier === tier)
    .sort(byTierRank);
}

/**
 * Placed tiles first, then completed games nobody has ranked, oldest finish
 * first. Those have no position until the user moves one.
 */
export function tierBoard(data: GameLibraryData): Record<Tier, BoardTile[]> {
  const board = {} as Record<Tier, BoardTile[]>;
  const tile = (record: GameRecord): BoardTile => ({
    record,
    notCompleted: record.status !== "completed",
  });
  for (const tier of ALL_TIERS) board[tier] = placedInTier(data, tier).map(tile);

  const waiting = Object.values(data.records)
    .filter((r) => r.tier === null && boardTier(r) === "unranked")
    .sort(
      (a, b) =>
        (a.completedAt ?? 0) - (b.completedAt ?? 0) ||
        (a.gameId < b.gameId ? -1 : a.gameId > b.gameId ? 1 : 0),
    );
  board.unranked.push(...waiting.map(tile));
  return board;
}

/** Drops into the waiting part of Unranked land after the placed tiles. */
export function moveToTier(
  data: GameLibraryData,
  gameId: GameId,
  tier: Tier,
  index: number,
  ctx: ChangeContext,
): LibraryPatch {
  const record = data.records[gameId];
  const patch = emptyPatch();
  if (!record) return patch;

  const placed = placedInTier(data, tier);
  const others = placed.filter((r) => r.gameId !== gameId);
  const at = Math.max(0, Math.min(index, others.length));
  if (placed[at]?.gameId === gameId) return patch;

  const { position, rewrites } = placeAt(others.map(rankedRecord), at, ctx.random);
  patch.records.push({
    ...record,
    tier,
    tierPosition: position,
    tierAt: nextStamp(record.tierAt, ctx.now),
  });
  for (const rewrite of rewrites) {
    const sibling = data.records[rewrite.id];
    patch.records.push({
      ...sibling,
      tierPosition: rewrite.position,
      tierAt: nextStamp(sibling.tierAt, ctx.now),
    });
  }
  return patch;
}

/** The deliberate exception: ranks any game, finished or not. */
export function addToBoard(
  data: GameLibraryData,
  gameId: GameId,
  ctx: ChangeContext,
): LibraryPatch {
  const record = data.records[gameId];
  if (!record || boardTier(record) !== null) return emptyPatch();
  return moveToTier(data, gameId, "unranked", Number.MAX_SAFE_INTEGER, ctx);
}

export function removeFromBoard(
  data: GameLibraryData,
  gameId: GameId,
  ctx: ChangeContext,
): LibraryPatch {
  const record = data.records[gameId];
  const patch = emptyPatch();
  if (!record || boardTier(record) === null) return patch;
  patch.records.push({
    ...record,
    tier: "hidden",
    tierPosition: null,
    tierAt: nextStamp(record.tierAt, ctx.now),
  });
  return patch;
}

// ── views ───────────────────────────────────────────────────────────────────

export function collectionSummary(data: GameLibraryData, collectionId: string): CollectionSummary {
  const members: CollectionMember[] = [];
  for (const entry of childrenOf(data, collectionId)) {
    const record = recordOf(data, entry);
    if (record) members.push({ entry, record });
  }
  return {
    members,
    completed: members.filter((m) => m.record.status === "completed").length,
    nextUp: members.find((m) => m.record.status === null)?.record ?? null,
  };
}

export function wishlistView(data: GameLibraryData): WishlistItem[] {
  const items: WishlistItem[] = [];
  for (const entry of visibleRoot(data)) {
    const rank = items.length + 1;
    if (entry.kind === "collection") {
      items.push({ kind: "collection", rank, entry, ...collectionSummary(data, entry.entryId) });
      continue;
    }
    const record = recordOf(data, entry);
    if (record) items.push({ kind: "game", rank, entry, record });
  }
  return items;
}

export function placementsOf(
  data: GameLibraryData,
  gameId: GameId,
): { standalone: boolean; collections: QueueEntry[] } {
  const collections: QueueEntry[] = [];
  for (const entry of Object.values(data.queue)) {
    if (entry.gameId !== gameId || entry.parentId === ROOT_PARENT) continue;
    if (entry.deletedAt !== null) continue;
    const parent = liveCollection(data, entry.parentId);
    if (parent) collections.push(parent);
  }
  return { standalone: data.queue[rootEntryId(gameId)]?.deletedAt === null, collections };
}

export function gameStage(data: GameLibraryData, gameId: GameId): GameStage {
  const status = data.records[gameId]?.status;
  if (status) return status;
  const placed = placementsOf(data, gameId);
  if (placed.standalone) return "wishlist";
  return placed.collections.length > 0 ? "collection" : "none";
}

/** Sorted by when play began, so a card doesn't jump while it is being edited. */
export function playingView(data: GameLibraryData): Record<GameStatus, GameRecord[]> {
  const view: Record<GameStatus, GameRecord[]> = {
    playing: [],
    paused: [],
    completed: [],
    dropped: [],
  };
  for (const record of Object.values(data.records)) {
    if (record.status) view[record.status].push(record);
  }
  const startedFirst = (a: GameRecord, b: GameRecord) =>
    (b.startedAt ?? b.createdAt) - (a.startedAt ?? a.createdAt) ||
    (a.gameId < b.gameId ? -1 : a.gameId > b.gameId ? 1 : 0);
  view.playing.sort(startedFirst);
  view.paused.sort(startedFirst);
  view.dropped.sort(startedFirst);
  view.completed.sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0) || startedFirst(a, b));
  return view;
}
