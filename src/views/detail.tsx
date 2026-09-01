import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Eye, HardDrive, Layers, Pencil, Play, Plus, RotateCcw, Star } from "lucide-react";
import { AwardsBlock } from "@/components/awards-block";
import { BackToTop } from "@/components/back-to-top";
import { PickCard } from "@/components/pick-card";
import { Row } from "@/components/row";
import {
  meta as fetchCinemetaMeta,
  narrowMediaType,
  isAddonNativeMeta,
  type Meta,
} from "@/lib/cinemeta";
import { fetchAddonMeta } from "@/lib/addons";
import { resolveMeta } from "@/lib/meta-resource";
import { useMdblistScores } from "@/lib/providers/mdblist";
import { lastPlayedEpisode } from "@/lib/resume";
import { localCwEntry } from "@/lib/local-cw";
import { omdbPrefetch, omdbScores, type OmdbScores } from "@/lib/providers/omdb";
import { harborImdbTitle } from "@/lib/providers/harbor-imdb";
import { awardSummary, useAwards } from "@/lib/providers/wikidata";
import { mergeBundledAwards, parseAwardYear } from "@/lib/awards-history";
import {
  tmdbDetails,
  tmdbImdbId,
  tmdbWatchProviders,
  type TmdbDetail,
  type WatchProvider,
} from "@/lib/providers/tmdb";
import { ParentalIcon } from "@/components/icons/parental-icon";
import { cinemetaDetails } from "@/lib/providers/cinemeta-details";
import { fetchParentalGuide, type ParentalGuide } from "@/lib/parental-guide";
import { ParentalGuideHeroCard } from "./detail/parental-guide-section";
import { useSettings } from "@/lib/settings";
import {
  isMovieWatchedLocal,
  movieWatchedVersion,
  subscribeMovieWatched,
} from "@/lib/movie-watched";
import { useTogether } from "@/lib/together/provider";
import { useTrakt } from "@/lib/trakt/provider";
import { toggleWatchlist, useInWatchlist } from "@/lib/watchlist";
import { findLocalSeriesEpisodes, useInLocalLibrary } from "@/lib/local-library";
import { localPlayerSrc } from "@/lib/local-library/player-src";
import { playLocalAware } from "@/lib/local-library/playback";
import { openLocalEpisodes } from "@/lib/player/local-episodes-modal";
import { markMovieWatched } from "@/lib/mark-watched";
import { useIsFavorite, useMediaFavorites } from "@/lib/media-favorites";
import {
  addToWatching,
  markWatched,
  removeFromWatching,
  removeFromWatched,
  useTrackingState,
} from "@/lib/library-tracking";
import { openUrl } from "@/lib/window";
import { profileFromDetail, trackEvent } from "@/lib/discover";
import { MOVIE_GENRES, TV_GENRES } from "@/lib/feed/tags";
import { useScrollMemory, useView, type PlayEpisode } from "@/lib/view";
import { prefetchSegments } from "@/lib/skip-intro";
import { useT } from "@/lib/i18n";
import { queryKeys } from "@/lib/query";
import { AddToListMenu } from "@/components/lists/add-to-list-menu";
import type { ListItemInput } from "@/lib/custom-lists";
import { AddToSimklButton } from "./detail/add-to-simkl-button";
import { getLocalCache, saveLocalCache } from "@/lib/simkl/activities";
import { simklRequest } from "@/lib/simkl/client";
import { CollectionRow } from "./detail/collection-row";
import { MediaGallery } from "./detail/media-gallery";
import { useTitleBackdrop } from "@/lib/title-backdrop";
import { useTitleLogo } from "@/lib/title-logo";
import { useStableAsset, toHiResBackdrop } from "@/lib/use-stable-asset";
import { ContentRails, type DetailSection } from "./detail/content-rails";
import {
  loadDetailCustomization,
  saveDetailCustomization,
  moveSection,
  toggleSectionHidden,
  resetDetailCustomization,
  type DetailCustomization,
} from "@/lib/detail-customization";
import { EpisodeDownloadButton } from "./detail/episode-download-button";
import { HeroBackdrop } from "./detail/hero-backdrop";
import { isTitleUpcoming } from "./detail/helpers";
import { HeroAwardsCorner } from "./detail/hero-awards";
import { Pill } from "./detail/pill";
import { Credit } from "./detail/credit";
import { TitlePlate } from "./detail/title-plate";
import { PlayModeHint } from "./detail/play-mode-hint";
import { UpcomingCta } from "./detail/upcoming-cta";
import { Synopsis } from "./detail/synopsis";
import { CastCard } from "./detail/cast-card";
import { PreviewIcon } from "./detail/preview-icon";
import { HeroActionOverflow, useHeroActionOverflow } from "./detail/hero-action-overflow";
import { HeroRatings } from "./detail/hero-ratings";
import { TrailerOverlay } from "./detail/trailer-overlay";
import { DetailHeroTrailer } from "./detail/detail-hero-trailer";
import { SeriesEpisodes } from "./detail/series-episodes";
import { CinemetaEpisodes } from "./detail/cinemeta-episodes";
import { EpisodeGridSkeleton } from "./detail/episode-grid-skeleton";
import { WatchOn } from "./detail/watch-on";
import { InfoBlock } from "./detail/info-block";
import { TraktComments } from "./detail/trakt-comments";
import { LetterboxdPanel } from "./detail/letterboxd-panel";
import { LetterboxdReviews } from "./detail/letterboxd-reviews";
import { stremioIdToTraktTarget } from "@/lib/trakt/ids";
import type { IdResolution } from "@/lib/trakt/ids";

if (typeof document !== "undefined") {
  const __id = "harbor-fade-in-up-style";
  if (!document.getElementById(__id)) {
    const __el = document.createElement("style");
    __el.id = __id;
    __el.textContent =
      "@keyframes harborFadeInUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}.harbor-fade-in-up{animation:harborFadeInUp .4s ease-out both}";
    document.head.appendChild(__el);
  }
}

function FadeInUp({ children }: { children: ReactNode }) {
  return <div className="harbor-fade-in-up">{children}</div>;
}

