import { ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";
import type { FranchiseGroupId, FranchiseSort } from "@/lib/game-discovery/franchise-resolve";
import { franchiseById } from "@/lib/game-discovery/franchises";
import {
  resolveFranchiseData,
  useFranchiseArt,
  useFranchiseGames,
} from "@/lib/game-discovery/queries";
import type { GameSummary } from "@/lib/game-discovery/types";
import type { RawgGateState } from "@/lib/game-discovery/use-rawg";
import { isRawgError } from "@/lib/providers/rawg";
import { useT } from "@/lib/i18n";
import { GameCard, GameCardSkeleton } from "./game-card";
import { GamesFrame } from "./games-frame";
import { GamesErrorState, GamesNotice } from "./games-state";
import { PillToggle } from "./pill-toggle";
import { SaveCollectionButton } from "./save-controls";

const GRID = "grid grid-cols-1 gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4";

export function GameFranchiseView({
  franchiseId,
  active,
}: {
  franchiseId: string;
  active: boolean;
}) {
  return (
    <GamesFrame scrollKey={`game-franchise-${franchiseId}`} active={active}>
      {(gate) => <FranchiseBody franchiseId={franchiseId} gate={gate} active={active} />}
    </GamesFrame>
  );
}

function FranchiseBody({
  franchiseId,
  gate,
  active,
}: {
  franchiseId: string;
  gate: RawgGateState;
  active: boolean;
}) {
  const t = useT();
  const def = franchiseById(franchiseId);
  const [sort, setSort] = useState<FranchiseSort>("release");
  const query = useFranchiseGames(gate, def, active);
  const art = useFranchiseArt(gate, def, active);
  const resolved = useMemo(
    () => (query.data ? resolveFranchiseData(query.data, sort) : null),
    [query.data, sort],
  );
  // A saved collection starts in release order, whatever the page is sorted by.
  const releaseOrder = useMemo(
    () => (query.data ? resolveFranchiseData(query.data, "release").groups.main : null),
    [query.data],
  );
  const aliases = query.data?.aliases;
  const slugOf = useMemo(
    () => (game: GameSummary) => aliases?.get(game.rawgId) ?? game.slug,
    [aliases],
  );

  if (!def) {
    return (
      <div className="px-5 pt-28 sm:px-8 lg:px-12">
        <GamesNotice>{t("This franchise isn't in the catalog.")}</GamesNotice>
      </div>
    );
  }

  const years =
    resolved?.firstYear && resolved.lastYear
      ? resolved.firstYear === resolved.lastYear
        ? `${resolved.firstYear}`
        : `${resolved.firstYear}–${resolved.lastYear}`
      : null;
  const sortOptions: { value: FranchiseSort; label: string }[] = [
    { value: "release", label: t("Release order") },
    ...(resolved?.hasStoryOrder ? [{ value: "story" as const, label: t("Story order") }] : []),
    { value: "metacritic", label: t("Metacritic") },
  ];

  return (
    <>
      {art.image && (
        <div
          aria-hidden
          className="harbor-bleed-stremio pointer-events-none absolute inset-x-0 top-0 -z-10 h-[680px]"
          style={{
            backgroundImage: `url(${art.image})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            filter: "blur(64px) saturate(1.35)",
            opacity: 0.24,
          }}
        />
      )}
      <div className="relative">
        {art.image && (
          <div className="harbor-bleed-stremio pointer-events-none absolute inset-x-0 top-0 h-[560px] overflow-hidden">
            <img src={art.image} alt="" className="h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-canvas via-canvas/70 to-canvas/10" />
            <div className="absolute inset-0 bg-gradient-to-r from-canvas/90 via-canvas/25 to-transparent rtl:bg-gradient-to-l" />
          </div>
        )}
        <div className="relative px-5 pt-28 sm:px-8 lg:px-12">
          <div className="mt-24 flex min-w-0 max-w-3xl flex-col pb-2">
            <p className="text-[12px] font-semibold uppercase tracking-[0.22em] text-ink-subtle">
              {t("Franchise")}
            </p>
            <h1 className="mt-2 font-display text-[clamp(34px,4.4vw,56px)] font-medium leading-[1.03] tracking-tight text-ink">
              {def.name}
            </h1>
            {resolved && resolved.mainCount > 0 && (
              <div className="mt-3.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13.5px] font-medium text-ink-muted">
                <span>{t("{n} mainline games", { n: resolved.mainCount })}</span>
                {years && (
                  <>
                    <span aria-hidden className="h-1 w-1 rounded-full bg-ink-subtle/60" />
                    <span className="tabular-nums">{years}</span>
                  </>
                )}
              </div>
            )}
            {def.description && (
              <p className="mt-4 line-clamp-3 text-[15px] leading-relaxed text-ink-muted">
                {def.description}
              </p>
            )}
            {releaseOrder && releaseOrder.length > 0 && (
              <div className="mt-7 flex flex-wrap items-center gap-3">
                <SaveCollectionButton
                  def={def}
                  games={releaseOrder}
                  slugOf={slugOf}
                  image={art.image}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-14 px-5 pb-12 pt-10 sm:px-8 lg:px-12">
        {query.isError ? (
          <GamesErrorState
            kind={isRawgError(query.error) ? query.error.kind : null}
            onRetry={() => void query.refetch()}
          />
        ) : !resolved ? (
          <div className={GRID}>
            {Array.from({ length: 6 }).map((_, i) => (
              <GameCardSkeleton key={i} />
            ))}
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-4">
              <PillToggle value={sort} options={sortOptions} onChange={setSort} />
            </div>
            {resolved.mainCount === 0 &&
            resolved.groups.remakes.length === 0 &&
            resolved.groups.spinoffs.length === 0 ? (
              <GamesNotice>{t("RAWG returned no games for this franchise.")}</GamesNotice>
            ) : null}
            <Group id="main" title={t("Main series")} games={resolved.groups.main} />
            <Group id="remakes" title={t("Remakes & remasters")} games={resolved.groups.remakes} />
            <Group id="spinoffs" title={t("Spin-offs")} games={resolved.groups.spinoffs} />
            <Group
              id="editions"
              title={t("Editions & re-releases")}
              games={resolved.groups.editions}
            />
            <Group
              id="other"
              title={t("More in RAWG's series data")}
              note={t(
                "Listed by RAWG as part of the series. Not curated, so it may include editions or related titles.",
              )}
              games={resolved.groups.other}
              collapsible
            />
          </>
        )}
      </div>
    </>
  );
}

function Group({
  id,
  title,
  note,
  games,
  collapsible = false,
}: {
  id: FranchiseGroupId;
  title: string;
  note?: string;
  games: GameSummary[];
  collapsible?: boolean;
}) {
  const [open, setOpen] = useState(!collapsible);
  if (games.length === 0) return null;
  return (
    <section className="flex flex-col gap-5" data-scroll-anchor={`franchise-${id}`}>
      <div className="flex flex-col gap-1">
        {collapsible ? (
          <button
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="flex w-fit items-center gap-2 text-[13px] font-bold uppercase tracking-[0.2em] text-ink-subtle transition-colors hover:text-ink"
          >
            {title} · {games.length}
            <ChevronDown size={15} className={`transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        ) : (
          <h2 className="text-[13px] font-bold uppercase tracking-[0.2em] text-ink-subtle">
            {title} · {games.length}
          </h2>
        )}
        {note && open && <p className="text-[12.5px] text-ink-subtle">{note}</p>}
      </div>
      {open && (
        <div className={GRID}>
          {games.map((game) => (
            <GameCard key={game.rawgId} game={game} />
          ))}
        </div>
      )}
    </section>
  );
}
