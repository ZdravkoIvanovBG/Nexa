// Everything read back from disk or the cloud passes through here, so a damaged
// or hand-edited row can never reach the rules as anything but a valid one.
import { TIERS } from "../tracking-tiers.ts";
import {
  MAX_NOTES_LENGTH,
  type GameId,
  type GameLibraryData,
  type GameRecord,
  type GameStatus,
  type GameTier,
  type QueueEntry,
  type QueueKind,
} from "./types.ts";

const GAME_ID = /^rawg:[1-9]\d*$/;

const STATUSES: readonly string[] = ["playing", "paused", "completed", "dropped"];
const TIER_VALUES: readonly string[] = [...TIERS, "unranked", "hidden"];

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** A whole, non-negative millisecond count. Postgres bigint may arrive as a string. */
function stamp(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : 0;
}

function optionalStamp(value: unknown): number | null {
  return value === null || value === undefined ? null : stamp(value);
}

function gameId(value: unknown): GameId | null {
  return typeof value === "string" && GAME_ID.test(value) ? (value as GameId) : null;
}

function progress(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function sanitizeRecord(value: unknown): GameRecord | null {
  const raw = asObject(value);
  const id = gameId(raw?.gameId);
  if (!raw || !id) return null;
  const tier = TIER_VALUES.includes(raw.tier as string) ? (raw.tier as GameTier) : null;
  return {
    provider: "rawg",
    rawgId: Number(id.slice("rawg:".length)),
    slug: text(raw.slug),
    name: text(raw.name),
    released: optionalText(raw.released),
    image: optionalText(raw.image),
    gameId: id,
    metaAt: stamp(raw.metaAt),
    status: STATUSES.includes(raw.status as string) ? (raw.status as GameStatus) : null,
    startedAt: optionalStamp(raw.startedAt),
    completedAt: optionalStamp(raw.completedAt),
    stateAt: stamp(raw.stateAt),
    progressEnabled: raw.progressEnabled === true,
    progress: progress(raw.progress),
    progressAt: stamp(raw.progressAt),
    notes: text(raw.notes).slice(0, MAX_NOTES_LENGTH),
    notesAt: stamp(raw.notesAt),
    tier,
    tierPosition: tier === null ? null : optionalText(raw.tierPosition),
    tierAt: stamp(raw.tierAt),
    createdAt: stamp(raw.createdAt),
  };
}

export function sanitizeEntry(value: unknown): QueueEntry | null {
  const raw = asObject(value);
  if (!raw || typeof raw.entryId !== "string" || raw.entryId.length === 0) return null;
  const kind: QueueKind | null = raw.kind === "game" || raw.kind === "collection" ? raw.kind : null;
  const id = gameId(raw.gameId);
  if (!kind || (kind === "game" && !id)) return null;
  return {
    entryId: raw.entryId,
    parentId: text(raw.parentId),
    kind,
    gameId: id,
    franchiseId: optionalText(raw.franchiseId),
    title: text(raw.title),
    image: optionalText(raw.image),
    catalogSeen: Array.isArray(raw.catalogSeen)
      ? raw.catalogSeen.filter((slug): slug is string => typeof slug === "string")
      : [],
    position: text(raw.position),
    addedAt: stamp(raw.addedAt),
    updatedAt: stamp(raw.updatedAt),
    deletedAt: optionalStamp(raw.deletedAt),
    liveAt: stamp(raw.liveAt),
  };
}

export function emptyLibrary(): GameLibraryData {
  return { records: {}, queue: {} };
}

export function sanitizeLibrary(value: unknown): GameLibraryData {
  const raw = asObject(value);
  const data = emptyLibrary();
  for (const item of Object.values(asObject(raw?.records) ?? {})) {
    const record = sanitizeRecord(item);
    if (record) data.records[record.gameId] = record;
  }
  for (const item of Object.values(asObject(raw?.queue) ?? {})) {
    const entry = sanitizeEntry(item);
    if (entry) data.queue[entry.entryId] = entry;
  }
  return data;
}
