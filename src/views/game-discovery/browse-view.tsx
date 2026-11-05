import { Gamepad2, Loader2, Search, X } from "lucide-react";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { ScrollRootContext } from "@/components/row";
import { VirtualGrid } from "@/components/virtual-grid";
import { useGameBrowse } from "@/lib/game-discovery/queries";
import { GAME_GENRE_TILES, GAME_PLATFORM_FILTERS } from "@/lib/game-discovery/sections";
import type {
  GameBrowseSpec,
  GameId,
  GameListFilter,
  GameOrdering,
  GameSummary,
} from "@/lib/game-discovery/types";
import type { RawgGateState } from "@/lib/game-discovery/use-rawg";
import { isRawgError } from "@/lib/providers/rawg";
import { useT } from "@/lib/i18n";
import { GameCard, GameCardSkeleton } from "./game-card";
import { GamesFrame } from "./games-frame";
import { GamesErrorState, GamesNotice } from "./games-state";
import { PillToggle } from "./pill-toggle";

const SEARCH_DEBOUNCE_MS = 350;
const MIN_SEARCH_CHARS = 2;

type OrderingChoice = "relevance" | GameOrdering;

export function GameBrowseView({ spec, active }: { spec: GameBrowseSpec; active: boolean }) {
  return (
    <GamesFrame scrollKey={`game-browse-${spec.title}`} active={active}>
      {(gate) => <BrowseBody spec={spec} gate={gate} active={active} />}
    </GamesFrame>
  );
}

function genreKey(filter: GameListFilter): string {
  return filter.genres ? `g:${filter.genres}` : filter.tags ? `t:${filter.tags}` : "";
}

