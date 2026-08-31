import type { LocalEntry } from "@/lib/watchlist";
import type { WatchedEntry, WatchingEntry } from "@/lib/library-tracking";
import { normalizeTier, type Tier } from "@/lib/tracking-tiers";

/** Table names, kept in one place so nothing else spells a column or table. */
export const TABLE = {
  watchlist: "watchlist",
  watching: "currently_watching",
  tiers: "tier_list",
} as const;

export type CloudTable = (typeof TABLE)[keyof typeof TABLE];

export type Owner = { userId: string; profileId: string };

type Base = { user_id: string; profile_id: string; media_id: string };

export type WatchlistRow = Base & {
  type: "movie" | "series";
  name: string;
  poster: string | null;
  added_at: string;
  updated_at: string;
};

export type WatchingRow = Base & {
  type: "movie" | "series";
  name: string;
  poster: string | null;
  season: number;
  episode: number;
  total_seasons: number | null;
  status: string | null;
  year_label: string | null;
  added_at: string;
  updated_at: string;
};

export type TierRow = Base & {
  type: "movie" | "series";
  name: string;
  poster: string | null;
  tier: Tier;
  order_index: number;
  finished_at: string;
  updated_at: string;
};

export type AnyRow = WatchlistRow | WatchingRow | TierRow;

function iso(ms: number): string {
  return new Date(ms > 0 ? ms : Date.now()).toISOString();
}

function ms(value: string | null | undefined): number {
  if (!value) return 0;
  const n = Date.parse(value);
  return Number.isFinite(n) ? n : 0;
}

function kind(value: unknown): "movie" | "series" {
  return value === "series" ? "series" : "movie";
}

const tierOf = normalizeTier;

function positive(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1 ? Math.round(value) : 1;
}

// ── watchlist ───────────────────────────────────────────────────────────────

export function watchlistToRow(o: Owner, e: LocalEntry, updatedAt: number): WatchlistRow {
  return {
    user_id: o.userId,
    profile_id: o.profileId,
    media_id: e.id,
    type: e.type,
    name: e.name ?? "",
    poster: e.poster ?? null,
    added_at: iso(e.addedAt),
    updated_at: iso(updatedAt),
  };
}

export function rowToWatchlist(r: WatchlistRow): LocalEntry {
  return {
    id: r.media_id,
    type: kind(r.type),
    name: r.name ?? "",
    poster: r.poster ?? undefined,
    addedAt: ms(r.added_at),
  };
}

// ── currently watching ──────────────────────────────────────────────────────

export function watchingToRow(o: Owner, e: WatchingEntry): WatchingRow {
  return {
    user_id: o.userId,
    profile_id: o.profileId,
    media_id: e.id,
    type: e.type,
    name: e.name ?? "",
    poster: e.poster ?? null,
    season: positive(e.season),
    episode: positive(e.episode),
    total_seasons: e.totalSeasons ?? null,
    status: e.status ?? null,
    year_label: e.yearLabel ?? null,
    added_at: iso(e.addedAt),
    updated_at: iso(e.updatedAt),
  };
}

export function rowToWatching(r: WatchingRow): WatchingEntry {
  return {
    id: r.media_id,
    type: kind(r.type),
    name: r.name ?? "",
    poster: r.poster ?? undefined,
    season: positive(r.season),
    episode: positive(r.episode),
    totalSeasons:
      typeof r.total_seasons === "number" && r.total_seasons > 0 ? r.total_seasons : undefined,
    status: r.status ?? undefined,
    yearLabel: r.year_label ?? undefined,
    addedAt: ms(r.added_at),
    updatedAt: ms(r.updated_at),
  };
}

// ── tier list ───────────────────────────────────────────────────────────────

export function watchedToRow(o: Owner, e: WatchedEntry, updatedAt: number): TierRow {
  return {
    user_id: o.userId,
    profile_id: o.profileId,
    media_id: e.id,
    type: e.type,
    name: e.name ?? "",
    poster: e.poster ?? null,
    tier: tierOf(e.tier),
    order_index: Number.isFinite(e.order) ? Math.max(0, Math.round(e.order)) : 0,
    finished_at: iso(e.finishedAt),
    updated_at: iso(updatedAt),
  };
}

export function rowToWatched(r: TierRow): WatchedEntry {
  return {
    id: r.media_id,
    type: kind(r.type),
    name: r.name ?? "",
    poster: r.poster ?? undefined,
    tier: tierOf(r.tier),
    order: typeof r.order_index === "number" ? r.order_index : 0,
    finishedAt: ms(r.finished_at),
  };
}

/** Milliseconds since epoch for a row's `updated_at`, used for cloud-wins merges. */
export function rowUpdatedAt(r: { updated_at: string }): number {
  return ms(r.updated_at);
}
