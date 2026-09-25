import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useParental } from "@/lib/parental";
import {
  detectIntent,
  searchAll,
  searchCinemeta,
  searchLiveTvChannels,
  type SearchResults,
} from "@/lib/search";
import {
  searchAddonCatalogs,
  searchAddonGroups,
  mergeMetas,
  type AddonFetchCache,
} from "@/lib/search-addons";
import { searchAddonIndex } from "@/lib/search-addon-index";
import { createSearchRequestGuard } from "@/lib/search-request-guard";
import { normalizeSearchQuery } from "@/lib/search-query";
import { gatherCatalogAddons, type Addon } from "@/lib/addons";
import { useProfiles } from "@/lib/profiles";
import { useSettings } from "@/lib/settings";

type SearchState = {
  open: boolean;
  query: string;
  results: SearchResults | null;
  status: "idle" | "typing" | "loading" | "done";
  recent: string[];
};

type SearchValue = SearchState & {
  setOpen: (open: boolean) => void;
  setQuery: (q: string) => void;
  clear: () => void;
  recordRecent: (q: string) => void;
  removeRecent: (q: string) => void;
  clearRecent: () => void;
};

const Ctx = createContext<SearchValue | null>(null);
const RECENT_KEY = "harbor.search.recent";
const MAX_RECENT = 8;
const TMDB_CACHE_TTL_MS = 60_000;
const SECONDARY_CACHE_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 16;

type SearchCache<T> = {
  resolved: Map<string, { expiresAt: number; result: T }>;
  // In-flight requests, keyed the same as `resolved`. Without this, two
  // overlapping calls for the same key (e.g. an identical query retyped
  // while the first request is still out) each start their own fetch.
  inflight: Map<string, Promise<T>>;
};

function createSearchCache<T>(): SearchCache<T> {
  return { resolved: new Map(), inflight: new Map() };
}

function cachedSearch<T>(
  cache: SearchCache<T>,
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  for (const [cacheKey, value] of cache.resolved) {
    if (value.expiresAt <= now) cache.resolved.delete(cacheKey);
  }
  const cached = cache.resolved.get(key);
  if (cached) return Promise.resolve(cached.result);
  const pending = cache.inflight.get(key);
  if (pending) return pending;
  const promise = load()
    .then((result) => {
      if (cache.resolved.size >= MAX_CACHE_ENTRIES) {
        const oldest = cache.resolved.keys().next().value;
        if (oldest) cache.resolved.delete(oldest);
      }
      cache.resolved.set(key, { expiresAt: Date.now() + ttlMs, result });
      return result;
    })
    .finally(() => {
      cache.inflight.delete(key);
    });
  cache.inflight.set(key, promise);
  return promise;
}

/**
 * The TMDB slice of a publish before TMDB has (or ever) resolved: results
 * still merge in from the other providers, this just supplies the fields
 * (topMatch, intent, ...) that only TMDB produces. `tmdbUnavailable` is left
 * unset here -- it is still pending, not actually unavailable -- and is only
 * set true by the caller once the TMDB request has actually failed.
 */
function emptyTmdbResult(query: string): SearchResults {
  return {
    query,
    topMatch: null,
    people: [],
    movies: [],
    series: [],
    liveTv: [],
    addonGroups: [],
    addons: [],
    intent: detectIntent(query),
  };
}

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string").slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

function saveRecent(items: string[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(items.slice(0, MAX_RECENT)));
  } catch {
    /* noop */
  }
}

