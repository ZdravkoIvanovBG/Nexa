import { safeFetch as fetch } from "@/lib/safe-fetch";
import type { Addon } from "./addons";
import {
  enabledAddonRows,
  type InstallPlanOptions,
  managedAddonRows,
  parseAddonUrl,
  planAddonInstall,
  withAddonEnabled,
} from "./addon-install-plan";
import { applyOrderToItems } from "./addons-store/reorder";
import { applyRemote, mirrorAddons } from "./cloud/mirror";

const STORAGE_KEY = "harbor.installed-addons";
const SEEDED_KEY = "harbor.addons.seeded.v1";
const DISABLED_KEY = "harbor.addons.disabled";

const DEFAULT_ADDONS: Array<{ id: string; transportUrl: string }> = [];

export async function seedDefaultAddonsIfFirstRun(): Promise<void> {
  try {
    if (localStorage.getItem(SEEDED_KEY) === "1") return;
    if (loadInstalled().length > 0) {
      localStorage.setItem(SEEDED_KEY, "1");
      return;
    }
    for (const def of DEFAULT_ADDONS) {
      try {
        const manifest = await fetchManifestAt(def.transportUrl);
        const next = loadInstalled().filter((a) => a.transportUrl !== def.transportUrl);
        next.push({
          id: manifest.id || def.id,
          transportUrl: def.transportUrl,
          installedAt: Date.now(),
          manifest,
        });
        saveInstalled(next);
      } catch (e) {
        console.warn(`[addons] failed to seed ${def.id}`, e);
      }
    }
    localStorage.setItem(SEEDED_KEY, "1");
  } catch (e) {
    console.warn("[addons] seed default failed", e);
  }
}

export type InstalledAddon = {
  id: string;
  transportUrl: string;
  installedAt: number;
  manifest?: Addon["manifest"];
  /** Absent means enabled: the disabled set used to live in its own key. */
  enabled?: boolean;
  /** Display order. Absent means "not yet migrated from harbor.addonOrder". */
  order?: number;
  updatedAt?: number;
  manifestFetchedAt?: number;
};

const SLIM_MANIFEST_KEYS = [
  "id",
  "name",
  "version",
  "description",
  "logo",
  "background",
  "types",
  "idPrefixes",
  "resources",
  "catalogs",
  "behaviorHints",
] as const;

function slimManifest(manifest: Addon["manifest"] | undefined): Addon["manifest"] | undefined {
  if (!manifest) return undefined;
  const src = manifest as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of SLIM_MANIFEST_KEYS) {
    const v = src[k];
    if (v === undefined) continue;
    if (k === "description" && typeof v === "string") {
      out[k] = v.slice(0, 400);
      continue;
    }
    if (k === "logo" && typeof v === "string" && v.startsWith("data:")) {
      continue;
    }
    if (k === "background" && typeof v === "string" && v.startsWith("data:")) {
      continue;
    }
    if (k === "catalogs" && Array.isArray(v)) {
      out[k] = (v as Array<Record<string, unknown>>).map((c) => ({
        id: c.id,
        type: c.type,
        name: c.name,
        extra: Array.isArray(c.extra)
          ? (c.extra as Array<Record<string, unknown>>).map((e) => ({
              name: e.name,
              isRequired: e.isRequired,
            }))
          : undefined,
      }));
      continue;
    }
    out[k] = v;
  }
  return out as Addon["manifest"];
}

const KEYS_V2_FLAG = "harbor.addons.keys.v2";
const ORDER_KEY = "harbor.addonOrder";

function readRaw(): InstalledAddon[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as InstalledAddon[]) : [];
  } catch {
    return [];
  }
}

/**
 * Fold the two satellite keys into the addon rows themselves.
 *
 * `harbor.addons.disabled` and `harbor.addonOrder` were parallel arrays keyed by
 * transport URL. Carrying them as fields lets one write chokepoint mirror the
 * whole state, and lets a reconfiguration keep enabled/order across a URL change.
 * Runs once, on the first loadInstalled() after the update.
 */
