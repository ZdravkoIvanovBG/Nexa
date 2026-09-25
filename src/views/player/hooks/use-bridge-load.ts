import { useEffect, useRef, useState, type RefObject } from "react";
import type { PlayerBridge } from "@/lib/player/bridge";
import { readResumeMs } from "@/lib/resume";
import type { PlayerSrc } from "@/lib/view";
import { useSettings } from "@/lib/settings";

const RESUME_PROMPT_MIN_SEC = 30;
const RESTART_THRESHOLD = 0.8;

export function useBridgeLoad(params: {
  bridgeRef: RefObject<PlayerBridge | null>;
  inRoomRef: RefObject<boolean>;
  isHostRef: RefObject<boolean>;
  bridgeReady: boolean;
  bridgeKey: string;
  src: PlayerSrc;
  // The stream actually playing right now -- src.url unless the user has
  // manually swapped via the in-player Switch Stream overlay, in which case
  // this is the swapped stream's URL. Without this, a load fired by an
  // unrelated bridgeKey change (SVP toggle, embed toggle, html5->mpv
  // fallback) would silently revert playback to the original auto-picked
  // stream instead of reloading the one the user chose.
  effectiveUrl: string;
  transcodedUrl: string | null;
  season: number | undefined;
  episode: number | undefined;
}): {
  pendingResumeSec: number | null;
  acknowledgeResume: (action: "resume" | "start-over") => void;
  pendingSeekSec: number | null;
  clearPendingSeek: () => void;
} {
  const {
    bridgeRef,
    inRoomRef,
    isHostRef,
    bridgeReady,
    bridgeKey,
    src,
    effectiveUrl,
    transcodedUrl,
    season,
    episode,
  } = params;

  const { settings } = useSettings();
  const resumePromptRef = useRef(settings.resumePrompt);
  resumePromptRef.current = settings.resumePrompt;
  const resumePlaybackRef = useRef(settings.resumePlayback);
  resumePlaybackRef.current = settings.resumePlayback;

  const lastLoadedUrlRef = useRef<string | null>(null);
  const firstLoadRef = useRef(true);
  const [pendingResumeSec, setPendingResumeSec] = useState<number | null>(null);
  const [pendingSeekSec, setPendingSeekSec] = useState<number | null>(null);
  const ackRef = useRef<((action: "resume" | "start-over") => void) | null>(null);

  useEffect(() => {
    if (!bridgeReady) return;
    const bridge = bridgeRef.current;
    if (!bridge) return;
    const playUrl = transcodedUrl ?? effectiveUrl;
    const loadKey = `${playUrl}|s${season ?? ""}e${episode ?? ""}`;
    if (lastLoadedUrlRef.current === loadKey) return;
    lastLoadedUrlRef.current = loadKey;
    const isFirstLoad = firstLoadRef.current;
    firstLoadRef.current = false;
    const isAutoRetry = (src.attempt ?? 0) > 0;
    const isLive =
      !!src.meta.id?.startsWith("iptv:") ||
      (!!src.meta.type &&
        !["movie", "series", "anime"].includes(String(src.meta.type).toLowerCase()));
    let cancelled = false;
    (async () => {
      const resolved =
        isLive || src.startFromZero
          ? { ms: 0, fromRemote: false, finished: false }
          : resolveStartMs(src.meta.id, season, episode);
      const startMs = resolved.ms;
      const runtimeMin = src.episode?.runtime ?? null;
      const durationMs = runtimeMin && runtimeMin > 0 ? runtimeMin * 60_000 : 0;
      const finishedNearEnd =
        resolved.finished || (durationMs > 0 && startMs / durationMs >= RESTART_THRESHOLD);
      const startSec = (!resumePlaybackRef.current || finishedNearEnd ? 0 : startMs) / 1000;
      const guestInRoom = inRoomRef.current && !isHostRef.current;
      const eligibleForPrompt =
        isFirstLoad &&
        !isAutoRetry &&
        !isLive &&
        resumePromptRef.current &&
        startSec > RESUME_PROMPT_MIN_SEC &&
        !guestInRoom;
      try {
        await bridge.load({
          url: playUrl,
          subtitles: src.subtitles,
          notWebReady: src.notWebReady,
          isLive,
          headers: src.headers,
          startAtSec: guestInRoom
            ? undefined
            : eligibleForPrompt
              ? undefined
              : startSec > 5
                ? startSec
                : isFirstLoad
                  ? undefined
                  : 0,
        });
      } catch (e) {
        if (cancelled) return;
        console.warn("[player] load failed", e);
        return;
      }
      if (cancelled) return;
      if (!eligibleForPrompt && !guestInRoom && startSec > 5) {
        let unsub: (() => void) | null = null;
        let synced = false;
        const stop = () => {
          synced = true;
          unsub?.();
        };
        unsub = bridge.subscribe((s) => {
          if (cancelled) {
            stop();
            return;
          }
          if (s.durationSec <= 0) return;
          stop();
          if (startSec >= s.durationSec - 20) bridge.seek(0);
        });
        if (synced) unsub?.();
      }
      if (eligibleForPrompt) {
        bridge.pause();
        setPendingResumeSec(startSec);
        ackRef.current = (action) => {
          ackRef.current = null;
          setPendingResumeSec(null);
          if (action === "resume") {
            setPendingSeekSec(startSec);
          } else {
            setPendingSeekSec(0);
          }
        };
        return;
      }
      if (!inRoomRef.current) {
        bridge.play().catch(() => {});
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    bridgeReady,
    bridgeKey,
    effectiveUrl,
    src.notWebReady,
    src.meta.id,
    src.subtitles,
    season,
    episode,
    transcodedUrl,
  ]);

  useEffect(() => {
    lastLoadedUrlRef.current = null;
  }, [bridgeKey]);

  const acknowledgeResume = (action: "resume" | "start-over") => {
    ackRef.current?.(action);
  };

  const clearPendingSeek = () => setPendingSeekSec(null);

  return { pendingResumeSec, acknowledgeResume, pendingSeekSec, clearPendingSeek };
}

function resolveStartMs(
  metaId: string,
  season: number | undefined,
  episode: number | undefined,
): { ms: number; fromRemote: boolean; finished: boolean } {
  return { ms: readResumeMs(metaId, season, episode), fromRemote: false, finished: false };
}
