import { useEffect, useSyncExternalStore } from "react";
import { readTracking } from "@/lib/library-tracking";
import { loadInstalled } from "@/lib/addon-store";
import {
  ensureLocalProfile,
  loadProfiles,
  profilesAwaitingCloudRoster,
  subscribeProfiles,
  useProfiles,
} from "@/lib/profiles";
import { readLocalEntries } from "@/lib/watchlist";
import { settleOnboarding } from "@/lib/onboarding";
import { supabaseConfigured } from "@/lib/supabase";
import { useCloudSession } from "./session";
import { hydrateFromCloud, hydrateProfilesFromCloud } from "./hydrate";
import {
  beginCloudSync,
  beginProfilesSync,
  endCloudSync,
  endProfilesSync,
  primeAddonSnapshot,
  primeProfilesSnapshot,
  primeSnapshots,
} from "./mirror";
import { flush } from "./queue";

/**
 * Binds the library stores to the signed-in user's cloud rows. Modelled on
 * WatchlistSync: renders nothing, reacts to the owner changing.
 */
export function CloudSync() {
  const { userId, status, offline } = useCloudSession();
  const { activeId } = useProfiles();
  const awaitingRoster = useSyncExternalStore(
    subscribeProfiles,
    profilesAwaitingCloudRoster,
    profilesAwaitingCloudRoster,
  );
  const profileId = activeId ?? "default";

  useEffect(() => {
    if (!supabaseConfigured) return;
    if (status !== "signed-in" || !userId) {
      endCloudSync();
      return;
    }
    // The roster is still inbound, so `profileId` is the "default" placeholder
    // rather than a real profile. Syncing this user's library under that scope
    // would pull and upload against a profile that does not exist.
    if (awaitingRoster) return;

    const owner = { userId, profileId };
    beginCloudSync(owner);
    // Prime from what is on disk right now: an edit made before the pull lands
    // must diff against local truth, not an empty baseline that would re-upload
    // the whole library. hydrateFromCloud re-primes once the merge is applied.
    primeSnapshots(readLocalEntries(), readTracking());
    primeAddonSnapshot(loadInstalled());

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
  }, [userId, profileId, status, offline, awaitingRoster]);

  // Profiles sync at the account level -- independent of which local profile
  // is active, and it must not re-run on every profile switch.
  useEffect(() => {
    if (!supabaseConfigured) {
      ensureLocalProfile();
      settleOnboarding();
      return;
    }
    if (status !== "signed-in" || !userId) {
      endProfilesSync();
      // Signed out for good: no roster is coming, so stop waiting on one.
      // The onboarding wizard deliberately keeps holding: the login gate is
      // covering the screen anyway, and the account about to sign in is the
      // one that decides whether the wizard is warranted.
      if (status === "signed-out") ensureLocalProfile();
      return;
    }

    beginProfilesSync(userId);
    primeProfilesSnapshot(loadProfiles());

    let cancelled = false;
    if (offline) {
      // No pull is possible, so the local roster is all we have.
      ensureLocalProfile();
      settleOnboarding();
      void flush();
    } else {
      hydrateProfilesFromCloud(userId).catch((err: unknown) => {
        if (cancelled) return;
        if ((err as { code?: string } | null)?.code === "42P01") {
          console.error(
            "[cloud] the `profiles` table does not exist in this Supabase project. Profiles " +
              "cannot sync until it is created -- run the profiles table + RLS migration.",
            err,
          );
        } else {
          console.warn("[cloud] profiles hydrate failed; running on local data", err);
        }
        // The pull is not coming. Fall back so the app is not left profileless.
        ensureLocalProfile();
        settleOnboarding();
      });
    }

    return () => {
      cancelled = true;
      endProfilesSync();
    };
  }, [userId, status, offline]);

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