function migrateKeysV2(): void {
  try {
    if (localStorage.getItem(KEYS_V2_FLAG) === "1") return;
  } catch {
    return;
  }
  try {
    const list = readRaw();
    if (list.length > 0) {
      let disabled = new Set<string>();
      try {
        const raw = localStorage.getItem(DISABLED_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : null;
        if (Array.isArray(parsed))
          disabled = new Set(parsed.filter((u): u is string => typeof u === "string"));
      } catch {}
      let order: string[] = [];
      try {
        const raw = localStorage.getItem(ORDER_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : null;
        if (Array.isArray(parsed)) order = parsed.filter((u): u is string => typeof u === "string");
      } catch {}
      const ordered = applyOrderToItems(list, order);
      const migrated = ordered.map((a, i) => ({
        ...a,
        enabled: a.enabled ?? !disabled.has(a.transportUrl),
        order: a.order ?? i,
      }));
      writeInstalled(migrated);
    }
    localStorage.setItem(KEYS_V2_FLAG, "1");
  } catch (e) {
    console.warn("[addons] key migration failed; leaving the old keys in place", e);
  }
}

let migrated = false;

export function loadInstalled(): InstalledAddon[] {
  // Synchronous by contract: render paths call this directly.
  if (!migrated) {
    migrated = true;
    migrateKeysV2();
  }
  return readRaw();
}

/**
 * The single private writer. Everything that changes the addon list -- install,
 * uninstall, reorder, enable/disable, seed, manifest backfill -- lands here, so
 * this is the one place that has to mirror and announce the change.
 */
function saveInstalled(list: InstalledAddon[]) {
  writeInstalled(list);
  mirrorAddons(list);
  try {
    window.dispatchEvent(new CustomEvent("harbor:addons-changed"));
  } catch {
    /* not in a DOM context */
  }
}

/** Applies remote state without echoing it back to the cloud. */
export function replaceInstalled(list: InstalledAddon[]): void {
  applyRemote(() => saveInstalled(list));
}

function writeInstalled(list: InstalledAddon[]) {
  const slim = list.map((a) => ({ ...a, manifest: slimManifest(a.manifest) }));
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
  } catch (e) {
    if (e instanceof DOMException && (e.name === "QuotaExceededError" || e.code === 22)) {
      const stripped = list.map((a) => ({
        id: a.id,
        transportUrl: a.transportUrl,
        installedAt: a.installedAt,
      }));
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(stripped));
      } catch (e2) {
        console.warn("[addons] localStorage still full after stripping manifests", e2);
      }
    } else {
      throw e;
    }
  }
}

export function reorderInstalled(urlSequence: string[]): void {
  const items = loadInstalled();
  if (items.length < 2) return;
  saveInstalled(applyOrderToItems(items, urlSequence).map((a, i) => ({ ...a, order: i })));
}

// Derived from the addon rows now, but the signatures are unchanged so the
// existing call sites (views/addons.tsx, play-picker, organize) keep working.
export function loadDisabledAddons(): Set<string> {
  const out = new Set<string>();
  for (const a of loadInstalled()) if (a.enabled === false) out.add(a.transportUrl);
  return out;
}

function saveDisabledAddons(set: Set<string>): void {
  saveInstalled(loadInstalled().map((a) => ({ ...a, enabled: !set.has(a.transportUrl) })));
}

export function isAddonEnabled(transportUrl: string): boolean {
  return !loadDisabledAddons().has(transportUrl);
}

/** Turns one addon on or off. The row stays installed either way. */
export function setAddonEnabled(transportUrl: string, enabled: boolean): void {
  const next = withAddonEnabled(loadInstalled(), transportUrl, enabled, Date.now());
  if (next) saveInstalled(next);
}

export function filterEnabled<T extends { transportUrl: string }>(items: T[]): T[] {
  const disabled = loadDisabledAddons();
  if (disabled.size === 0) return items;
  return items.filter((a) => !disabled.has(a.transportUrl));
}

export function isInstalled(id: string): boolean {
  return loadInstalled().some((a) => a.id === id);
}

export function transportUrlFor(id: string): string | null {
  return loadInstalled().find((a) => a.id === id)?.transportUrl ?? null;
}