export function SearchProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  const { activeId: profileId } = useProfiles();
  const { hiddenTabs } = useParental();
  const [open, setOpen] = useState(false);
  const [query, setQueryState] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [status, setStatus] = useState<SearchState["status"]>("idle");
  const [recent, setRecent] = useState<string[]>(() => loadRecent());
  const debounceRef = useRef<number | null>(null);
  const requestGuardRef = useRef(createSearchRequestGuard());
  const tmdbCacheRef = useRef(createSearchCache<SearchResults>());
  const cinemetaCacheRef = useRef(createSearchCache<Awaited<ReturnType<typeof searchCinemeta>>>());
  // The AbortController for the query currently out on the network, so a
  // superseded or abandoned search can cancel its still-running requests
  // instead of letting them finish and occupy fetch/scheduler slots.
  const abortRef = useRef<AbortController | null>(null);
  const addonsRef = useRef<{ key: string | null; addons: Addon[] } | null>(null);
  const ensureAddons = useCallback(async (): Promise<Addon[]> => {
    if (addonsRef.current && addonsRef.current.key === profileId) return addonsRef.current.addons;
    const a = await gatherCatalogAddons().catch(() => [] as Addon[]);
    addonsRef.current = { key: profileId, addons: a };
    return a;
  }, [profileId]);
  // A scalar fingerprint of the IPTV playlist set, so the search effect only
  // re-fires when playlists actually change rather than on every settings
  // write that happens to recreate the array reference.
  const iptvPlaylistsKey = useMemo(
    () => settings.iptvPlaylists.map((p) => `${p.id}:${p.kind ?? "m3u"}`).join(","),
    [settings.iptvPlaylists],
  );

  useEffect(() => {
    const onAddonsChanged = () => {
      addonsRef.current = null;
    };
    window.addEventListener("harbor:addons-changed", onAddonsChanged);
    return () => window.removeEventListener("harbor:addons-changed", onAddonsChanged);
  }, []);

  // Cancel in-flight requests as soon as the overlay closes rather than
  // waiting for them to finish or for the next query to supersede them.
  useEffect(() => {
    if (!open) abortRef.current?.abort();
  }, [open]);

  useEffect(() => {
    // Invalidate an already-running request before the debounce starts. Without
    // this, an older search can publish while the user is typing a new query.
    const id = requestGuardRef.current.begin();
    const trimmed = query.trim();
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    abortRef.current?.abort();
    abortRef.current = null;
    if (!trimmed) {
      setResults(null);
      setStatus("idle");
      return;
    }
    setResults(null);
    setStatus("typing");
    const liveTvAllowed = !hiddenTabs.liveTv && settings.iptvPlaylists.length > 0;
    debounceRef.current = window.setTimeout(() => {
      if (!requestGuardRef.current.isCurrent(id)) return;
      setStatus("loading");
      const ac = new AbortController();
      abortRef.current = ac;
      const liveTv = liveTvAllowed ? searchLiveTvChannels(trimmed, settings.iptvPlaylists) : [];
      const normalizedQuery = normalizeSearchQuery(trimmed);
      const tmdbCacheKey = [settings.tmdbKey, settings.tmdbLanguage, normalizedQuery].join("\0");
      const tmdbPromise = cachedSearch(tmdbCacheRef.current, tmdbCacheKey, TMDB_CACHE_TTL_MS, () =>
        searchAll(settings.tmdbKey, trimmed, { signal: ac.signal }),
      );
      const addonsP = ensureAddons();
      // Shared between the flat catalog search and the per-addon groups
      // below: they hit largely the same catalog URLs, and without a shared
      // cache each query fired that work twice.
      const addonFetchCache: AddonFetchCache = new Map();
      const addonPromise = addonsP
        .then((a) =>
          searchAddonCatalogs(a, trimmed, { signal: ac.signal, fetchCache: addonFetchCache }),
        )
        .catch(() => ({ movies: [], series: [] }));
      const addonGroupsPromise = addonsP
        .then((a) =>
          searchAddonGroups(a, trimmed, { signal: ac.signal, fetchCache: addonFetchCache }),
        )
        .catch(() => []);
      const cinemetaPromise = cachedSearch(
        cinemetaCacheRef.current,
        normalizedQuery,
        SECONDARY_CACHE_TTL_MS,
        () => searchCinemeta(trimmed, ac.signal),
      ).catch(() => ({ movies: [], series: [] }));

      let tmdbResult: SearchResults | null = null;
      const acc = {
        addon: { movies: [], series: [] } as Awaited<typeof addonPromise>,
        cine: { movies: [], series: [] } as Awaited<typeof cinemetaPromise>,
        groups: [] as Awaited<typeof addonGroupsPromise>,
      };
      // Every provider publishes independently as it arrives instead of
      // waiting on TMDB: TMDB retries with backoff on rate limits and used
      // to gate the whole overlay behind it, so a slow/throttled TMDB call
      // used to stall Cinemeta and addon results that had already come
      // back. `status` only flips to "done" once every source has settled
      // (or failed), so the "no matches" state can't flash before slower
      // sources land.
      const TOTAL_SOURCES = 4;
      let settledCount = 0;
      const publish = () => {
        if (!requestGuardRef.current.isCurrent(id)) return;
        const base = tmdbResult ?? emptyTmdbResult(trimmed);
        const mergedMovies = mergeMetas(mergeMetas(base.movies, acc.addon.movies), acc.cine.movies);
        const mergedSeries = mergeMetas(mergeMetas(base.series, acc.addon.series), acc.cine.series);
        const shown = new Set<string>([...mergedMovies, ...mergedSeries].map((m) => m.id));
        const dedupedGroups = acc.groups
          .map((g) => ({ ...g, metas: g.metas.filter((m) => !shown.has(m.id)) }))
          .filter((g) => g.metas.length > 0);
        setResults({
          ...base,
          movies: mergedMovies,
          series: mergedSeries,
          liveTv,
          addonGroups: dedupedGroups,
          addons: searchAddonIndex(trimmed),
        });
      };
      const settle = () => {
        settledCount += 1;
        if (settledCount >= TOTAL_SOURCES && requestGuardRef.current.isCurrent(id)) {
          setStatus("done");
        }
      };
      tmdbPromise
        .then((r) => {
          tmdbResult = r;
        })
        .catch(() => {
          // Other search providers remain useful when TMDB is temporarily
          // unavailable, so use an empty TMDB result as the publish baseline.
          tmdbResult = { ...emptyTmdbResult(trimmed), tmdbUnavailable: true };
        })
        .finally(() => {
          settle();
          publish();
        });
      void addonPromise
        .then((a) => {
          acc.addon = a;
        })
        .finally(() => {
          settle();
          publish();
        });
      void cinemetaPromise
        .then((c) => {
          acc.cine = c;
        })
        .finally(() => {
          settle();
          publish();
        });
      void addonGroupsPromise
        .then((g) => {
          acc.groups = g;
        })
        .finally(() => {
          settle();
          publish();
        });
    }, 180);

    return () => {
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      abortRef.current?.abort();
      abortRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    query,
    settings.tmdbKey,
    settings.tmdbLanguage,
    iptvPlaylistsKey,
    hiddenTabs.liveTv,
    ensureAddons,
  ]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = (e.key ?? "").toLowerCase();
      if ((e.metaKey || e.ctrlKey) && k === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (e.key === "Escape" && open) {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const setQuery = useCallback((q: string) => setQueryState(q), []);

  const clear = useCallback(() => {
    setQueryState("");
    setResults(null);
    setStatus("idle");
  }, []);

  const recordRecent = useCallback((q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setRecent((prev) => {
      const next = [
        trimmed,
        ...prev.filter((p) => p.toLowerCase() !== trimmed.toLowerCase()),
      ].slice(0, MAX_RECENT);
      saveRecent(next);
      return next;
    });
  }, []);

  const removeRecent = useCallback((q: string) => {
    setRecent((prev) => {
      const next = prev.filter((p) => p !== q);
      saveRecent(next);
      return next;
    });
  }, []);

  const clearRecent = useCallback(() => {
    setRecent([]);
    saveRecent([]);
  }, []);

  const value = useMemo(
    () => ({
      open,
      setOpen,
      query,
      setQuery,
      results,
      status,
      recent,
      clear,
      recordRecent,
      removeRecent,
      clearRecent,
    }),
    [
      open,
      query,
      results,
      status,
      recent,
      setQuery,
      clear,
      recordRecent,
      removeRecent,
      clearRecent,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSearch(): SearchValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSearch outside SearchProvider");
  return v;
}
