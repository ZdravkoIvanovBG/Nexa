import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { preloadCatalogPage } from "@/lib/catalog-page";
import { fetchAddonsDirectory, fetchInstalledAddonsList } from "@/lib/addons-store/store";
import { recentlyPlayed } from "@/lib/playback-history";
import { queryKeys } from "@/lib/query/keys";
import { useSettings } from "@/lib/settings";
import type { Settings } from "@/lib/settings/types";
import { useProfiles } from "@/lib/profiles";
import { prefetchDiscoverPage } from "@/views/discover/discover-queries";
import { kidsSpecs } from "@/views/kids/kids-specs";
import { buildMovieHero, movieSpecs } from "@/views/movies/movie-specs";
import { buildShowHero } from "@/views/shows/hero-curation";
import { showSpecs } from "@/views/shows/show-specs";

/** Rows warmed per page on intent/idle preload. */
const PRELOAD_LIMIT = 8;

/** Preload one nav page's first rows into TanStack Query (hover / focus / idle). */
export function preloadNavPage(
  queryClient: ReturnType<typeof useQueryClient>,
  view: string,
  tmdbKey: string,
  region: string,
  profileId: string | null = null,
  settings?: Settings,
): void {
  if (view === "discover") {
    if (settings) prefetchDiscoverPage(queryClient, settings);
    return;
  }
  if (view === "addons") {
    void queryClient.prefetchQuery({
      queryKey: queryKeys.addons.installed(profileId),
      queryFn: fetchInstalledAddonsList,
      staleTime: 60_000,
    });
    void queryClient.prefetchQuery({
      queryKey: queryKeys.addons.directory(),
      queryFn: fetchAddonsDirectory,
      staleTime: 60 * 60_000,
    });
    return;
  }
  if (!tmdbKey) return;
  const scope = `tmdb:${tmdbKey}:${region}`;
  if (view === "movies") {
    void preloadCatalogPage(queryClient, {
      pageId: "movies",
      scope,
      specs: movieSpecs(tmdbKey, region),
      heroFetcher: () => buildMovieHero(tmdbKey, recentlyPlayed()),
      limit: PRELOAD_LIMIT,
    });
  } else if (view === "shows") {
    void preloadCatalogPage(queryClient, {
      pageId: "shows",
      scope,
      specs: showSpecs(tmdbKey),
      heroFetcher: () => buildShowHero(tmdbKey),
      limit: PRELOAD_LIMIT,
    });
  } else if (view === "kids") {
    void preloadCatalogPage(queryClient, {
      pageId: "kids",
      scope: `tmdb:${tmdbKey}`,
      specs: kidsSpecs(tmdbKey),
      limit: PRELOAD_LIMIT,
    });
  }
}

const WARM_VIEWS = ["discover", "movies", "shows", "kids"] as const;

/** Idle warmup so the main catalog routes paint from cache on first open. */
export function useIdlePagePrefetch() {
  const { settings } = useSettings();
  const { activeId: profileId } = useProfiles();
  const queryClient = useQueryClient();
  const tmdbKey = settings.tmdbKey;
  const region = settings.region;

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    const win = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };

    const run = () => {
      if (cancelled) return;
      for (const view of WARM_VIEWS)
        preloadNavPage(queryClient, view, tmdbKey, region, profileId, settings);
    };

    const id =
      typeof win.requestIdleCallback === "function"
        ? win.requestIdleCallback(run, { timeout: 2500 })
        : window.setTimeout(run, 900);

    return () => {
      cancelled = true;
      if (typeof win.cancelIdleCallback === "function" && typeof id === "number") {
        win.cancelIdleCallback(id);
      } else {
        window.clearTimeout(id);
      }
    };
  }, [tmdbKey, region, queryClient, profileId, settings]);
}
