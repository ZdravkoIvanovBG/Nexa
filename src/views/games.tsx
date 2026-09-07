import { Gamepad2 } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { VirtualGrid } from "@/components/virtual-grid";
import { useT } from "@/lib/i18n";
import { useScrollMemory, useView } from "@/lib/view";
import { useGames } from "@/lib/games/provider";
import type { GamePlatform, GameSort } from "@/lib/games/types";
import { GameCard } from "./games/game-card";
import { LibraryHeader } from "./games/library-header";

const AddGameModal = lazy(() =>
  import("./games/add-game-modal").then((m) => ({ default: m.AddGameModal })),
);

export function GamesView({ active }: { active: boolean }) {
  const t = useT();
  const { openGameDetail } = useView();
  const { games, loading, activeSessions, refresh } = useGames();
  const [platform, setPlatform] = useState<GamePlatform | "all">("all");
  const [sort, setSort] = useState<GameSort>("recent");
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const scrollRef = useRef<HTMLElement>(null);
  useScrollMemory("games", scrollRef, active);

  useEffect(() => {
    const id = window.setTimeout(() => {
      void refresh({ platform, sort, search });
    }, 150);
    return () => window.clearTimeout(id);
  }, [platform, sort, search, refresh]);

  const playingGameIds = new Set([...activeSessions.values()].map((s) => s.gameId));

  return (
    <main
      ref={scrollRef}
      className="flex-1 overflow-y-auto px-5 pt-24 pb-14 sm:px-8 lg:px-12 lg:pt-28"
    >
      <div data-tauri-drag-region className="flex flex-col gap-7">
        <LibraryHeader
          platform={platform}
          onPlatform={setPlatform}
          sort={sort}
          onSort={setSort}
          search={search}
          onSearch={setSearch}
          onAddGame={() => setAddOpen(true)}
        />
        {!loading && games.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-edge-soft bg-canvas/30 px-8 py-16 text-center">
            <Gamepad2 size={28} strokeWidth={1.6} className="text-ink-subtle" />
            <h2 className="text-[16px] font-semibold text-ink">{t("No games yet")}</h2>
            <p className="max-w-md text-[13px] leading-relaxed text-ink-muted">
              {t("Add a game manually, or scan Steam for installed titles from Settings.")}
            </p>
          </div>
        ) : (
          <VirtualGrid
            items={games}
            scrollRef={scrollRef}
            minColumnWidth={150}
            gapX={16}
            gapY={28}
            estimateRowHeight={250}
            getKey={(g) => g.id}
            renderItem={(g) => (
              <GameCard
                game={g}
                playing={playingGameIds.has(g.id)}
                onOpen={() => openGameDetail(g.id)}
              />
            )}
          />
        )}
      </div>
      {addOpen && (
        <Suspense fallback={null}>
          <AddGameModal onClose={() => setAddOpen(false)} />
        </Suspense>
      )}
    </main>
  );
}
