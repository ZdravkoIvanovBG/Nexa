import { Row } from "@/components/row";
import { useGameList } from "@/lib/game-discovery/queries";
import type { GameSection } from "@/lib/game-discovery/sections";
import type { GameId, GameSummary } from "@/lib/game-discovery/types";
import type { GamesGate } from "@/lib/game-discovery/use-games-gate";
import { useT } from "@/lib/i18n";
import { useView } from "@/lib/view";
import { GameCard, GameCardSkeleton } from "./game-card";

const ROW_PAGE_SIZE = 20;
const MIN_ITEMS = 4;

export function RowTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <span className="flex items-baseline gap-3">
      <span>{title}</span>
      {subtitle && (
        <span className="text-[12.5px] font-normal tracking-normal text-ink-subtle">
          {subtitle}
        </span>
      )}
    </span>
  );
}

/** A horizontal discovery rail backed by one provider list query. Hides itself when empty or failed. */
export function GameSectionRow({
  section,
  gate,
  active,
  exclude,
}: {
  section: GameSection;
  gate: GamesGate;
  active: boolean;
  /** Games already shown above (hero, earlier rows). */
  exclude?: ReadonlySet<GameId>;
}) {
  const t = useT();
  const { openGameBrowse } = useView();
  const query = useGameList(gate, section.filter, ROW_PAGE_SIZE, active);
  const items = (query.data?.items ?? []).filter((g) => !exclude?.has(g.id));

  if (query.isError) return null;
  if (!query.data) return <GameRowSkeleton title={t(section.title)} />;
  if (items.length < MIN_ITEMS) return null;

  return (
    <GameRail
      title={<RowTitle title={t(section.title)} subtitle={t(section.subtitle)} />}
      games={items}
      scrollKey={`games-row-${section.id}`}
      onViewAll={() =>
        openGameBrowse({
          title: section.title,
          kicker: section.subtitle,
          filter: section.filter,
          // IGDB rows name a recipe only IGDB knows.
          ...(section.filter.section ? { provider: gate.provider } : {}),
        })
      }
    />
  );
}

export function GameRail({
  title,
  games,
  scrollKey,
  onViewAll,
}: {
  title: React.ReactNode;
  games: GameSummary[];
  scrollKey: string;
  onViewAll?: () => void;
}) {
  const t = useT();
  return (
    <Row
      title={title}
      shape="landscape"
      min={260}
      scrollKey={scrollKey}
      onViewAll={onViewAll}
      viewAllLabel={t("See all")}
    >
      {games.map((game) => (
        <GameCard key={game.id} game={game} />
      ))}
    </Row>
  );
}

export function GameRowSkeleton({ title }: { title?: string }) {
  return (
    <div className="flex flex-col gap-4">
      {title ? (
        <span className="text-[17px] font-medium tracking-tight text-ink-subtle">{title}</span>
      ) : (
        <div className="h-5 w-48 animate-pulse rounded bg-elevated/50" />
      )}
      <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className={i >= 2 ? "hidden sm:block" : ""}>
            <GameCardSkeleton />
          </div>
        ))}
      </div>
    </div>
  );
}
