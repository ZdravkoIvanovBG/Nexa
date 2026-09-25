import { useEffect, useRef } from "react";
import type { PlayerSnapshot } from "@/lib/player/bridge";
import type { PlayerSrc, PlayerStreamRef } from "@/lib/view";
import { SHORT_PLAYBACK_SEC } from "@/lib/dead-streams";

export function useStubDetection(params: {
  src: PlayerSrc;
  snap: PlayerSnapshot;
  onStub: () => void;
  instantPlay: boolean;
  // The stream actually playing -- src.url/src.streamRef unless the user
  // has manually swapped via Switch Stream. Without this, a stub found
  // after a manual swap would fingerprint and mark dead the ORIGINAL
  // auto-picked stream instead of the one actually short.
  effectiveUrl: string;
  effectiveStreamRef: PlayerStreamRef | undefined;
}) {
  const { src, snap, onStub, instantPlay, effectiveUrl, effectiveStreamRef } = params;
  const stubCheckedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!instantPlay) return;
    if (stubCheckedRef.current === effectiveUrl) return;
    if (src.meta.id?.startsWith("iptv:")) return;
    const metaType = String(src.meta.type ?? "").toLowerCase();
    if (metaType && !["movie", "series", "anime"].includes(metaType)) return;
    if (/\.m3u8(\?|#|$)/i.test(effectiveUrl)) return;
    if (snap.durationSec <= 0 || snap.durationSec >= SHORT_PLAYBACK_SEC) return;
    if (snap.status !== "playing") return;
    stubCheckedRef.current = effectiveUrl;
    const runtimeMin = src.meta.runtime ? parseInt(src.meta.runtime, 10) : null;
    const isAnime = src.meta.id?.startsWith("kitsu:") || src.meta.id?.startsWith("mal:");
    void import("@/lib/dead-streams").then(
      ({ shouldFlagAsStub, markStreamDead, recordStubEvent, STUB_TTL_MS }) => {
        const flag = shouldFlagAsStub({
          durationSec: snap.durationSec,
          runtimeMinutes: runtimeMin,
          isAnime,
          bytesAdvertised: effectiveStreamRef?.size ?? null,
        });
        if (!flag) return;
        const sf = {
          infoHash: effectiveStreamRef?.infoHash ?? undefined,
          fileIdx: undefined,
          url: effectiveUrl,
          addonId: effectiveStreamRef?.addonId ?? "",
          title: effectiveStreamRef?.title ?? src.title,
        };
        const reason = `stub_${Math.round(snap.durationSec)}s`;
        markStreamDead(sf, reason, STUB_TTL_MS);
        recordStubEvent(reason);
        console.warn(
          `[player] stub detected (${Math.round(snap.durationSec)}s); returning to picker`,
        );
        onStub();
      },
    );
  }, [
    instantPlay,
    snap.durationSec,
    snap.status,
    effectiveUrl,
    src.meta,
    effectiveStreamRef,
    src.title,
  ]);
}
