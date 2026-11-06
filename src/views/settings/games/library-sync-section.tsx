import { CloudCheck, CloudOff, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCloudSession } from "@/lib/cloud/session";
import { gamesFeatureEnabled } from "@/lib/game-discovery/gates";
import {
  gameSyncState,
  gameSyncSummary,
  type GameSyncState,
  type GameSyncSummary,
} from "@/lib/game-library/backup-state";
import { useT } from "@/lib/i18n";
import { loadProfiles, useProfiles } from "@/lib/profiles";
import { useSettings } from "@/lib/settings";
import { readCachedSupabaseUserId, supabaseConfigured } from "@/lib/supabase";
import { Section } from "../shared";

// Game Library sync status (IGDB Stage 7): the reliable way to confirm that
// the cloud has every game change on this device before updating, reinstalling,
// switching between development and release builds, or going back to an older
// Nexa. An older Nexa can't be made to keep data it doesn't understand, but
// once this says "synced" the cloud holds everything, and no older build ever
// deletes or changes game rows in the cloud.
//
// Reading the status is a localStorage check. "Sync now" runs the normal
// Game Library sync (one pull and the queued uploads) for each of this
// account's profiles with game data on this device. Nothing polls.

const BUTTON =
  "flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-edge px-3 text-[12.5px] text-ink-muted transition-colors hover:bg-elevated hover:text-ink disabled:opacity-60";

type Result = "ok" | "incomplete" | null;

export function LibrarySyncSection() {
  const t = useT();
  const { settings } = useSettings();
  const { userId, status, offline } = useCloudSession();
  const { activeId } = useProfiles();
  const signedIn = supabaseConfigured && status === "signed-in" && !!userId;
  const [summary, setSummary] = useState<GameSyncSummary>(() => gameSyncSummary(userId));
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);
  const mounted = useRef(true);

  const recheck = useCallback(() => {
    if (!mounted.current) return;
    setSummary(gameSyncSummary(userId));
  }, [userId]);

  // Follow library changes while this section is open. The store module is
  // loaded only here and by the Game Library itself.
  useEffect(() => {
    mounted.current = true;
    recheck();
    let unsubscribe: (() => void) | null = null;
    let live = true;
    void import("@/lib/game-library/cloud/client").then(({ gameStore, gameQueue }) => {
      if (!live) return;
      setBlocked(gameQueue.isBlocked());
      unsubscribe = gameStore.subscribe(recheck);
    });
    window.addEventListener("focus", recheck);
    return () => {
      live = false;
      mounted.current = false;
      unsubscribe?.();
      window.removeEventListener("focus", recheck);
    };
  }, [recheck]);

  useEffect(() => {
    if (!result) return;
    const timer = window.setTimeout(() => setResult(null), 4000);
    return () => window.clearTimeout(timer);
  }, [result]);

  const state: GameSyncState = gameSyncState({
    cloud: supabaseConfigured,
    signedIn,
    offline,
    blocked,
    summary,
  });

  // Nothing to say to someone who has never used the Game Library here.
  if (state === "empty" && !gamesFeatureEnabled(settings)) return null;

  const syncNow = async () => {
    if (busy || !userId || !signedIn || offline) return;
    setBusy(true);
    setResult(null);
    try {
      const { syncGameLibrary, gameQueue } = await import("@/lib/game-library/cloud/client");
      const isCurrent = () => readCachedSupabaseUserId() === userId;
      // Kid profiles can't open Games, so their libraries aren't synced from here either.
      const roster = new Set(
        loadProfiles()
          .filter((p) => !p.kid)
          .map((p) => p.id),
      );
      const profiles = gameSyncSummary(userId).profiles.filter((id) => roster.has(id));
      if (activeId && roster.has(activeId) && !profiles.includes(activeId)) {
        profiles.unshift(activeId);
      }
      for (const profileId of profiles) {
        if (!isCurrent()) break;
        await syncGameLibrary(
          { userId, profileId },
          { isCurrent, force: true, adoptPlaceholders: profileId === activeId },
        );
      }
      await gameQueue.drain();
      if (!mounted.current) return;
      setBlocked(gameQueue.isBlocked());
      const after = gameSyncSummary(userId);
      setSummary(after);
      setResult(after.unsynced.length === 0 && after.queued === 0 ? "ok" : "incomplete");
    } catch {
      if (mounted.current) setResult("incomplete");
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const others = summary.unsynced.filter((id) => id !== activeId).length;
  const line: { tone: "ok" | "warn" | "muted"; text: string } = (() => {
    switch (state) {
      case "empty":
        return { tone: "muted", text: t("There are no saved games on this device yet.") };
      case "synced":
        return {
          tone: "ok",
          text: t(
            "Everything is synced. Your Nexa account has every game change from this device.",
          ),
        };
      case "local-only":
        return {
          tone: "warn",
          text: t(
            "You're not signed in, so your saved games are only on this device. Sign in to back them up to your Nexa account.",
          ),
        };
      case "offline":
        return {
          tone: "warn",
          text: t(
            "Some game changes haven't reached your Nexa account yet. They'll upload when you're back online.",
          ),
        };
      case "blocked":
        return {
          tone: "warn",
          text: t(
            "Your Nexa account can't store game data right now, so your saved games stay on this device. Nexa keeps trying after a restart.",
          ),
        };
      case "unreadable":
        return {
          tone: "warn",
          text: t("Nexa couldn't read this device's game data, so it can't confirm it's synced."),
        };
      case "pending":
        return {
          tone: "warn",
          text:
            others > 0
              ? t(
                  "Some game changes haven't reached your Nexa account yet, including changes in {count} other profile(s) on this device. Sync now to send them.",
                  { count: others },
                )
              : t(
                  "Some game changes haven't reached your Nexa account yet. Sync now to send them.",
                ),
        };
    }
  })();

  const canSync = signedIn && !offline && state !== "empty" && state !== "unreadable";

  return (
    <Section
      title={t("Game Library sync")}
      subtitle={t(
        "Before you update, reinstall or go back to an older version of Nexa, or switch to a different Nexa build, make sure this says everything is synced. Older versions can't show every saved game and may remove what they don't understand from this device, but they never change your saved games in your Nexa account.",
      )}
    >
      <div className="flex items-start gap-3 rounded-2xl border border-edge bg-elevated px-4 py-3">
        <span
          className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-canvas ring-1 ring-edge-soft ${
            line.tone === "ok"
              ? "text-accent"
              : line.tone === "warn"
                ? "text-amber-300"
                : "text-ink-subtle"
          }`}
        >
          {line.tone === "ok" ? <CloudCheck size={14} /> : <CloudOff size={14} />}
        </span>
        <p role="status" className="text-[13px] leading-relaxed text-ink">
          {line.text}
        </p>
      </div>
      {result === "incomplete" && !busy && (
        <p role="alert" className="text-[12.5px] leading-relaxed text-danger">
          {t(
            "Not everything could be synced. Your games are still safe on this device. Check your connection and try again.",
          )}
        </p>
      )}
      {result === "ok" && !busy && (
        <p className="text-[12.5px] leading-relaxed text-accent">{t("Sync complete.")}</p>
      )}
      {canSync && (
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => void syncNow()} disabled={busy} className={BUTTON}>
            {busy ? (
              <Loader2 size={13} strokeWidth={1.9} className="animate-spin" />
            ) : (
              <RefreshCw size={13} strokeWidth={1.9} />
            )}
            {busy ? t("Syncing…") : t("Sync now")}
          </button>
        </div>
      )}
    </Section>
  );
}
