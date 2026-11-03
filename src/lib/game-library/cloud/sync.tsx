import { useEffect, useSyncExternalStore } from "react";
import { useCloudSession } from "@/lib/cloud/session";
import { gamesFeatureEnabled } from "@/lib/game-discovery/gates";
import { profilesAwaitingCloudRoster, subscribeProfiles, useProfiles } from "@/lib/profiles";
import { useSettings } from "@/lib/settings";
import { supabaseConfigured } from "@/lib/supabase";
import { flushGames } from "../backup-state.ts";

// Long enough to stay clear of startup, short enough to catch up quickly.
const IDLE_TIMEOUT_MS = 4000;

const SYNC_REQUEST = "harbor:game-library-sync";

/**
 * Asks for a pull, for when the Game Library opens or regains focus, so edits
 * from another device show up. Throttled by syncGameLibrary, so asking often
 * costs nothing, and ignored whenever sync wouldn't run anyway.
 */
export function requestGameLibrarySync(): void {
  window.dispatchEvent(new Event(SYNC_REQUEST));
}

function whenIdle(run: () => void): () => void {
  const win = window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  if (typeof win.requestIdleCallback === "function") {
    const handle = win.requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
    return () => win.cancelIdleCallback?.(handle);
  }
  const handle = window.setTimeout(run, 1500);
  return () => window.clearTimeout(handle);
}

/**
 * Keeps the Game Library in step with the cloud. Renders nothing, and imports
 * the sync code only for people using Games, so it adds nothing to startup for
 * anyone else. There is no polling and no realtime channel: a device pulls when
 * it starts, changes profile or reconnects, and when the Game Library is opened
 * or focused.
 */
export function GameLibrarySync() {
  const { userId, status, offline } = useCloudSession();
  const { activeId, activeProfile } = useProfiles();
  const { settings } = useSettings();
  const awaitingRoster = useSyncExternalStore(
    subscribeProfiles,
    profilesAwaitingCloudRoster,
    profilesAwaitingCloudRoster,
  );
  const signedIn = supabaseConfigured && status === "signed-in" && !!userId && !offline;
  const gamesOn = gamesFeatureEnabled(settings);
  const isKid = !!activeProfile?.kid;

  // Not tied to Games being on: switching it off straight after an edit must
  // not strand that edit in the queue.
  useEffect(() => {
    if (!signedIn) return;
    return whenIdle(() => void flushGames().catch(() => {}));
  }, [signedIn]);

  useEffect(() => {
    if (!signedIn || !userId || !activeId || awaitingRoster || !gamesOn || isKid) return;
    const owner = { userId, profileId: activeId };
    let current = true;
    const sync = (force: boolean) => {
      void import("./client.ts")
        .then(({ syncGameLibrary }) =>
          current ? syncGameLibrary(owner, { isCurrent: () => current, force }) : undefined,
        )
        .catch(() => {});
    };
    const cancelIdle = whenIdle(() => sync(true));
    const onRequest = () => sync(false);
    window.addEventListener("online", onRequest);
    window.addEventListener(SYNC_REQUEST, onRequest);
    return () => {
      current = false;
      cancelIdle();
      window.removeEventListener("online", onRequest);
      window.removeEventListener(SYNC_REQUEST, onRequest);
    };
  }, [signedIn, userId, activeId, awaitingRoster, gamesOn, isKid]);

  return null;
}
