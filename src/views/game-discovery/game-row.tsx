import { Row } from "@/components/row";
import type { GameProvider } from "@/lib/game-discovery/game-id";
import { providerFeatures } from "@/lib/game-discovery/provider";
import { useGameList } from "@/lib/game-discovery/queries";
import type { GameSection } from "@/lib/game-discovery/sections";
import type { GameId, GameSummary } from "@/lib/game-discovery/types";
import type { GamesGate } from "@/lib/game-discovery/use-games-gate";
import { useT } from "@/lib/i18n";
import { useView } from "@/lib/view";
import { GameCard, GameCardSkeleton, type GameCardShape } from "./game-card";

const ROW_PAGE_SIZE = 20;
const MIN_ITEMS = 4;

/** The card shape for the active provider (RAWG landscape, IGDB covers). */
export function cardShapeOf(gate: { provider: GameProvider }): GameCardShape {
  return providerFeatures(gate.provider).cards;
}

/** Card widths per shape: covers sit a little wider than movie posters (144). */
export const CARD_MIN_WIDTH: Record<GameCardShape, number> = { landscape: 260, cover: 168 };

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

  const shape = cardShapeOf(gate);
  if (query.isError) return null;
  if (!query.data) return <GameRowSkeleton title={t(section.title)} shape={shape} />;
  if (items.length < MIN_ITEMS) return null;

  return (
    <GameRail
      title={<RowTitle title={t(section.title)} subtitle={t(section.subtitle)} />}
      games={items}
      shape={shape}
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
  shape = "landscape",
}: {
  title: React.ReactNode;
  games: GameSummary[];
  scrollKey: string;
  onViewAll?: () => void;
  shape?: GameCardShape;
}) {
  const t = useT();
  return (
    <Row
      title={title}
      shape={shape}
      min={CARD_MIN_WIDTH[shape]}
      scrollKey={scrollKey}
      onViewAll={onViewAll}
      viewAllLabel={t("See all")}
    >
      {games.map((game) => (
        <GameCard key={game.id} game={game} shape={shape} />
      ))}
    </Row>
  );
}

export function GameRowSkeleton({
  title,
  shape = "landscape",
}: {
  title?: string;
  shape?: GameCardShape;
}) {
  return (
    <div className="flex flex-col gap-4">
      {title ? (
        <span className="text-[17px] font-medium tracking-tight text-ink-subtle">{title}</span>
      ) : (
        <div className="h-5 w-48 animate-pulse rounded bg-elevated/50" />
      )}
      <div
        className={
          shape === "cover"
            ? "grid grid-cols-3 gap-5 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8"
            : "grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
        }
      >
        {Array.from({ length: shape === "cover" ? 8 : 5 }).map((_, i) => (
          <div
            key={i}
            className={
              shape === "cover"
                ? i >= 6
                  ? "hidden xl:block"
                  : i >= 4
                    ? "hidden lg:block"
                    : i >= 3
                      ? "hidden sm:block"
                      : ""
                : i >= 2
                  ? "hidden sm:block"
                  : ""
            }
          >
            <GameCardSkeleton shape={shape} />
          </div>
        ))}
      </div>
    </div>
  );
}
