import { meta as cinemetaMeta, type Meta } from "./cinemeta";
import { safeFetch as fetch } from "./safe-fetch";
import { addonAccepts, type Addon } from "./addons";
import { installedAddons } from "./addon-store";

const ADDON_TIMEOUT_MS = 4000;

function preferCustomMeta(): boolean {
  try {
    const raw = localStorage.getItem("harbor.settings");
    return raw ? JSON.parse(raw).preferCustomMetaAddon === true : false;
  } catch {
    return false;
  }
}

export async function resolveMeta(type: "movie" | "series", id: string): Promise<Meta | null> {
  const cinemetaPromise = cinemetaMeta(type, id).catch(() => null);

  const seen = new Set<string>();
  const candidates: Addon[] = [];
  for (const a of installedAddons()) {
    const key = a.transportUrl || a.manifest.id;
    if (seen.has(key)) continue;
    seen.add(key);
    if (addonAccepts(a, "meta", type, id) && !isCinemeta(a)) candidates.push(a);
  }

  if (candidates.length === 0) {
    return cinemetaPromise;
  }

  const addonRaces = candidates.map((a) => ({ a, p: fetchAddonMeta(a, type, id) }));

  if (preferCustomMeta()) {
    for (const { a, p } of addonRaces) {
      const result = await p;
      if (result && result.poster) return withOrigin(result, a);
    }
    return (await cinemetaPromise) ?? null;
  }

  const cinemeta = await cinemetaPromise;
  if (cinemeta && cinemeta.poster) return cinemeta;

  for (const { a, p } of addonRaces) {
    const result = await p;
    if (result && result.poster) return withOrigin(result, a);
  }

  return cinemeta ?? null;
}

function withOrigin(meta: Meta, addon: Addon): Meta {
  if (meta.addonOrigin?.base) return meta;
  const base = addon.transportUrl.replace(/\/manifest\.json$/, "");
  return {
    ...meta,
    addonOrigin: {
      id: addon.manifest.id,
      name: addon.manifest.name ?? addon.manifest.id,
      logo: addon.manifest.logo,
      base,
    },
  };
}

function isCinemeta(addon: Addon): boolean {
  const id = (addon.manifest.id ?? "").toLowerCase();
  const url = (addon.transportUrl ?? "").toLowerCase();
  return id.includes("cinemeta") || url.includes("v3-cinemeta") || url.includes("cinemeta.strem");
}

async function fetchAddonMeta(addon: Addon, type: string, id: string): Promise<Meta | null> {
  const base = addon.transportUrl.replace(/\/manifest\.json$/, "");
  const url = `${base}/meta/${type}/${id}.json`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ADDON_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok) return null;
    const json = (await res.json()) as { meta?: Meta };
    return json.meta ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
