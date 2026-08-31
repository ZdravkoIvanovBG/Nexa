import { useEffect, useState } from "react";
import { fetchManifestAt, installedAddons, installedAddonsResolved } from "@/lib/addon-store";
import { torboxAddonFor, withDebridKeys, type Addon } from "@/lib/addons";
import { withTimeout } from "@/lib/progressive-rows";
import type { useSettings } from "@/lib/settings";

type Settings = ReturnType<typeof useSettings>["settings"];
const ADDON_DISCOVERY_TIMEOUT_MS = 10_000;

function hasAnyResources(a: Addon): boolean {
  return (a.manifest.resources ?? []).length > 0;
}

function declaresStream(a: Addon): boolean {
  return (a.manifest.resources ?? []).some((r) =>
    typeof r === "string" ? r === "stream" : r.name === "stream",
  );
}

async function resolveManifests(addons: Addon[]): Promise<Addon[]> {
  return Promise.all(
    addons.map(async (a) => {
      if (hasAnyResources(a)) return a;
      const manifest = await withTimeout(
        fetchManifestAt(a.transportUrl),
        ADDON_DISCOVERY_TIMEOUT_MS,
      ).catch(() => null);
      return manifest ? { ...a, manifest } : a;
    }),
  );
}

export function useAddons(settings: Settings): {
  addons: Addon[];
  discovering: boolean;
  userHasStreamAddons: boolean;
} {
  const [addons, setAddons] = useState<Addon[]>(() => installedAddons());
  const [discovering, setDiscovering] = useState(true);
  const [userHasStreamAddons, setUserHasStreamAddons] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const debridKeys = {
      rdKey: settings.rdKey,
      tbKey: settings.tbKey,
      adKey: settings.adKey,
      pmKey: settings.pmKey,
      dlKey: settings.dlKey,
    };
    const torbox = torboxAddonFor(settings.tbKey);
    void Promise.resolve().then(() => {
      if (!cancelled) setDiscovering(true);
    });
    (async () => {
      const discovered = await withTimeout(
        installedAddonsResolved(),
        ADDON_DISCOVERY_TIMEOUT_MS,
      ).catch(() => installedAddons());
      if (cancelled) return;
      // installedAddonsResolved already filters to enabled and applies display
      // order; this only backfills manifests that arrived without resources.
      const merged = await resolveManifests(discovered);
      if (cancelled) return;
      const userStreamCount = merged.filter(declaresStream).length;
      setUserHasStreamAddons(userStreamCount > 0);
      const list = withDebridKeys(merged, debridKeys);
      const existingTorboxIdx = list.findIndex(
        (a) =>
          a.manifest.id === "app.torbox.stremio" || a.transportUrl?.includes("stremio.torbox.app"),
      );
      console.info(
        `[picker] tbKey=${settings.tbKey ? `set(${settings.tbKey.slice(0, 8)}…)` : "EMPTY"} installed=${merged.length} userStreamCount=${userStreamCount} hasTorbox=${existingTorboxIdx >= 0} torboxAutoAddable=${!!torbox}`,
      );
      if (torbox) {
        if (existingTorboxIdx >= 0) {
          const existing = list[existingTorboxIdx];
          if (existing.transportUrl !== torbox.transportUrl) {
            console.info(
              `[picker] overriding stale TorBox URL: ${existing.transportUrl} → ${torbox.transportUrl}`,
            );
            list[existingTorboxIdx] = torbox;
          }
        } else {
          console.info(`[picker] auto-adding TorBox addon: ${torbox.transportUrl}`);
          list.push(torbox);
        }
      }
      console.info(
        `[picker] final addon list (${list.length}): ${list.map((a) => a.manifest.name).join(", ")}`,
      );
      setAddons(list);
    })().finally(() => {
      if (!cancelled) setDiscovering(false);
    });
    return () => {
      cancelled = true;
    };
  }, [settings.rdKey, settings.tbKey, settings.adKey, settings.pmKey, settings.dlKey]);

  return { addons, discovering, userHasStreamAddons };
}
