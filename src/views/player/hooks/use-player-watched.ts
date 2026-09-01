import { useEffect, useState, useSyncExternalStore } from "react";
import type { Meta } from "@/lib/cinemeta";
import { getEpisodeProgress } from "@/lib/episode-progress";
import { manualWatchedVersion, subscribeManualWatched } from "@/lib/manual-watched";
import { loadSimklWatchedMap, simklWatchedForId } from "@/lib/simkl/list-status";
import { useSimkl } from "@/lib/simkl/provider";
import { fetchWatchedKeySet } from "@/lib/trakt/history";
import { useTrakt } from "@/lib/trakt/provider";
import type { PlayEpisode } from "@/lib/view";

export function usePlayerWatched(params: { meta: Meta; imdbId: string | null; enabled: boolean }): {
  watchedFor: (ep: PlayEpisode) => boolean;
} {
  const { meta, imdbId, enabled } = params;
  const { isConnected: traktConnected } = useTrakt();
  const { isConnected: simklConnected } = useSimkl();
  useSyncExternalStore(subscribeManualWatched, manualWatchedVersion);
  const [traktWatched, setTraktWatched] = useState<Set<string>>(() => new Set());
  const [simklWatched, setSimklWatched] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!enabled || !traktConnected) return;
    let cancelled = false;
    fetchWatchedKeySet()
      .then((s) => {
        if (!cancelled) setTraktWatched(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled, traktConnected, meta.id]);

  useEffect(() => {
    if (!enabled || !simklConnected) return;
    let cancelled = false;
    loadSimklWatchedMap()
      .then((m) => {
        if (!cancelled) setSimklWatched(simklWatchedForId(m, imdbId, meta.id));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled, simklConnected, meta.id, imdbId]);

  const imdbKey = meta.id.startsWith("tt") ? meta.id : imdbId;
  const watchedFor = (ep: PlayEpisode): boolean =>
    getEpisodeProgress(
      meta.id,
      ep.season,
      ep.episode,
      null,
      imdbKey,
      traktWatched,
      undefined,
      undefined,
      simklWatched,
    ).watched;

  return { watchedFor };
}