export function DetailView({
  meta,
  liveContext = false,
  episodeHint,
}: {
  meta: Meta;
  liveContext?: boolean;
  episodeHint?: { season: number; episode: number };
}) {
  const t = useT();
  const { settings, update } = useSettings();
  const queryClient = useQueryClient();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [detail, setDetail] = useState<TmdbDetail | null>(null);
  const [backdrops, setBackdrops] = useState<string[]>([]);
  const [backdropIdx, setBackdropIdx] = useState(0);
  const pinnedBackdrop = useTitleBackdrop(meta.id);
  const pinnedBackdropHi = pinnedBackdrop
    ? pinnedBackdrop.replace(/\/t\/p\/w\d+\//, "/t/p/original/")
    : undefined;
  const [cinemetaFull, setCinemetaFull] = useState<Meta | null>(
    meta.videos && meta.videos.length > 0 ? meta : null,
  );
  const [loading, setLoading] = useState(true);
  const [trailerOpen, setTrailerOpen] = useState(false);
  const [layout, setLayout] = useState<DetailCustomization>(loadDetailCustomization);
  const [layoutEdit, setLayoutEdit] = useState(false);
  const [scores, setScores] = useState<OmdbScores | null>(null);
  const [cinemetaRating, setCinemetaRating] = useState<string | null>(null);
  const [harborImdbRating, setHarborImdbRating] = useState<string | null>(null);
  const [watchProviders, setWatchProviders] = useState<WatchProvider[]>([]);
  const [parentalGuide, setParentalGuide] = useState<ParentalGuide | null | undefined>(undefined);
  const mdblist = useMdblistScores(
    settings.mdblistKey,
    detail?.imdbId ?? (meta.id.startsWith("tt") ? meta.id : null),
    meta.type === "movie" ? "movie" : "show",
  );
  const scrollRef = useRef<HTMLElement>(null);

  const { setNavStack, openPicker, openPlayer, openFilter, promoteMetaToRoot } = useView();
  const { snapshot: roomSnapshot, claimHost } = useTogether();
  const { isConnected: traktConnected } = useTrakt();
  const inWatchlist = useInWatchlist(meta.id, [detail?.imdbId]);
  const inLocalLibrary = useInLocalLibrary(meta.id, [detail?.imdbId]);
  const { toggle: toggleFavorite } = useMediaFavorites();
  const isFav = useIsFavorite(meta.id, [detail?.imdbId]);
  const tracking = useTrackingState(meta.id);
  const inSession = roomSnapshot.state === "joined" && roomSnapshot.participants.length >= 2;
  useScrollMemory(`meta:${meta.id}`, scrollRef);

  useEffect(() => {
    if (!meta.id.startsWith("simkl:")) return;

    let cancelled = false;
    const simklIdStr = meta.id.slice(6);
    const simklId = parseInt(simklIdStr, 10);

    const resolveSimklId = async () => {
      let resolvedId: string | null = null;
      const cache = getLocalCache();

      if (cache) {
        const imdbKey = Object.keys(cache.imdbToSimkl).find(
          (k) => cache.imdbToSimkl[k] === simklId,
        );
        if (imdbKey) resolvedId = imdbKey;

        if (!resolvedId) {
          const tmdbKey = Object.keys(cache.tmdbToSimkl).find(
            (k) => cache.tmdbToSimkl[k] === simklId,
          );
          if (tmdbKey) resolvedId = `tmdb:${tmdbKey}`;
        }
      }

      if (!resolvedId) {
        const mediaType =
          cache?.items[simklIdStr]?.type ||
          (meta.type === "movie" ? "movie" : meta.type === "anime" ? "anime" : "show");
        const path =
          mediaType === "movie"
            ? `/movies/${simklId}`
            : mediaType === "anime"
              ? `/anime/${simklId}`
              : `/tv/${simklId}`;

        try {
          const data = await simklRequest<any>(path);
          if (cancelled) return;
          if (data && data.ids) {
            const ids = data.ids;
            if (ids.imdb) {
              resolvedId = ids.imdb;
            } else if (ids.tmdb) {
              const tmdbType = mediaType === "movie" ? "movie" : "tv";
              resolvedId = `tmdb:${tmdbType}:${ids.tmdb}`;
            }

            if (resolvedId && cache) {
              if (ids.imdb) cache.imdbToSimkl[ids.imdb] = simklId;
              if (ids.tmdb) {
                const tmdbType = mediaType === "movie" ? "movie" : "tv";
                cache.tmdbToSimkl[`${tmdbType}:${ids.tmdb}`] = simklId;
              }
              saveLocalCache(cache);
            }
          }
        } catch (e) {
          console.error("Failed to resolve SIMKL ID via API", e);
        }
      }

      if (cancelled) return;

      if (resolvedId) {
        const target = resolvedId;
        setNavStack((stack) =>
          stack.map((frame) =>
            frame.kind === "meta" && frame.meta.id === meta.id
              ? { ...frame, meta: { ...frame.meta, id: target } }
              : frame,
          ),
        );
      }
    };

    void resolveSimklId();

    return () => {
      cancelled = true;
    };
  }, [meta.id, meta.type, setNavStack]);

  useEffect(() => {
    setHarborImdbRating(null);
    const tt = detail?.imdbId ?? (meta.id.startsWith("tt") ? meta.id : null);
    if (!tt || !tt.startsWith("tt")) return;
    let cancelled = false;
    harborImdbTitle(tt)
      .then((r) => {
        if (!cancelled && r != null) setHarborImdbRating(r.toFixed(1));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [detail?.imdbId, meta.id]);
  const addonNative = liveContext || isAddonNativeMeta(meta);
  const trailerCandidate = detail?.trailerCandidates?.[0] ?? meta.trailerStreams?.[0]?.ytId ?? null;
  const actionRowRef = useRef<HTMLDivElement | null>(null);
  const actionStage = useHeroActionOverflow(actionRowRef, [meta.id]);
  const addToListRef = useRef<HTMLButtonElement | null>(null);
  const [addToListOpen, setAddToListOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setBackdrops([]);
    setBackdropIdx(0);
    setCinemetaFull(meta.videos && meta.videos.length > 0 ? meta : null);
    if (meta.id.startsWith("tt") && !addonNative) {
      fetchCinemetaMeta(narrowMediaType(meta.type), meta.id)
        .then((full) => {
          if (cancelled || !full) return;
          setCinemetaFull(full);
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [meta.id, meta.type, addonNative]);

  useEffect(() => {
    if (meta.type !== "series") return;
    const imdb = meta.id.startsWith("tt")
      ? meta.id
      : detail?.imdbId?.startsWith("tt")
        ? detail.imdbId
        : null;
    if (!imdb) return;
    if (cinemetaFull?.videos && cinemetaFull.videos.length > 0) return;
    let cancelled = false;
    fetchCinemetaMeta(narrowMediaType(meta.type), imdb)
      .then((full) => {
        if (cancelled || !full) return;
        setCinemetaFull(full);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [meta.id, detail?.imdbId, meta.type, cinemetaFull?.videos?.length]);

  useEffect(() => {
    if (meta.type !== "series" && !addonNative) return;
    const base = meta.addonOrigin?.base;
    if (!base) return;
    if (cinemetaFull?.videos && cinemetaFull.videos.length > 0) return;
    let cancelled = false;
    fetchAddonMeta(base, meta.type, meta.id)
      .then((full) => {
        if (cancelled || !full?.videos?.length) return;
        setCinemetaFull(full);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [meta.id, meta.type, meta.addonOrigin?.base, addonNative, cinemetaFull?.videos?.length]);

  useEffect(() => {
    if (meta.type !== "series") return;
    if (meta.addonOrigin?.base) return;
    if (/^(tt\d|tmdb:|kitsu:|mal:|anilist:|anidb:|simkl:)/.test(meta.id)) return;
    if (cinemetaFull?.videos && cinemetaFull.videos.length > 0) return;
    let cancelled = false;
    resolveMeta(narrowMediaType(meta.type), meta.id)
      .then((full) => {
        if (cancelled || !full?.videos?.length) return;
        setCinemetaFull(full);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [meta.id, meta.type, meta.addonOrigin?.base, cinemetaFull?.videos?.length]);

  useEffect(() => {
    let cancelled = false;
    if (addonNative) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const work = queryClient.fetchQuery({
      queryKey: queryKeys.detail.data(
        meta.id,
        meta.type,
        settingsRef.current.tmdbKey,
        settingsRef.current.tmdbLanguage,
      ),
      queryFn: () =>
        settingsRef.current.tmdbKey
          ? tmdbDetails(settingsRef.current.tmdbKey, meta).then(
              (data) => data ?? cinemetaDetails(meta),
            )
          : cinemetaDetails(meta),
      staleTime: 30 * 60_000,
    });
    work
      .then((d) => {
        if (cancelled) return;
        setDetail(d);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    meta.id,
    meta.type,
    settings.tmdbKey,
    settings.fanartKey,
    settings.tvdbKey,
    settings.tmdbLanguage,
    addonNative,
    queryClient,
  ]);

  useEffect(() => {
    if (!detail) return;
    const profile = profileFromDetail(detail);
    trackEvent(meta.id, "open", profile);
    const t = setTimeout(() => trackEvent(meta.id, "dwell", profile), 8000);
    return () => clearTimeout(t);
  }, [detail, meta.id]);

  useEffect(() => {
    setScores(null);
    const imdbId = detail?.imdbId ?? (meta.id.startsWith("tt") ? meta.id : null);
    if (!imdbId || !settings.omdbKey) return;
    let cancelled = false;
    omdbScores(settings.omdbKey, imdbId).then((s) => {
      if (!cancelled) setScores(s);
    });
    return () => {
      cancelled = true;
    };
  }, [detail?.imdbId, meta.id, settings.omdbKey]);

  useEffect(() => {
    setCinemetaRating(null);
    if (meta.id.startsWith("tt")) return;
    const imdb = detail?.imdbId;
    if (!imdb || !imdb.startsWith("tt")) return;
    let cancelled = false;
    fetchCinemetaMeta(narrowMediaType(meta.type), imdb)
      .then((full) => {
        if (!cancelled && full?.imdbRating) setCinemetaRating(full.imdbRating);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [meta.id, meta.type, detail?.imdbId]);

  useEffect(() => {
    if (!settings.omdbKey || !detail) return;
    const queue = [...detail.recommendations.slice(0, 6), ...detail.similar.slice(0, 6)];
    for (const m of queue) {
      tmdbImdbId(settings.tmdbKey, m.id).then((id) => {
        if (id) omdbPrefetch(settings.omdbKey, id);
      });
    }
  }, [detail, settings.tmdbKey, settings.omdbKey]);

  useEffect(() => {
    setWatchProviders([]);
    if (!settings.tmdbKey || !detail) return;
    const k = detail.kind;
    if ((k !== "movie" && k !== "tv") || !Number.isFinite(Number(detail.id))) return;
    let cancelled = false;
    tmdbWatchProviders(settings.tmdbKey, k, detail.id, settings.region)
      .then((p) => {
        if (!cancelled) setWatchProviders(p);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [detail, settings.tmdbKey, settings.region]);

  useEffect(() => {
    setParentalGuide(undefined);
    const imdbId = detail?.imdbId ?? (meta.id.startsWith("tt") ? meta.id : null);
    if (!imdbId || !imdbId.startsWith("tt")) {
      setParentalGuide(null);
      return;
    }
    let cancelled = false;
    fetchParentalGuide(imdbId, meta.type === "movie" ? "movie" : "tv")
      .then((g) => {
        if (!cancelled) setParentalGuide(g);
      })
      .catch(() => {
        if (!cancelled) setParentalGuide(null);
      });
    return () => {
      cancelled = true;
    };
  }, [detail?.imdbId, meta.id, meta.type]);

  const title = detail?.title ?? meta.name;
  const listSeed: ListItemInput = {
    id: meta.id,
    type: meta.type,
    name: title || meta.name,
    poster: meta.poster ?? detail?.poster,
  };
  const overview = detail?.overview ?? (meta.id.startsWith("tmdb:") ? "" : meta.description) ?? "";
  const tagline = detail?.tagline ?? "";
  const pinnedLogo = useTitleLogo(meta.id);
  const stableBackdrop = useStableAsset([meta.background, detail?.backdrop], meta.id);
  const primaryBackdrop =
    pinnedBackdropHi || stableBackdrop || (loading ? undefined : meta.poster) || undefined;
  const backdropPool = useMemo(() => {
    const seen = new Set<string>();
    const pool: string[] = [];
    for (const b of [primaryBackdrop, ...backdrops]) {
      const hi = toHiResBackdrop(b ?? undefined);
      if (!hi || seen.has(hi)) continue;
      seen.add(hi);
      pool.push(hi);
    }
    return pool;
  }, [primaryBackdrop, backdrops]);
  const carouselOn = settings.heroBackdropCarousel && !pinnedBackdrop && backdropPool.length >= 2;
  useEffect(() => {
    if (!carouselOn) return;
    const id = window.setInterval(() => {
      setBackdropIdx((i) => (i + 1) % backdropPool.length);
    }, 12000);
    return () => window.clearInterval(id);
  }, [carouselOn, backdropPool.length]);
  const backdrop = (carouselOn ? backdropPool[backdropIdx] : backdropPool[0]) || primaryBackdrop;
  const stableLogo = useStableAsset([detail?.logo, meta.logo], meta.id);
  const logo = pinnedLogo || stableLogo;
  const year = detail?.year ?? meta.releaseInfo;
  const releaseYearNum = parseAwardYear(year);
  const imdbRatingValue =
    harborImdbRating ??
    scores?.imdbRating ??
    cinemetaRating ??
    (meta.id.startsWith("tt") ? meta.imdbRating : undefined);
  const rating = imdbRatingValue ?? detail?.rating ?? meta.imdbRating;
  const runtime = detail?.runtime;
  const genres = detail?.genres ?? meta.genres ?? [];
  const recommendations = detail?.recommendations ?? [];
  const similar = detail?.similar ?? [];
  const liveAwards = useAwards(detail?.imdbId ?? undefined);
  const awards = useMemo(
    () => mergeBundledAwards(liveAwards, meta.name, releaseYearNum ?? undefined),
    [liveAwards, meta.name, releaseYearNum],
  );
  const heroAwardSummary = awardSummary(awards).slice(0, 2);
  const awardsInDescription = (settings.theme.preset as string) === "elegantfin";
  const renderHeroAwards = () => {
    if (heroAwardSummary.length > 0) {
      return <HeroAwardsCorner summary={heroAwardSummary} inline />;
    }
    return null;
  };
  const awardsNode = renderHeroAwards();
  const heroAwardsInline = awardsInDescription ? awardsNode : null;
  const heroAwardsCorner = awardsInDescription ? null : awardsNode;
  const isSeries = detail?.kind != null ? detail.kind === "tv" : meta.type === "series";
  const traktResolution = useMemo((): IdResolution => {
    const imdbId = detail?.imdbId ?? (meta.id.startsWith("tt") ? meta.id : null);
    const tmdbId = detail?.id;
    if (isSeries && (imdbId || (tmdbId && detail?.kind === "tv"))) {
      const ids: Record<string, string | number> = {};
      if (imdbId) ids.imdb = imdbId;
      if (tmdbId) ids.tmdb = tmdbId;
      return { ok: true, target: { kind: "show", ids } } as IdResolution;
    }
    if (!isSeries && (imdbId || tmdbId)) {
      const ids: Record<string, string | number> = {};
      if (imdbId) ids.imdb = imdbId;
      if (tmdbId) ids.tmdb = tmdbId;
      return { ok: true, target: { kind: "movie", ids } } as IdResolution;
    }
    return stremioIdToTraktTarget(meta.id);
  }, [meta.id, isSeries, detail?.imdbId, detail?.id, detail?.kind]);
  const playMeta: Meta = {
    ...meta,
    name: title,
    logo,
    background: backdrop,
    releaseDate: detail?.releaseDate ?? meta.releaseDate,
    releaseInfo: detail?.year ?? meta.releaseInfo,
    behaviorHints: meta.behaviorHints ?? cinemetaFull?.behaviorHints,
    videos: meta.videos ?? cinemetaFull?.videos,
  };

  useSyncExternalStore(subscribeMovieWatched, movieWatchedVersion, movieWatchedVersion);
  const watchedMark = meta.type === "movie" && isMovieWatchedLocal(meta.id);
  const markThisMovieWatched = () => {
    void markMovieWatched(
      meta,
      detail?.imdbId,
      meta.id.startsWith("tmdb:") ? meta.id.split(":")[2] : null,
    );
  };

  const upcoming = !loading && isTitleUpcoming(detail, meta);

  const lastPlay = useMemo(() => {
    if (episodeHint) return episodeHint;
    const candidates: Array<{ season: number; episode: number; t: number }> = [];
    const ids = Array.from(
      new Set(
        [
          meta.id,
          detail?.imdbId ?? null,
          detail?.id != null ? `tmdb:tv:${detail.id}` : null,
        ].filter((x): x is string => !!x),
      ),
    );
    for (const id of ids) {
      const lc = localCwEntry(id);
      if (
        lc?.type === "series" &&
        typeof lc.season === "number" &&
        typeof lc.episode === "number" &&
        lc.season >= 1 &&
        lc.episode >= 1
      ) {
        candidates.push({ season: lc.season, episode: lc.episode, t: lc.t });
      }
      const lp = lastPlayedEpisode(id);
      if (lp && lp.season >= 1 && lp.episode >= 1) {
        candidates.push({ season: lp.season, episode: lp.episode, t: lp.t });
      }
    }
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.t - a.t);
    return { season: candidates[0].season, episode: candidates[0].episode };
  }, [meta.id, detail?.imdbId, detail?.id, episodeHint]);

  const toggleTierWatched = useCallback(() => {
    if (tracking.watched) {
      removeFromWatched(meta.id);
      return;
    }
    markWatched(listSeed);
  }, [tracking.watched, meta.id, listSeed]);

  const toggleWatching = useCallback(() => {
    if (tracking.watching) {
      removeFromWatching(meta.id);
      return;
    }
    addToWatching(listSeed, {
      season: lastPlay?.season,
      episode: lastPlay?.episode,
      totalSeasons: detail?.numberOfSeasons,
      status: detail?.status,
      yearLabel: meta.releaseInfo,
    });
  }, [
    tracking.watching,
    meta.id,
    meta.releaseInfo,
    listSeed,
    lastPlay,
    detail?.numberOfSeasons,
    detail?.status,
  ]);

  useEffect(() => {
    if (loading) return;
    let targetEp: PlayEpisode | undefined;
    if (isSeries) {
      const lp = lastPlay || { season: 1, episode: 1 };
      targetEp = { season: lp.season, episode: lp.episode };
      const v = cinemetaFull?.videos?.find(
        (x) => x.season === lp.season && x.episode === lp.episode,
      );
      if (v) targetEp.imdbId = v.id;
    }
    prefetchSegments(playMeta, targetEp);
  }, [loading, isSeries, lastPlay, cinemetaFull?.videos, playMeta]);

  const smartPlay = useCallback(
    async (forcePicker = false) => {
      if (inSession) claimHost(true);
      const opts = { autoPlay: !forcePicker && settings.instantPlay, resume: !forcePicker };
      const launch = (episode: PlayEpisode | undefined) => {
        const stream = () => openPicker(playMeta, episode, opts);
        if (forcePicker) {
          stream();
          return;
        }
        if (isSeries && settings.localPlaybackMode !== "stream") {
          const tmdbMatch = meta.id.match(/^tmdb:tv:(\d+)$/);
          const tmdbId = tmdbMatch ? parseInt(tmdbMatch[1], 10) : null;
          const seriesImdb = detail?.imdbId ?? (meta.id.startsWith("tt") ? meta.id : null);
          if (findLocalSeriesEpisodes(tmdbId, seriesImdb).length > 0) {
            openLocalEpisodes({
              title: playMeta.name,
              tmdbId,
              imdbId: seriesImdb,
              poster: playMeta.poster,
              videos: cinemetaFull?.videos,
              initialSeason: episode?.season,
              highlightEpisode: episode?.episode,
              onPlayLocal: (e) => openPlayer(localPlayerSrc(e)),
              onStream: stream,
            });
            return;
          }
        }
        playLocalAware({
          meta: playMeta,
          episode: episode ?? null,
          extraImdb: detail?.imdbId,
          mode: settings.localPlaybackMode,
          source: "manual",
          playLocal: (e, o) => openPlayer({ ...localPlayerSrc(e), startFromZero: o?.fromStart }),
          playStream: stream,
          setMode: (m) => update({ localPlaybackMode: m }),
        });
      };
      if (!isSeries) {
        launch(undefined);
        return;
      }
      if (lastPlay) {
        launch({ season: lastPlay.season, episode: lastPlay.episode });
        return;
      }
      launch({ season: 1, episode: 1 });
    },
    [
      isSeries,
      lastPlay,
      openPicker,
      openPlayer,
      playMeta,
      settings.instantPlay,
      settings.localPlaybackMode,
      update,
      inSession,
      claimHost,
      meta.id,
      detail?.imdbId,
      cinemetaFull?.videos,
    ],
  );
  const smartPlayLabel =
    inSession && !liveContext
      ? t("Play Together")
      : isSeries && lastPlay
        ? t("Resume S{s}:E{e}", { s: lastPlay.season, e: lastPlay.episode })
        : t("Play");

  const heroPills = (
    <>
      {year && (
        <Pill
          onClick={() => {
            const n = Number(String(year).slice(0, 4));
            if (Number.isFinite(n)) {
              openFilter({ kind: "year", mediaType: isSeries ? "tv" : "movie", value: n });
            }
          }}
        >
          {year}
        </Pill>
      )}
      {parentalGuide?.mpa_rating && (
        <Pill
          onClick={() => {
            document
              .getElementById("parental-guide")
              ?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        >
          <span className="flex items-center gap-1.5">
            <ParentalIcon width={12} height={12} strokeWidth={2.2} />
            {parentalGuide.mpa_rating}
          </span>
        </Pill>
      )}
      {inLocalLibrary && (
        <Pill>
          <span className="flex items-center gap-1.5">
            <HardDrive size={12} strokeWidth={2.4} />
            {t("In your local library")}
          </span>
        </Pill>
      )}
      <HeroRatings
        rating={rating}
        scores={scores}
        mdblist={mdblist}
        imdbId={detail?.imdbId ?? (meta.id.startsWith("tt") ? meta.id : null)}
        mediaType={meta.type === "movie" ? "movie" : "show"}
        ratingSource={imdbRatingValue != null ? "imdb" : "tmdb"}
        onOpenUrl={openUrl}
      />
      {runtime && (
        <Pill
          onClick={() => {
            if (isSeries) {
              document
                .querySelector("[data-episodes]")
                ?.scrollIntoView({ behavior: "smooth", block: "start" });
              return;
            }
            const minutes = parseInt(String(runtime), 10);
            if (Number.isFinite(minutes)) {
              openFilter({ kind: "runtime", mediaType: "movie", value: minutes });
            }
          }}
        >
          {runtime}
        </Pill>
      )}
      {meta.addonOrigin ? (
        <span className="flex items-center gap-2 rounded-full border border-edge bg-canvas/80 py-1 ps-1.5 pe-3 text-[12.5px] font-medium text-ink-muted">
          {meta.addonOrigin.logo ? (
            <img
              src={meta.addonOrigin.logo}
              alt=""
              draggable={false}
              className="h-5 w-5 rounded-full object-cover"
            />
          ) : (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-raised text-[10px] font-semibold text-ink">
              {meta.addonOrigin.name.charAt(0).toUpperCase()}
            </span>
          )}
          {meta.addonOrigin.name}
        </span>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          {genres.slice(0, 3).map((g) => {
            const map = isSeries ? TV_GENRES : MOVIE_GENRES;
            const id = map[g];
            return (
              <Pill
                key={g}
                onClick={
                  id
                    ? () =>
                        openFilter({
                          kind: "genre",
                          mediaType: isSeries ? "tv" : "movie",
                          name: g,
                          id,
                        })
                    : undefined
                }
              >
                {g}
              </Pill>
            );
          })}
        </div>
      )}
    </>
  );

  return (
    <main ref={scrollRef} className="absolute inset-0 z-30 overflow-y-auto bg-canvas">
      <section className="relative">
        <div
          data-tauri-drag-region
          className="harbor-bleed-stremio relative h-[78vh] min-h-[640px] overflow-hidden"
        >
          {carouselOn ? (
            backdropPool.map((b, i) => (
              <img
                key={b}
                src={b}
                alt=""
                decoding="async"
                fetchPriority={i === 0 ? "high" : "low"}
                loading={i < 3 ? "eager" : "lazy"}
                className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-[1200ms] ${i === backdropIdx ? "opacity-100" : "opacity-0"}`}
              />
            ))
          ) : backdrop ? (
            <HeroBackdrop url={backdrop} />
          ) : (
            <div className="absolute inset-0 animate-pulse bg-white/[0.02]" />
          )}
          {settings.detailTrailerAutoplay && trailerCandidate && (
            <DetailHeroTrailer candidateId={trailerCandidate} paused={trailerOpen} />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-canvas via-canvas/55 via-45% to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r rtl:bg-gradient-to-l from-canvas/85 via-canvas/35 to-transparent" />

          <div className="absolute inset-x-0 bottom-0 px-12 pb-14">
            <div className={awardsInDescription ? "max-w-3xl" : undefined}>
              {tagline && !loading && (
                <p
                  className={`mb-4 text-[14px] font-medium uppercase tracking-[0.2em] ${
                    awardsInDescription
                      ? "text-white/85 [text-shadow:0_1px_12px_rgba(0,0,0,0.7)]"
                      : "max-w-3xl text-ink-subtle"
                  }`}
                >
                  {tagline}
                </p>
              )}
              <TitlePlate title={title} logo={logo} loading={loading} />
              {awardsInDescription ? (
                <div className="mt-6 flex flex-wrap items-center gap-3 text-[13px] font-medium text-ink-muted">
                  {heroPills}
                </div>
              ) : (
                <div className="mt-6 flex items-center justify-between gap-8">
                  <div className="flex max-w-3xl flex-wrap items-center gap-3 text-[13px] font-medium text-ink-muted">
                    {heroPills}
                  </div>
                  {heroAwardsCorner && <div className="shrink-0">{heroAwardsCorner}</div>}
                </div>
              )}
              <div
                ref={actionRowRef}
                className={`mt-9 flex ${awardsInDescription ? "" : "w-fit max-w-full "}items-center gap-3 [&>*]:shrink-0`}
              >
                {upcoming ? (
                  <UpcomingCta detail={detail} onTry={() => smartPlay()} />
                ) : (
                  <PlayModeHint>
                    <button
                      data-tv-initial-focus
                      onClick={() => smartPlay(false)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        void smartPlay(true);
                      }}
                      className="flex h-12 items-center gap-2.5 rounded-full bg-ink px-7 text-[15px] font-semibold text-canvas shadow-[0_8px_24px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.65),inset_0_-1px_0_rgba(0,0,0,0.18)] transition-transform duration-200 hover:scale-[1.03] active:scale-[0.98]"
                    >
                      <Play size={18} fill="currentColor" />
                      {smartPlayLabel}
                    </button>
                  </PlayModeHint>
                )}
                {actionStage < 2 && (
                  <button
                    type="button"
                    onClick={() =>
                      toggleWatchlist({
                        id: meta.id,
                        type: meta.type,
                        name: title || meta.name,
                        poster: meta.poster ?? detail?.poster,
                        imdbId: detail?.imdbId,
                      })
                    }
                    title={
                      traktConnected
                        ? t("Synced to Trakt")
                        : t("Saved locally. Connect Trakt in Settings to sync.")
                    }
                    className={`flex h-12 items-center gap-2.5 whitespace-nowrap rounded-full border px-6 text-[15px] font-medium shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition-[transform,background-color,border-color] duration-200 active:scale-[0.98] ${
                      inWatchlist
                        ? "border-ink bg-ink/10 text-ink hover:bg-ink/20"
                        : "border-edge bg-canvas/80 text-ink hover:border-ink-subtle hover:bg-canvas/95"
                    }`}
                  >
                    {inWatchlist ? (
                      <>
                        <Check size={18} strokeWidth={2.4} />
                        {t("In Watchlist")}
                      </>
                    ) : (
                      <>
                        <Plus size={18} strokeWidth={2} />
                        {t("Add to Watchlist")}
                      </>
                    )}
                  </button>
                )}
                {actionStage < 2 && (
                  <button
                    type="button"
                    onClick={toggleTierWatched}
                    title={
                      tracking.watched
                        ? t("Watched. Rank it in your tier list.")
                        : t("Mark as watched and add it to your tier list.")
                    }
                    className={`flex h-12 items-center gap-2.5 whitespace-nowrap rounded-full border px-6 text-[15px] font-medium shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition-[transform,background-color,border-color] duration-200 active:scale-[0.98] ${
                      tracking.watched
                        ? "border-accent/55 bg-accent/15 text-accent hover:bg-accent/22"
                        : "border-edge bg-canvas/80 text-ink hover:border-ink-subtle hover:bg-canvas/95"
                    }`}
                  >
                    <Check size={18} strokeWidth={2.4} />
                    {tracking.watched ? t("Watched") : t("Mark as watched")}
                  </button>
                )}
                {actionStage < 2 && (
                  <AddToSimklButton
                    harborId={meta.id}
                    title={title || meta.name}
                    type={meta.type === "movie" ? "movie" : "series"}
                  />
                )}
                {actionStage >= 1 ? (
                  <HeroActionOverflow
                    meta={meta}
                    isFav={isFav}
                    onToggleFavorite={() =>
                      toggleFavorite({
                        id: meta.id,
                        type: meta.type,
                        name: title || meta.name,
                        poster: meta.poster ?? detail?.poster,
                      })
                    }
                    hasTrailer={!!trailerCandidate}
                    onTrailer={() => setTrailerOpen(true)}
                    canDownload={meta.type === "movie"}
                    showWatched={settings.showWatchedButton && meta.type === "movie"}
                    watchedMark={watchedMark}
                    onWatched={markThisMovieWatched}
                    showSync={actionStage >= 2}
                    isTierWatched={tracking.watched}
                    onToggleTierWatched={toggleTierWatched}
                    showWatching={isSeries}
                    isWatching={tracking.watching}
                    onToggleWatching={toggleWatching}
                    listItem={listSeed}
                    inWatchlist={inWatchlist}
                    onToggleWatchlist={() =>
                      toggleWatchlist({
                        id: meta.id,
                        type: meta.type,
                        name: title || meta.name,
                        poster: meta.poster ?? detail?.poster,
                        imdbId: detail?.imdbId,
                      })
                    }
                    simkl={{
                      harborId: meta.id,
                      type: meta.type === "movie" ? "movie" : "series",
                    }}
                  />
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        toggleFavorite({
                          id: meta.id,
                          type: meta.type,
                          name: title || meta.name,
                          poster: meta.poster ?? detail?.poster,
                        })
                      }
                      aria-label={isFav ? t("Remove from favorites") : t("Add to favorites")}
                      title={isFav ? t("Favorited") : t("Favorite")}
                      className={`group flex h-12 w-12 items-center justify-center rounded-full border transition-[transform,background-color,border-color] duration-200 active:scale-[0.94] ${
                        isFav
                          ? "border-accent/55 bg-accent/15 text-accent hover:bg-accent/22"
                          : "border-edge bg-canvas/80 text-ink hover:border-ink-subtle hover:bg-canvas/95"
                      }`}
                    >
                      <Star
                        size={20}
                        strokeWidth={isFav ? 0 : 1.9}
                        fill={isFav ? "currentColor" : "none"}
                      />
                    </button>
                    <button
                      ref={addToListRef}
                      type="button"
                      onClick={() => setAddToListOpen((v) => !v)}
                      aria-label={t("Add to list")}
                      title={t("Add to list")}
                      className="group flex h-12 w-12 items-center justify-center rounded-full border border-edge bg-canvas/80 text-ink transition-[transform,background-color,border-color] duration-200 hover:border-ink-subtle hover:bg-canvas/95 active:scale-[0.94]"
                    >
                      <Layers size={20} strokeWidth={1.9} />
                    </button>
                    <AddToListMenu
                      item={listSeed}
                      anchorRef={addToListRef}
                      open={addToListOpen}
                      onClose={() => setAddToListOpen(false)}
                    />
                    {settings.showWatchedButton && meta.type === "movie" && (
                      <button
                        type="button"
                        onClick={markThisMovieWatched}
                        aria-label={t("Mark watched")}
                        title={watchedMark ? t("Marked watched") : t("Mark watched")}
                        className={`group flex h-12 w-12 items-center justify-center rounded-full border transition-[transform,background-color,border-color] duration-200 active:scale-[0.94] ${
                          watchedMark
                            ? "border-accent/55 bg-accent/15 text-accent"
                            : "border-edge bg-canvas/80 text-ink hover:border-ink-subtle hover:bg-canvas/95"
                        }`}
                      >
                        <Check size={20} strokeWidth={2.4} />
                      </button>
                    )}
                    {isSeries && (
                      <button
                        type="button"
                        onClick={toggleWatching}
                        aria-label={
                          tracking.watching ? t("Stop tracking progress") : t("Track progress")
                        }
                        title={tracking.watching ? t("Currently Watching") : t("Track progress")}
                        className={`group flex h-12 w-12 items-center justify-center rounded-full border transition-[transform,background-color,border-color] duration-200 active:scale-[0.94] ${
                          tracking.watching
                            ? "border-accent/55 bg-accent/15 text-accent hover:bg-accent/22"
                            : "border-edge bg-canvas/80 text-ink hover:border-ink-subtle hover:bg-canvas/95"
                        }`}
                      >
                        <Eye size={20} strokeWidth={1.9} />
                      </button>
                    )}
                    {trailerCandidate && (
                      <button
                        type="button"
                        onClick={() => setTrailerOpen(true)}
                        aria-label={t("Watch trailer")}
                        title={t("Watch trailer")}
                        className="group flex h-12 w-12 items-center justify-center rounded-full border border-edge bg-canvas/80 text-ink transition-[transform,background-color,border-color] duration-200 hover:border-ink-subtle hover:bg-canvas/95 active:scale-[0.94]"
                      >
                        <PreviewIcon size={20} />
                      </button>
                    )}
                    {meta.type === "movie" && <EpisodeDownloadButton meta={meta} variant="bar" />}
                  </>
                )}
                {liveContext && (
                  <button
                    type="button"
                    onClick={promoteMetaToRoot}
                    className="flex h-12 items-center gap-2 rounded-full border border-edge bg-canvas/80 px-5 text-[14px] font-medium text-ink-muted transition-colors hover:border-ink-subtle hover:bg-canvas/95 hover:text-ink"
                  >
                    {meta.type === "series" || meta.type === "tv" || meta.type === "anime"
                      ? t("Open in TV Shows")
                      : t("Open in Movies")}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      <div data-tauri-drag-region className="flex flex-col gap-16 px-12 pb-24 pt-14">
        {(overview || heroAwardsInline || parentalGuide) && (
          <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:gap-10">
            {overview && <Synopsis text={overview} />}
            <div className="flex flex-col gap-4 lg:ms-auto lg:w-[28rem] lg:shrink-0">
              {parentalGuide && (
                <ParentalGuideHeroCard
                  guide={parentalGuide}
                  imdbId={detail?.imdbId ?? (meta.id.startsWith("tt") ? meta.id : "")}
                  mediaType={meta.type === "movie" ? "movie" : "tv"}
                />
              )}
              {heroAwardsInline && <div>{heroAwardsInline}</div>}
            </div>
          </div>
        )}
        {loading && meta.type === "series" && <EpisodeGridSkeleton />}

        {watchProviders.length > 0 && (
          <FadeInUp>
            <WatchOn providers={watchProviders} />
          </FadeInUp>
        )}

        {!liveContext && detail && isSeries && detail.seasons.length > 0 && (
          <FadeInUp>
            <SeriesEpisodes
              meta={playMeta}
              tvId={detail.id}
              imdbId={detail.imdbId ?? (meta.id.startsWith("tt") ? meta.id : null)}
              seasons={detail.seasons}
              lastEpisodeAir={detail.lastEpisodeAir}
              scrollRef={scrollRef}
              cinemetaVideos={cinemetaFull?.videos}
              resumeSeason={lastPlay?.season}
              resumeEpisode={lastPlay?.episode}
            />
          </FadeInUp>
        )}

        {!liveContext &&
          !loading &&
          (!detail || detail.seasons.length === 0) &&
          (isSeries || (addonNative && (meta.type === "channel" || meta.type === "tv"))) &&
          cinemetaFull?.videos &&
          (addonNative
            ? cinemetaFull.videos.length > 0
            : cinemetaFull.videos.some(
                (v) => v.season != null && v.season > 0 && v.episode != null,
              )) && (
            <FadeInUp>
              <CinemetaEpisodes meta={playMeta} videos={cinemetaFull.videos} />
            </FadeInUp>
          )}

        {(() => {
          const railSections: DetailSection[] = [];
          if (
            detail &&
            (detail.directors.length > 0 || detail.creators.length > 0 || detail.writers.length > 0)
          ) {
            railSections.push({
              key: "crew",
              label: t("Crew"),
              minHeight: 160,
              node: (
                <div className="grid grid-cols-1 gap-x-12 gap-y-6 border-b border-edge-soft pb-12 sm:grid-cols-2 lg:grid-cols-3">
                  {detail.directors.length > 0 && (
                    <Credit
                      label={detail.directors.length === 1 ? t("Director") : t("Directors")}
                      people={detail.directors}
                    />
                  )}
                  {detail.creators.length > 0 && (
                    <Credit
                      label={detail.creators.length === 1 ? t("Creator") : t("Creators")}
                      people={detail.creators}
                    />
                  )}
                  {detail.writers.length > 0 && (
                    <Credit
                      label={detail.writers.length === 1 ? t("Writer") : t("Writers")}
                      people={detail.writers.slice(0, 6)}
                    />
                  )}
                  {detail.producers.length > 0 && (
                    <Credit label={t("Producers")} people={detail.producers.slice(0, 6)} />
                  )}
                  {detail.cinematography.length > 0 && (
                    <Credit label={t("Cinematography")} people={detail.cinematography} />
                  )}
                  {detail.composer.length > 0 && (
                    <Credit label={t("Music")} people={detail.composer} />
                  )}
                  {detail.editor.length > 0 && (
                    <Credit
                      label={detail.editor.length === 1 ? t("Editor") : t("Editors")}
                      people={detail.editor}
                    />
                  )}
                </div>
              ),
            });
          }
          if (detail && detail.cast.length > 0) {
            railSections.push({
              key: "cast",
              label: t("Cast"),
              minHeight: 240,
              node: (
                <Row title={t("Cast · {n}", { n: detail.cast.length })} min={128}>
                  {detail.cast.map((c, i) => (
                    <CastCard key={`${c.id}-${i}`} cast={c} />
                  ))}
                </Row>
              ),
            });
          }
          if (detail?.collection) {
            railSections.push({
              key: "collection",
              label: t("Collection"),
              node: <CollectionRow collection={detail.collection} currentId={meta.id} />,
            });
          }
          if (recommendations.length > 0) {
            railSections.push({
              key: "moreLikeThis",
              label: t("More Like This"),
              node: (
                <Row title={t("More Like This")}>
                  {recommendations.map((r) => (
                    <PickCard key={r.id} meta={r} />
                  ))}
                </Row>
              ),
            });
          }
          if (similar.length > 0) {
            railSections.push({
              key: "similar",
              label: t("You Might Also Like"),
              node: (
                <Row title={t("You Might Also Like")}>
                  {similar.map((r) => (
                    <PickCard key={`s-${r.id}`} meta={r} />
                  ))}
                </Row>
              ),
            });
          }
          if (detail) {
            railSections.push({
              key: "mediaGallery",
              label: t("Media"),
              node: <MediaGallery detail={detail} title={title} logo={logo} metaId={meta.id} />,
            });
          }
          if (detail && awards) {
            railSections.push({
              key: "awards",
              label: t("Awards & Recognition"),
              minHeight: 200,
              node: <AwardsBlock awards={awards} />,
            });
          }
          if (detail) {
            railSections.push({
              key: "info",
              label: t("Information"),
              minHeight: 200,
              node: <InfoBlock detail={detail} />,
            });
          }
          if (settings.showTraktComments === true) {
            railSections.push({
              key: "traktComments",
              label: t("Comments"),
              minHeight: 120,
              node: <TraktComments resolution={traktResolution} />,
            });
          }
          railSections.push({
            key: "letterboxdPanel",
            label: t("Letterboxd"),
            minHeight: 120,
            node: (
              <LetterboxdPanel
                meta={meta}
                imdbId={detail?.imdbId ?? (meta.id.startsWith("tt") ? meta.id : null)}
              />
            ),
          });
          railSections.push({
            key: "letterboxdReviews",
            label: t("Letterboxd Reviews"),
            minHeight: 120,
            node: (
              <LetterboxdReviews
                meta={meta}
                imdbId={detail?.imdbId ?? (meta.id.startsWith("tt") ? meta.id : null)}
              />
            ),
          });
          if (railSections.length === 0) return null;
          const railKeys = railSections.map((s) => s.key);
          const persist = (next: DetailCustomization) => {
            setLayout(next);
            saveDetailCustomization(next);
          };
          const hasChanges = layout.order.length > 0 || layout.hidden.length > 0;
          return (
            <>
              <div className="flex items-center justify-end gap-2">
                {layoutEdit && hasChanges && (
                  <button
                    onClick={() => persist(resetDetailCustomization())}
                    className="flex h-8 items-center gap-1.5 rounded-md border border-edge-soft/40 bg-canvas/80 px-2.5 text-[12px] font-medium text-ink-muted transition-colors hover:bg-canvas hover:text-ink"
                  >
                    <RotateCcw size={12} strokeWidth={2.2} />
                    {t("Reset")}
                  </button>
                )}
                <button
                  onClick={() => setLayoutEdit((v) => !v)}
                  className={`flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[12px] font-medium transition-colors ${
                    layoutEdit
                      ? "border-ink bg-ink text-canvas hover:opacity-90"
                      : "border-edge-soft/40 bg-canvas/80 text-ink-muted hover:bg-canvas hover:text-ink"
                  }`}
                >
                  <Pencil size={12} strokeWidth={2.4} />
                  {layoutEdit ? t("Done editing") : t("Customize layout")}
                </button>
              </div>
              <FadeInUp>
                <ContentRails
                  sections={railSections}
                  custom={layout}
                  editMode={layoutEdit}
                  onMove={(k, d) => persist(moveSection(layout, railKeys, k, d))}
                  onToggleHidden={(k) => persist(toggleSectionHidden(layout, k))}
                />
              </FadeInUp>
            </>
          );
        })()}

        {!loading && !detail && !addonNative && !settings.tmdbKey && (
          <div className="rounded-2xl border border-dashed border-edge px-6 py-12 text-center text-[14px] text-ink-muted">
            {t("Add a TMDB key in Settings to see cast, related titles, and trailers here.")}
          </div>
        )}
      </div>
      <BackToTop scrollRef={scrollRef} />
      {trailerOpen && trailerCandidate && (
        <TrailerOverlay
          id={trailerCandidate}
          title={title}
          logo={logo}
          onClose={() => setTrailerOpen(false)}
        />
      )}
    </main>
  );
}
