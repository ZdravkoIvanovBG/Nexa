import { useEffect, useRef, useSyncExternalStore } from "react";
import { profilesAwaitingCloudRoster, subscribeProfiles, useProfiles } from "@/lib/profiles";
import { settingsScopeOf } from "@/lib/settings/profile-store";
import { useSettings } from "@/lib/settings";
import {
  resetForProfile as resetSimkl,
  subscribeSession as subscribeSimkl,
} from "@/lib/simkl/session";
import { resetForProfile as resetSimklCache } from "@/lib/simkl/activities/store";
import {
  resetForProfile as resetTrakt,
  subscribeSession as subscribeTrakt,
} from "@/lib/trakt/session";
import { subscribeOnboarding } from "@/lib/onboarding";
import { useCloudSession } from "./session";
import { hydrateSettingsFromCloud, readLocalSettingsBlob } from "./hydrate";
import { mirrorSideStores, primeSettingsSnapshot } from "./mirror";
import { collectSideStores, serializeSideStores } from "./side-stores";

/**
 * Binds the settings (API keys included) and the tracker credential stores to
 * the signed-in user's cloud copy. Separate from CloudSync: it needs to know
 * which profile is active and whether its settings are linked or independent,
 * which is only settled once the profile roster has finished hydrating.
 */
export function SettingsCloudSync() {
  const { userId, status, offline } = useCloudSession();
  const { activeProfile } = useProfiles();
  const { reloadFromStorage } = useSettings();
  const awaitingRoster = useSyncExternalStore(
    subscribeProfiles,
    profilesAwaitingCloudRoster,
    profilesAwaitingCloudRoster,
  );
  // The roster re-renders on every mirrored write, so the effect below can be
  // re-entered with the same scope it just pulled. One pull per (account,
  // scope) per session is enough -- repeating it would re-apply the cloud copy
  // over an edit made in the meantime.
  const pulledRef = useRef<string | null>(null);

  const scope =
    !awaitingRoster && activeProfile
      ? settingsScopeOf(activeProfile.id, activeProfile.settingsLinked !== false)
      : null;

  useEffect(() => {
    if (status !== "signed-in" || !userId || scope == null) return;

    // No pull is possible offline, so take the local copy as the baseline:
    // that opens mirroring for the scope, and the queue drains when the
    // network returns. With nothing stored locally there is no edit to
    // defend and no way to know what the cloud holds, so mirroring stays
    // shut rather than risking a blank blob reaching the server first.
    if (offline) {
      const local = readLocalSettingsBlob(scope);
      if (local != null) {
        primeSettingsSnapshot(scope, local, serializeSideStores(collectSideStores()));
      }
      return;
    }

    const token = `${userId}|${scope}`;
    if (pulledRef.current === token) return;
    pulledRef.current = token;

    let cancelled = false;
    hydrateSettingsFromCloud(userId, scope)
      .then((applied) => {
        if (cancelled) return;
        // These stores read their keys once at mount; the pull just changed
        // those keys underneath them, so tell them to look again rather than
        // making the user restart to see their keys and tracker logins.
        if (applied.settings) reloadFromStorage();
        if (applied.sideStores) {
          resetTrakt();
          resetSimkl();
          resetSimklCache();
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // Let a failed pull be retried rather than pinning the scope as done.
        if (pulledRef.current === token) pulledRef.current = null;
        if ((err as { code?: string } | null)?.code === "42P01") {
          console.error(
            "[cloud] the `user_settings` table does not exist in this Supabase project. " +
              "Settings (including API keys) cannot sync until it is created -- run the " +
              "user_settings table + RLS migration.",
            err,
          );
        } else {
          console.warn("[cloud] settings hydrate failed; running on local data", err);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [userId, status, offline, scope, reloadFromStorage]);

  // Connecting a tracker, finishing the wizard or dismissing a nudge writes
  // only that store's own key, which no settings write would ever notice.
  useEffect(() => {
    if (status !== "signed-in" || !userId || scope == null) return;
    const push = () => mirrorSideStores(scope);
    const unsubTrakt = subscribeTrakt(push);
    const unsubSimkl = subscribeSimkl(push);
    const unsubOnboarding = subscribeOnboarding(push);
    return () => {
      unsubTrakt();
      unsubSimkl();
      unsubOnboarding();
    };
  }, [userId, status, scope]);

  return null;
}
