import type { LocalEntry } from "@/lib/watchlist";
import type { WatchedEntry, WatchingEntry } from "@/lib/library-tracking";
// Type-only: keeps safe-fetch out of the queue's module graph.
import type { InstalledAddon } from "@/lib/addon-store";
import type { Profile } from "@/lib/profiles";
import { normalizeTier, type Tier } from "@/lib/tracking-tiers";

/** Table names, kept in one place so nothing else spells a column or table. */
export const TABLE = {
  watchlist: "watchlist",
  watching: "currently_watching",
  tiers: "tier_list",
  addons: "user_addons",
  profiles: "profiles",
  settings: "user_settings",
} as const;

export type CloudTable = (typeof TABLE)[keyof typeof TABLE];

/**
 * The column that identifies a row within its owner scope.
 *
 * For every table except `profiles` and `settings`, that scope is (user_id,
 * profile_id) and this is also the exact `onConflict` target PostgREST needs
 * for an upsert -- naming it wrong returns 42P10. `profiles` rows ARE the
 * profile scope (there is no separate "which profile owns this profile"
 * dimension), so its scope is (user_id) alone. `settings` rows are one blob
 * per (user_id, profile_id) -- profile_id doubles as both the scope and the
 * key, "" meaning the account's shared blob -- see conflictTarget().
 */
export const KEY_COLUMN: Record<CloudTable, string> = {
  [TABLE.watchlist]: "media_id",
  [TABLE.watching]: "media_id",
  [TABLE.tiers]: "media_id",
  [TABLE.addons]: "addon_url",
  [TABLE.profiles]: "id",
  [TABLE.settings]: "profile_id",
};

export function conflictTarget(table: CloudTable): string {
  if (table === TABLE.profiles || table === TABLE.settings) {
    return `user_id,${KEY_COLUMN[table]}`;
  }
  return `user_id,profile_id,${KEY_COLUMN[table]}`;
}

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

/** Named UserAddonRow because addons.ts already exports an unrelated `AddonRow`. */
export type UserAddonRow = {
  user_id: string;
  profile_id: string;
  addon_url: string;
  manifest_id: string;
  name: string;
  logo: string | null;
  description: string | null;
  manifest: unknown;
  manifest_fetched_at: string | null;
  enabled: boolean;
  order_index: number;
  added_at: string;
  updated_at: string;
};

/** Named ProfileRow because profiles.ts already exports an unrelated `Profile`. */
export type ProfileRow = {
  user_id: string;
  id: string;
  name: string;
  avatar: string | null;
  color: string;
  is_primary: boolean;
  password_hash: string | null;
  hide_content: unknown;
  locked_tabs: unknown;
  kid: unknown;
  settings_linked: boolean;
  created_at: string;
  updated_at: string;
};

/**
 * One JSON blob per (user_id, profile_id) scope -- see KEY_COLUMN above.
 *
 * `extras` carries the credential stores that are not fields on `Settings`
 * (the trackers' OAuth sessions), keyed by the localStorage key each one
 * reads from -- see cloud/credential-stores.ts.
 */
export type SettingsRow = {
  user_id: string;
  profile_id: string;
  blob: string;
  extras: string | null;
  updated_at: string;
};

export type AnyRow = WatchlistRow | WatchingRow | TierRow | UserAddonRow | ProfileRow | SettingsRow;

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

// ── addons ──────────────────────────────────────────────────────────────────

/**
 * Cloud copy of a manifest.
 *
 * Unlike the local `slimManifest`, this preserves `catalogs[].extra[].options`,
 * which requiredCatalogExtras() needs -- only data: URIs are stripped, since a
 * base64 logo can be megabytes.
 */
function slimManifestForCloud(manifest: unknown): unknown {
  if (!manifest || typeof manifest !== "object") return null;
  const src = manifest as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if (typeof v === "string" && v.startsWith("data:")) continue;
    out[k] = v;
  }
  return out;
}

export function addonToRow(o: Owner, a: InstalledAddon, orderIndex: number): UserAddonRow {
  const manifest = a.manifest as
    | { id?: string; name?: string; logo?: string; description?: string }
    | undefined;
  return {
    user_id: o.userId,
    profile_id: o.profileId,
    addon_url: a.transportUrl,
    manifest_id: manifest?.id ?? a.id ?? "",
    name: manifest?.name ?? "",
    logo:
      typeof manifest?.logo === "string" && !manifest.logo.startsWith("data:")
        ? manifest.logo
        : null,
    description: manifest?.description ?? null,
    manifest: slimManifestForCloud(a.manifest),
    manifest_fetched_at: a.manifestFetchedAt ? iso(a.manifestFetchedAt) : null,
    enabled: a.enabled !== false,
    order_index: Number.isFinite(orderIndex) ? Math.max(0, Math.round(orderIndex)) : 0,
    added_at: iso(a.installedAt),
    updated_at: iso(a.updatedAt ?? Date.now()),
  };
}

export function rowToAddon(r: UserAddonRow): InstalledAddon {
  return {
    id: r.manifest_id || r.addon_url,
    transportUrl: r.addon_url,
    installedAt: ms(r.added_at),
    manifest: (r.manifest ?? undefined) as InstalledAddon["manifest"],
    enabled: r.enabled !== false,
    order: typeof r.order_index === "number" ? r.order_index : 0,
    updatedAt: ms(r.updated_at),
    manifestFetchedAt: r.manifest_fetched_at ? ms(r.manifest_fetched_at) : undefined,
  };
}

// ── profiles ────────────────────────────────────────────────────────────────

export function profileToRow(userId: string, p: Profile): ProfileRow {
  return {
    user_id: userId,
    id: p.id,
    name: p.name,
    avatar: p.avatar,
    color: p.color,
    is_primary: p.isPrimary,
    password_hash: p.passwordHash,
    hide_content: p.hideContent,
    locked_tabs: p.lockedTabs,
    kid: p.kid,
    settings_linked: p.settingsLinked !== false,
    created_at: iso(p.createdAt),
    updated_at: iso(p.updatedAt),
  };
}

export function rowToProfile(r: ProfileRow): Profile {
  return {
    id: r.id,
    name: r.name,
    avatar: r.avatar,
    color: r.color,
    isPrimary: r.is_primary,
    passwordHash: r.password_hash,
    hideContent: (r.hide_content ?? null) as Profile["hideContent"],
    lockedTabs: (r.locked_tabs ?? null) as Profile["lockedTabs"],
    kid: (r.kid ?? null) as Profile["kid"],
    settingsLinked: r.settings_linked !== false,
    createdAt: ms(r.created_at),
    updatedAt: ms(r.updated_at),
  };
}

// ── settings ────────────────────────────────────────────────────────────────

export function settingsToRow(
  userId: string,
  scope: string,
  blob: string,
  extras: string | null,
  updatedAt: number,
): SettingsRow {
  return {
    user_id: userId,
    profile_id: scope,
    blob,
    extras,
    updated_at: iso(updatedAt),
  };
}
