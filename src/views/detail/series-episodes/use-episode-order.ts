import { useEffect, useState } from "react";
import { tmdbLanguageIso } from "@/lib/providers/tmdb/tmdb-client";
import { tvdbLangFromIso1 } from "@/lib/providers/tvdb";
import { fetchTvdbOrder, type TvdbOrder } from "@/lib/providers/tvdb-order";

export function useEpisodeOrder(
  imdbId: string | null,
  metaId: string,
  provider: "default" | "tmdb" | "tvdb",
  seasonType: string,
  tvdbKey: string,
): TvdbOrder | null {
  const [order, setOrder] = useState<TvdbOrder | null>(null);
  const remoteId =
    imdbId && imdbId.startsWith("tt")
      ? imdbId
      : metaId.startsWith("tmdb:tv:")
        ? metaId.slice(8)
        : null;
  const active = provider === "tvdb" && !!remoteId;

  useEffect(() => {
    if (!active || !remoteId) {
      setOrder(null);
      return;
    }
    let cancelled = false;
    const lang = tvdbLangFromIso1(tmdbLanguageIso());
    void fetchTvdbOrder(tvdbKey, remoteId, seasonType, lang)
      .catch(() => null)
      .then((o) => {
        if (!cancelled) setOrder(o);
      });
    return () => {
      cancelled = true;
    };
  }, [active, remoteId, tvdbKey, seasonType]);

  return active ? order : null;
}
