import { safeFetch as fetch } from "@/lib/safe-fetch";
import type { Addon } from "./addons";
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

export function setAddonEnabled(transportUrl: string, enabled: boolean): void {
  const set = loadDisabledAddons();
  if (enabled) set.delete(transportUrl);
  else set.add(transportUrl);
  saveDisabledAddons(set);
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

export type AddonUrlParse = { kind: "ok"; url: string } | { kind: "error"; message: string };

/** Matches the user_addons.addon_url length constraint. */
export const MAX_ADDON_URL_LENGTH = 2000;

export function parseAddonUrl(input: string): AddonUrlParse {
  let raw = input.trim();
  if (!raw) return { kind: "error", message: "Paste a manifest URL or stremio:// link." };
  if (raw.startsWith("stremio://")) raw = "https://" + raw.slice("stremio://".length);
  raw = raw.replace(/\/#\/configure\/?$/, "");
  raw = raw.replace(/\/configure\/?$/, "");
  raw = raw.replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(raw)) {
    return { kind: "error", message: "URL must start with https:// or stremio://" };
  }
  if (!/manifest\.json(\?.*)?$/i.test(raw)) {
    raw = raw + "/manifest.json";
  }
  try {
    new URL(raw);
  } catch {
    return { kind: "error", message: "That doesn't look like a valid URL." };
  }
  // Mirrors the user_addons.addon_url check constraint. Comet and AIOStreams
  // bake a base64 config blob into the path; past ~2704 bytes the server's btree
  // index rejects the row, which would surface as a non-auth failure and retry
  // forever. Fail here, where the message can actually say what is wrong.
  if (raw.length > MAX_ADDON_URL_LENGTH) {
    return {
      kind: "error",
      message: `That manifest URL is too long (${raw.length} characters, limit ${MAX_ADDON_URL_LENGTH}). Reconfigure the addon with fewer options.`,
    };
  }
  return { kind: "ok", url: raw };
}

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
  options: { replaceId?: string } = {},
): Promise<InstallResult> {
  const parsed = parseAddonUrl(rawUrl);
  if (parsed.kind === "error") throw new Error(parsed.message);
  const manifest = await fetchManifestAt(parsed.url);
  const id = manifest.id;
  const before = loadInstalled();
  const replaceId = options.replaceId && options.replaceId !== id ? options.replaceId : null;
  const replacedById = before.some((a) => a.id === id);
  const replacedByOld = replaceId != null && before.some((a) => a.id === replaceId);
  // A reconfiguration changes the URL, so carry the old row's enabled state and
  // position across instead of silently resetting both.
  const previous =
    before.find((a) => a.transportUrl === parsed.url) ??
    (replaceId ? before.find((a) => a.id === replaceId) : undefined) ??
    before.find((a) => a.id === id);
  const next = before.filter(
    (a) => a.transportUrl !== parsed.url && (!replaceId || a.id !== replaceId),
  );
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
  return { addon, replaced: replacedById || replacedByOld };
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
  return filterEnabled(loadInstalled()).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
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
  const entries = orderedEnabledEntries();
  if (entries.length === 0) return [];
  const results = await Promise.all(
    entries.map(async (entry): Promise<Addon | null> => {
      if (entry.manifest) {
        return { manifest: entry.manifest, transportUrl: entry.transportUrl };
      }
      try {
        const manifest = await fetchManifestAt(entry.transportUrl);
        saveInstalled(loadInstalled().map((e) => (e.id === entry.id ? { ...e, manifest } : e)));
        return { manifest, transportUrl: entry.transportUrl };
      } catch {
        return null;
      }
    }),
  );
  return results.filter((a): a is Addon => a !== null);
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