function BrowseBody({
  spec,
  gate,
  active,
}: {
  spec: GameBrowseSpec;
  gate: RawgGateState;
  active: boolean;
}) {
  const t = useT();
  const [input, setInput] = useState(spec.filter.search ?? "");
  const [search, setSearch] = useState(spec.filter.search ?? "");
  const [ordering, setOrdering] = useState<OrderingChoice>(
    spec.filter.search ? "relevance" : (spec.filter.ordering ?? "-added"),
  );
  const [platform, setPlatform] = useState(spec.filter.parentPlatforms ?? "");
  const [genre, setGenre] = useState(genreKey(spec.filter));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (spec.focusSearch) inputRef.current?.focus();
  }, [spec.focusSearch]);

  // Debounce typing; anything under the minimum length searches nothing.
  useEffect(() => {
    const value = input.trim();
    const next = value.length >= MIN_SEARCH_CHARS ? value : "";
    if (next === search) return;
    const id = window.setTimeout(() => {
      setSearch(next);
      if (next && ordering === "-added" && !spec.filter.ordering) setOrdering("relevance");
      if (!next && ordering === "relevance") setOrdering("-added");
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [input, search, ordering, spec.filter.ordering]);

  const filter = useMemo<GameListFilter>(() => {
    const base: GameListFilter = { ...spec.filter, search: search || undefined };
    base.ordering = ordering === "relevance" ? undefined : ordering;
    base.parentPlatforms = platform || undefined;
    if (genre.startsWith("g:")) {
      base.genres = genre.slice(2);
      base.tags = undefined;
    } else if (genre.startsWith("t:")) {
      base.tags = genre.slice(2);
      base.genres = undefined;
    } else {
      base.genres = undefined;
      base.tags = undefined;
    }
    return base;
  }, [spec.filter, search, ordering, platform, genre]);

  // A bare "Search games" entry waits for input instead of spending a request.
  const idle =
    !!spec.focusSearch &&
    !search &&
    !platform &&
    !genre &&
    !Object.values(spec.filter).some(Boolean);
  const query = useGameBrowse(gate, filter, active && !idle);
  const items = useMemo(() => {
    const seen = new Set<GameId>();
    const out: GameSummary[] = [];
    for (const page of query.data?.pages ?? []) {
      for (const game of page.items) {
        if (seen.has(game.id)) continue;
        seen.add(game.id);
        out.push(game);
      }
    }
    return out;
  }, [query.data]);
  const total = query.data?.pages[0]?.count ?? null;

  const root = useContext(ScrollRootContext);
  const scrollRef = useMemo(() => ({ current: root }), [root]);
  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !root || !hasNextPage || isFetchingNextPage || !active) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void fetchNextPage();
      },
      { root, rootMargin: "900px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [root, hasNextPage, isFetchingNextPage, fetchNextPage, active, items.length]);

  const orderingOptions: { value: OrderingChoice; label: string }[] = [
    ...(search ? [{ value: "relevance" as const, label: t("Relevance") }] : []),
    { value: "-added", label: t("Popular") },
    { value: "-released", label: t("Release date") },
    { value: "-metacritic", label: t("Metacritic") },
    { value: "name", label: t("Name") },
  ];

  return (
    <div className="flex flex-col gap-8 px-5 pb-12 pt-28 sm:px-8 lg:px-12">
      <header data-tauri-drag-region className="flex flex-col gap-6">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-elevated/70 text-ink-muted ring-1 ring-edge-soft">
            <Gamepad2 size={17} strokeWidth={1.9} />
          </span>
          <span className="text-[12px] font-semibold uppercase tracking-[0.22em] text-ink-subtle">
            {spec.kicker ? t(spec.kicker) : t("Games")}
          </span>
        </div>
        <h1 className="font-display text-[clamp(40px,5vw,64px)] font-medium leading-[0.98] tracking-tight text-ink">
          {search ? t("Results for “{q}”", { q: search }) : t(spec.title)}
        </h1>
        <div className="flex h-12 max-w-xl items-center gap-3 rounded-full border border-edge bg-elevated/60 px-4 focus-within:border-ink">
          <Search size={17} strokeWidth={1.9} className="shrink-0 text-ink-subtle" />
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t("Search games…")}
            className="min-w-0 flex-1 bg-transparent text-[15px] text-ink placeholder:text-ink-subtle focus:outline-none"
          />
          {query.isFetching && !isFetchingNextPage && (
            <Loader2 size={16} className="shrink-0 animate-spin text-ink-subtle" />
          )}
          {input && (
            <button
              onClick={() => setInput("")}
              aria-label={t("Clear search")}
              className="shrink-0 rounded-full p-1 text-ink-subtle hover:text-ink"
            >
              <X size={15} />
            </button>
          )}
        </div>
        <div className="flex flex-col gap-3">
          <PillToggle value={ordering} options={orderingOptions} onChange={setOrdering} />
          <PillToggle
            value={platform}
            options={[
              { value: "", label: t("All platforms") },
              ...GAME_PLATFORM_FILTERS.map((p) => ({ value: p.id, label: p.label })),
            ]}
            onChange={setPlatform}
          />
          <PillToggle
            value={genre}
            options={[
              { value: "", label: t("All genres") },
              ...GAME_GENRE_TILES.map((g) => ({ value: genreKey(g.filter), label: t(g.title) })),
            ]}
            onChange={setGenre}
          />
        </div>
      </header>

      {idle ? (
        <GamesNotice>
          {t("Type at least two characters to search RAWG's game catalog.")}
        </GamesNotice>
      ) : query.isError && items.length === 0 ? (
        <GamesErrorState
          kind={isRawgError(query.error) ? query.error.kind : null}
          onRetry={() => void query.refetch()}
        />
      ) : query.isPending ? (
        <div className="grid grid-cols-1 gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <GameCardSkeleton key={i} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <GamesNotice>
          {search ? t("No games match “{q}”.", { q: search }) : t("No games match these filters.")}
        </GamesNotice>
      ) : (
        <>
          {total !== null && (
            <p className="text-[13px] text-ink-subtle">
              {t("{n} games on RAWG", { n: total.toLocaleString() })}
            </p>
          )}
          <VirtualGrid
            items={items}
            scrollRef={scrollRef}
            minColumnWidth={260}
            gapX={20}
            gapY={32}
            estimateRowHeight={210}
            getKey={(game) => game.id}
            renderItem={(game) => <GameCard game={game} />}
          />
          <div ref={sentinel} className="flex h-16 items-center justify-center">
            {isFetchingNextPage && <Loader2 size={18} className="animate-spin text-ink-subtle" />}
            {query.isError && items.length > 0 && (
              <button
                onClick={() => void fetchNextPage()}
                className="text-[13px] text-ink-muted hover:text-ink"
              >
                {t("Couldn't load more. Try again")}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
