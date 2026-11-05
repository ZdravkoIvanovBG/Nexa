import { Search } from "lucide-react";
import { useMemo } from "react";
import { Row } from "@/components/row";
import { FRANCHISES } from "@/lib/game-discovery/franchises";
import { useGameList } from "@/lib/game-discovery/queries";
import { gameSections, type GameSection } from "@/lib/game-discovery/sections";
import type { RawgGateState } from "@/lib/game-discovery/use-rawg";
import { isRawgError } from "@/lib/providers/rawg";
import { useT } from "@/lib/i18n";
import { useView } from "@/lib/view";
import { FranchiseCard } from "./game-discovery/franchise-card";
import { GameSectionRow, GameRowSkeleton, RowTitle } from "./game-discovery/game-row";
import { GamesFrame } from "./game-discovery/games-frame";
import { GamesHero } from "./game-discovery/games-hero";
import { GamesErrorState } from "./game-discovery/games-state";
import { GameGenreTiles } from "./game-discovery/genre-tiles";
import { WhenNear } from "./game-discovery/when-near";

const ROW_PAGE_SIZE = 20;
const HERO_SLIDES = 5;
const MIN_HERO_SLIDES = 3;

export function GamesView({ active }: { active: boolean }) {
  return (
    <GamesFrame scrollKey="games" active={active}>
      {(gate) => <GamesDiscovery gate={gate} active={active} />}
    </GamesFrame>
  );
}

function GamesDiscovery({ gate, active }: { gate: RawgGateState; active: boolean }) {
  const t = useT();
  const { openGameBrowse } = useView();
  const sections = useMemo(() => gameSections(), []);
  const byId = (id: GameSection["id"]) => sections.find((s) => s.id === id)!;
  const popular = byId("popular");
  const fresh = byId("new");

  // Same query keys as the rows below: shared cache, no extra requests.
  const popularQuery = useGameList(gate, popular.filter, ROW_PAGE_SIZE, active);
  const freshQuery = useGameList(gate, fresh.filter, ROW_PAGE_SIZE, active);

  const hero = useMemo(
    () => (popularQuery.data?.items ?? []).filter((g) => g.image).slice(0, HERO_SLIDES),
    [popularQuery.data],
  );
  const showHero = hero.length >= MIN_HERO_SLIDES;
  const heroIds = useMemo(() => new Set(showHero ? hero.map((g) => g.id) : []), [hero, showHero]);
  const shownAbove = useMemo(() => {
    const ids = new Set(heroIds);
    for (const g of popularQuery.data?.items ?? []) ids.add(g.id);
    for (const g of freshQuery.data?.items ?? []) ids.add(g.id);
    return ids;
  }, [heroIds, popularQuery.data, freshQuery.data]);
  const freshExclude = useMemo(() => {
    const ids = new Set(heroIds);
    for (const g of popularQuery.data?.items ?? []) ids.add(g.id);
    return ids;
  }, [heroIds, popularQuery.data]);

  const bothFailed = popularQuery.isError && freshQuery.isError;
  if (bothFailed) {
    const error = popularQuery.error;
    return (
      <div className="px-5 pt-28 sm:px-8 lg:px-12">
        <GamesErrorState
          kind={isRawgError(error) ? error.kind : null}
          onRetry={() => {
            void popularQuery.refetch();
            void freshQuery.refetch();
          }}
        />
      </div>
    );
  }

  return (
    <>
      {showHero ? (
        <GamesHero slides={hero} gate={gate} />
      ) : popularQuery.isPending ? (
        <div className="harbor-bleed-stremio h-[78vh] min-h-[640px] w-full animate-pulse bg-elevated/30" />
      ) : null}
      <div
        className={`relative flex w-full flex-col gap-12 px-5 pb-12 sm:px-8 lg:px-12 ${
          showHero || popularQuery.isPending ? "pt-12" : "pt-28"
        }`}
      >
        <header data-tauri-drag-region className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-bold uppercase tracking-[0.42em] text-ink-subtle">
              {t("Discover")}
            </span>
            <h1 className="font-display text-[44px] font-medium leading-[1.05] tracking-tight text-ink">
              {t("Games")}
            </h1>
          </div>
          <button
            onClick={() => openGameBrowse({ title: "Search games", filter: {}, focusSearch: true })}
            className="flex h-11 min-w-[240px] items-center gap-2.5 rounded-full border border-edge bg-elevated/60 px-4 text-[14px] text-ink-subtle transition-colors hover:border-ink-subtle hover:text-ink"
          >
            <Search size={16} strokeWidth={1.9} />
            {t("Search games…")}
          </button>
        </header>

        <GameSectionRow section={popular} gate={gate} active={active} exclude={heroIds} />
        <GameSectionRow section={fresh} gate={gate} active={active} exclude={freshExclude} />
        {sections
          .filter((s) => !s.eager && s.id === "acclaimed")
          .map((s) => (
            <WhenNear key={s.id} minHeight={300} fallback={<GameRowSkeleton title={t(s.title)} />}>
              <GameSectionRow section={s} gate={gate} active={active} exclude={shownAbove} />
            </WhenNear>
          ))}
        <WhenNear minHeight={260} fallback={<GameRowSkeleton title={t("Franchise collections")} />}>
          <Row
            title={
              <RowTitle
                title={t("Franchise collections")}
                subtitle={t("Curated series, every game in release order")}
              />
            }
            shape="landscape"
            min={300}
            scrollKey="games-row-franchises"
          >
            {FRANCHISES.map((franchise) => (
              <FranchiseCard key={franchise.id} franchise={franchise} gate={gate} />
            ))}
          </Row>
        </WhenNear>
        {sections
          .filter((s) => !s.eager && s.id !== "acclaimed")
          .map((s) => (
            <WhenNear key={s.id} minHeight={300} fallback={<GameRowSkeleton title={t(s.title)} />}>
              <GameSectionRow section={s} gate={gate} active={active} exclude={shownAbove} />
            </WhenNear>
          ))}
        <WhenNear minHeight={200}>
          <GameGenreTiles />
        </WhenNear>
      </div>
    </>
  );
}