function transportHost(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

export function findHostnameMatch(transportUrl: string): InstalledAddon | null {
  const host = transportHost(transportUrl);
  if (!host) return null;
  return loadInstalled().find((a) => transportHost(a.transportUrl) === host) ?? null;
}

export { MAX_ADDON_URL_LENGTH, parseAddonUrl } from "./addon-install-plan";
export type { AddonUrlParse } from "./addon-install-plan";

function validateManifest(
  m: unknown,
): { ok: true; manifest: Addon["manifest"] } | { ok: false; error: string } {
  if (!m || typeof m !== "object") return { ok: false, error: "Manifest is not a JSON object." };
  const obj = m as Record<string, unknown>;
  if (typeof obj.id !== "string" || obj.id.length === 0)
    return { ok: false, error: "Manifest is missing an `id`." };
  if (typeof obj.name !== "string" || obj.name.length === 0)
    return { ok: false, error: "Manifest is missing a `name`." };
  return { ok: true, manifest: obj as Addon["manifest"] };
}

export async function fetchManifestAt(transportUrl: string): Promise<Addon["manifest"]> {
  const res = await fetch(transportUrl, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Manifest fetch failed (HTTP ${res.status}). Check the URL.`);
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new Error("Response wasn't valid JSON. The URL may not be a Stremio manifest.");
  }
  const v = validateManifest(json);
  if (!v.ok) throw new Error(v.error);
  return v.manifest;
}

export type InstallResult = {
  addon: Addon;
  replaced: boolean;
};

export async function installAddon(id: string, transportUrl: string): Promise<Addon> {
  const manifest = await fetchManifestAt(transportUrl);
  const canonicalId = manifest.id || id;
  const next = loadInstalled().filter((a) => a.transportUrl !== transportUrl);
  next.push({
    id: canonicalId,
    transportUrl,
    installedAt: Date.now(),
    manifest,
    order: next.length,
    updatedAt: Date.now(),
    manifestFetchedAt: Date.now(),
  });
  saveInstalled(next);
  return { manifest, transportUrl };
}

export async function installFromUrl(
  rawUrl: string,
  options: InstallPlanOptions = {},
): Promise<InstallResult> {
  const parsed = parseAddonUrl(rawUrl);
  if (parsed.kind === "error") throw new Error(parsed.message);
  const manifest = await fetchManifestAt(parsed.url);
  const id = manifest.id;
  // A reconfiguration changes the URL: the new row takes the old one's place
  // and enabled state instead of being added beside it (see planAddonInstall).
  const { keep, previous, replaced } = planAddonInstall(loadInstalled(), parsed.url, id, options);
  const next = [...keep];
  next.push({
    id,
    transportUrl: parsed.url,
    installedAt: previous?.installedAt ?? Date.now(),
    manifest,
    enabled: previous?.enabled,
    order: previous?.order ?? next.length,
    updatedAt: Date.now(),
    manifestFetchedAt: Date.now(),
  });
  saveInstalled(next);
  const addon: Addon = { manifest, transportUrl: parsed.url };
  return { addon, replaced };
}

export async function uninstallAddon(id: string, transportUrl?: string): Promise<void> {
  const removed = transportUrl
    ? loadInstalled().filter((a) => a.transportUrl === transportUrl)
    : loadInstalled().filter((a) => a.id === id);
  const next = transportUrl
    ? loadInstalled().filter((a) => a.transportUrl !== transportUrl)
    : loadInstalled().filter((a) => a.id !== id);
  saveInstalled(next);
  if (removed.length > 0) {
    const disabled = loadDisabledAddons();
    let touched = false;
    for (const a of removed) if (disabled.delete(a.transportUrl)) touched = true;
    if (touched) saveDisabledAddons(disabled);
  }
}

/** Installed, enabled, in display order -- the shared basis for both accessors below. */
function orderedEnabledEntries(): InstalledAddon[] {
  return enabledAddonRows(loadInstalled());
}

/** Resolves rows to addons, fetching and caching any manifest the store lacks. */
async function resolveEntries(entries: InstalledAddon[]): Promise<Addon[]> {
  if (entries.length === 0) return [];
  const results = await Promise.all(
    entries.map(async (entry): Promise<Addon | null> => {
      if (entry.manifest) {
        return { manifest: entry.manifest, transportUrl: entry.transportUrl };
      }
      try {
        const manifest = await fetchManifestAt(entry.transportUrl);
        saveInstalled(
          loadInstalled().map((e) =>
            e.transportUrl === entry.transportUrl ? { ...e, manifest } : e,
          ),
        );
        return { manifest, transportUrl: entry.transportUrl };
      } catch {
        return null;
      }
    }),
  );
  return results.filter((a): a is Addon => a !== null);
}

/**
 * Every installed addon, disabled ones included, in display order: the list the
 * Addons screens show and mark as "Installed". Not for querying content -- use
 * installedAddons()/installedAddonsResolved(), which skip disabled addons.
 */
export async function managedAddonsResolved(): Promise<Addon[]> {
  return resolveEntries(managedAddonRows(loadInstalled()));
}

/**
 * The user's addons, ready to query: enabled only, in display order.
 *
 * Synchronous, so it is safe to call on a render path. An addon whose manifest
 * has not been fetched yet is skipped rather than awaited -- use
 * installedAddonsResolved() when a missing manifest should be fetched instead.
 */
export function installedAddons(): Addon[] {
  const out: Addon[] = [];
  for (const a of orderedEnabledEntries()) {
    if (a.manifest) out.push({ manifest: a.manifest, transportUrl: a.transportUrl });
  }
  return out;
}

/** installedAddons(), but manifests missing from the store are fetched and cached first. */
export async function installedAddonsResolved(): Promise<Addon[]> {
  return resolveEntries(orderedEnabledEntries());
}

export async function fetchInstalledAddons(): Promise<Addon[]> {
  const list = loadInstalled();
  if (list.length === 0) return [];
  const tasks = list.map(async (entry): Promise<Addon | null> => {
    if (entry.manifest) {
      return { manifest: entry.manifest, transportUrl: entry.transportUrl };
    }
    try {
      const manifest = await fetchManifestAt(entry.transportUrl);
      const updated = loadInstalled().map((e) => (e.id === entry.id ? { ...e, manifest } : e));
      saveInstalled(updated);
      return { manifest, transportUrl: entry.transportUrl };
    } catch {
      return null;
    }
  });
  const results = await Promise.all(tasks);
  return results.filter((a): a is Addon => a !== null);
}

export function manifestToConfigureUrl(transportUrl: string): string {
  return transportUrl.replace(/manifest\.json(\?.*)?$/i, "configure");
}

export function manifestToShareUrl(
  transportUrl: string,
  scheme: "https" | "stremio" = "https",
): string {
  if (scheme === "stremio") {
    return transportUrl.replace(/^https?:\/\//i, "stremio://");
  }
  return transportUrl;
}

export function cometConfigFor(debridService: string, apiKey: string): string {
  const settings = {
    maxResultsPerResolution: 0,
    maxSize: 0,
    cachedOnly: false,
    sortCachedUncachedTogether: false,
    removeTrash: true,
    resultFormat: ["all"],
    debridServices: [{ service: debridService, apiKey: apiKey.trim() }],
    enableTorrent: true,
    deduplicateStreams: true,
    scrapeDebridAccountTorrents: false,
    debridStreamProxyPassword: "",
    languages: { required: [], allowed: [], exclude: [], preferred: [] },
    resolutions: {},
    options: {
      remove_ranks_under: -10000000000,
      allow_english_in_languages: false,
      remove_unknown_languages: false,
    },
  };
  return btoa(JSON.stringify(settings));
}

export function cometUrlFor(debridService: string, apiKey: string): string {
  const b64 = cometConfigFor(debridService, apiKey);
  return `https://comet.elfhosted.com/${b64}/manifest.json`;
}

export const COMET_ID = "comet.elfhosted.com";

export function cometKeyFromUrl(transportUrl: string): { service: string; apiKey: string } | null {
  const m = transportUrl.match(/comet\.elfhosted\.com\/([^/]+)\/manifest\.json/);
  if (!m) return null;
  try {
    const json = JSON.parse(atob(m[1]));
    const svc = json?.debridServices?.[0];
    if (!svc?.service || !svc?.apiKey) return null;
    return { service: svc.service, apiKey: svc.apiKey };
  } catch {
    return null;
  }
}
