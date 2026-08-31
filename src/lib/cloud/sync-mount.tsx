import { useEffect } from "react";
import { readTracking } from "@/lib/library-tracking";
import { useProfiles } from "@/lib/profiles";
import { readLocalEntries } from "@/lib/watchlist";
import { supabaseConfigured } from "@/lib/supabase";
import { useCloudSession } from "./session";
import { hydrateFromCloud } from "./hydrate";
import { beginCloudSync, endCloudSync, primeSnapshots } from "./mirror";
import { flush } from "./queue";

/**
 * Binds the library stores to the signed-in user's cloud rows. Modelled on
 * WatchlistSync: renders nothing, reacts to the owner changing.
 */
export function CloudSync() {
  const { userId, status, offline } = useCloudSession();
  const { activeId } = useProfiles();
  const profileId = activeId ?? "default";

  useEffect(() => {
    if (!supabaseConfigured) return;
    if (status !== "signed-in" || !userId) {
      endCloudSync();
      return;
    }

    const owner = { userId, profileId };
    beginCloudSync(owner);
    // Prime from what is on disk right now: an edit made before the pull lands
    // must diff against local truth, not an empty baseline that would re-upload
    // the whole library. hydrateFromCloud re-primes once the merge is applied.
    primeSnapshots(readLocalEntries(), readTracking());

    let cancelled = false;
    // Offline: keep mirroring into the durable queue, but skip the pull that
    // is guaranteed to fail. flush() drains it once the network returns.
    if (offline) {
      void flush();
    } else {
      hydrateFromCloud(owner).catch((err: unknown) => {
        if (cancelled) return;
        console.warn("[cloud] hydrate failed; running on local data", err);
      });
    }

    return () => {
      cancelled = true;
      endCloudSync();
    };
  }, [userId, profileId, status, offline]);

  // Best-effort drain so a close does not strand the last few edits.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    window.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", onHide);
    return () => {
      window.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", onHide);
    };
  }, []);

  return null;
}
