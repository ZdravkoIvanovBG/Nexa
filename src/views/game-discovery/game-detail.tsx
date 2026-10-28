import { ArrowLeft, ExternalLink, Layers, Star } from "lucide-react";
import { useState } from "react";
import { franchiseForSlug } from "@/lib/game-discovery/franchises";
import {
  useDeveloperGames,
  useGameDetail,
  useGameRelated,
  useGameScreenshots,
  type RelatedKind,
} from "@/lib/game-discovery/queries";
import { rawgSessionStatus } from "@/lib/game-discovery/status";
import type { GameDetail, GameSummary } from "@/lib/game-discovery/types";
import type { RawgGateState } from "@/lib/game-discovery/use-rawg";
import { isRawgError } from "@/lib/providers/rawg";
import { rawgImage } from "@/lib/providers/rawg/image";
import { useT } from "@/lib/i18n";
import { useView } from "@/lib/view";
import { openUrl } from "@/lib/window";
import { HeroBackdrop } from "../detail/hero-backdrop";
import { MediaRail } from "../detail/media-gallery/media-rail";
import { MediaLightbox } from "../detail/media-lightbox";
import { Pill } from "../detail/pill";
import { Synopsis } from "../detail/synopsis";
import { TitlePlate } from "../detail/title-plate";
import { formatReleaseDate, releaseYear } from "./format";
import { MetacriticBadge } from "./game-card";
import { GameRail, GameRowSkeleton } from "./game-row";
import { GamesFrame } from "./games-frame";
import { GamesErrorState, GamesNotice } from "./games-state";
import { WhenNear } from "./when-near";

export function GameDetailView({
  gameId,
  seed,
  active,
}: {
  gameId: number;
  seed?: GameSummary;
  active: boolean;
}) {
  return (
    <GamesFrame scrollKey={`game-${gameId}`} active={active}>
      {(gate) => <GameDetailBody gameId={gameId} seed={seed} gate={gate} active={active} />}
    </GamesFrame>
  );
}

function GameDetailBody({
  gameId,
  seed,
  gate,
  active,
}: {
  gameId: number;
  seed?: GameSummary;
  gate: RawgGateState;
  active: boolean;
}) {
  const t = useT();
  const { goBack, canGoBack } = useView();
  const query = useGameDetail(gate, gameId, active);
  const detail = query.data ?? null;
  // The card's summary paints immediately while the detail request runs.
  const game: GameSummary | null = detail ?? seed ?? null;

  if (query.isSuccess && !detail) {
    return (
      <div className="px-5 pt-28 sm:px-8 lg:px-12">
        <GamesNotice>
          <div className="flex flex-col items-center gap-4">
            {t("RAWG has no game with this id.")}
            {canGoBack && (
              <button
                onClick={goBack}
                className="flex h-10 items-center gap-2 rounded-full border border-edge px-5 text-[13.5px] text-ink hover:bg-elevated"
              >
                <ArrowLeft size={15} className="dir-icon" />
                {t("Back")}
              </button>
            )}
          </div>
        </GamesNotice>
      </div>
    );
  }
  if (!game) {
    if (query.isError) {
      return (
        <div className="px-5 pt-28 sm:px-8 lg:px-12">
          <GamesErrorState
            kind={isRawgError(query.error) ? query.error.kind : null}
            onRetry={() => void query.refetch()}
          />
        </div>
      );
    }
    return (
      <div className="harbor-bleed-stremio h-[78vh] min-h-[640px] animate-pulse bg-elevated/30" />
    );
  }

  const backdrop = game.image ?? detail?.imageAlt ?? null;
  const franchise = franchiseForSlug(game.slug);

  return (
    <>
      <section className="relative">
        <div className="harbor-bleed-stremio relative h-[78vh] min-h-[640px] overflow-hidden bg-canvas">
          {backdrop && <HeroBackdrop url={backdrop} />}
          <div className="absolute inset-0 bg-gradient-to-t from-canvas via-canvas/55 via-45% to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-canvas/85 via-canvas/35 to-transparent rtl:bg-gradient-to-l" />
          <div className="absolute inset-x-0 bottom-0 px-5 pb-14 sm:px-8 lg:px-12">
            <TitlePlate title={game.name} loading={false} />
            <div className="mt-6 flex flex-wrap items-center gap-2 text-[13px] text-ink-muted">
              <Pill>
                {game.released
                  ? (formatReleaseDate(game.released) ?? releaseYear(game))
                  : game.tba
                    ? t("TBA")
                    : t("Release date unknown")}
              </Pill>
              {game.genres.slice(0, 3).map((g) => (
                <Pill key={g.id}>{g.name}</Pill>
              ))}
              {game.esrb && <Pill>{game.esrb}</Pill>}
              {detail?.playtime ? (
                <Pill>{t("~{n} h average playtime", { n: detail.playtime })}</Pill>
              ) : null}
            </div>
            <Scores game={game} />
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <button
                onClick={() => openUrl(`https://rawg.io/games/${game.slug}`)}
                className="flex h-12 items-center gap-2.5 rounded-full border border-edge bg-canvas/50 px-6 text-[14.5px] font-medium text-ink backdrop-blur-sm transition-colors duration-200 hover:bg-canvas/70"
              >
                <ExternalLink size={16} strokeWidth={2} />
                {t("View on RAWG")}
              </button>
            </div>
          </div>
        </div>
      </section>

      <div className="flex flex-col gap-16 px-5 pb-12 pt-14 sm:px-8 lg:px-12">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex flex-col gap-6">
            {detail?.description ? (
              <Synopsis text={detail.description} />
            ) : query.isPending ? (
              <div className="flex max-w-3xl flex-col gap-2">
                <div className="h-4 w-full animate-pulse rounded bg-elevated/40" />
                <div className="h-4 w-11/12 animate-pulse rounded bg-elevated/40" />
                <div className="h-4 w-2/3 animate-pulse rounded bg-elevated/40" />
              </div>
            ) : null}
            {franchise && <FranchiseLink id={franchise.id} name={franchise.name} />}
          </div>
          {detail && <InfoBlock detail={detail} />}
        </div>

        <Screenshots game={game} detail={detail} gate={gate} active={active} />

        {detail && detail.counts.series > 0 && (
          <RelatedRow
            title={t("More in this series")}
            gameId={game.rawgId}
            kind="game-series"
            gate={gate}
            active={active}
          />
        )}
        {detail && detail.counts.additions > 0 && (
          <RelatedRow
            title={t("DLC & expansions")}
            gameId={game.rawgId}
            kind="additions"
            gate={gate}
            active={active}
          />
        )}
        {detail && detail.counts.parents > 0 && (
          <RelatedRow
            title={t("Part of")}
            gameId={game.rawgId}
            kind="parent-games"
            gate={gate}
            active={active}
          />
        )}
        {detail && detail.developers[0] && (
          <DeveloperRow
            developerId={detail.developers[0].id}
            developerName={detail.developers[0].name}
            exclude={game.rawgId}
            gate={gate}
            active={active}
          />
        )}
      </div>
    </>
  );
}

function Scores({ game }: { game: GameSummary }) {
  const t = useT();
  if (game.metacritic === null && game.rating === null) return null;
  return (
    <div className="mt-5 flex flex-wrap items-center gap-6 text-[13.5px] text-ink-muted">
      {game.metacritic !== null && (
        <span className="flex items-center gap-2">
          <MetacriticBadge score={game.metacritic} size="md" />
          <span className="font-medium text-ink">{t("Metacritic")}</span>
        </span>
      )}
      {game.rating !== null && (
        <span className="flex items-center gap-2" title={t("RAWG community rating")}>
          <Star size={15} className="fill-current text-accent" />
          <span className="font-semibold tabular-nums text-ink">{game.rating.toFixed(2)}</span>
          <span>/ 5 · {t("RAWG")}</span>
          {game.ratingsCount > 0 && (
            <span className="text-ink-subtle">
              {t("{n} ratings", { n: game.ratingsCount.toLocaleString() })}
            </span>
          )}
        </span>
      )}
    </div>
  );
}

function FranchiseLink({ id, name }: { id: string; name: string }) {
  const t = useT();
  const { openGameFranchise } = useView();
  return (
    <button
      onClick={() => openGameFranchise(id)}
      className="flex w-fit items-center gap-3 rounded-2xl border border-edge-soft bg-elevated/40 px-4 py-3 text-start transition-colors hover:border-edge hover:bg-elevated/70"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-canvas text-ink-muted ring-1 ring-edge-soft">
        <Layers size={16} strokeWidth={2} />
      </span>
      <span className="flex flex-col">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-subtle">
          {t("Part of the franchise")}
        </span>
        <span className="text-[15px] font-medium text-ink">{name}</span>
      </span>
    </button>
  );
}

function InfoBlock({ detail }: { detail: GameDetail }) {
  const t = useT();
  const rows: { label: string; value: React.ReactNode }[] = [];
  if (detail.platforms.length > 0) {
    rows.push({ label: t("Platforms"), value: detail.platforms.map((p) => p.name).join(", ") });
  }
  if (detail.developers.length > 0) {
    rows.push({ label: t("Developers"), value: detail.developers.map((d) => d.name).join(", ") });
  }
  if (detail.publishers.length > 0) {
    rows.push({ label: t("Publishers"), value: detail.publishers.map((p) => p.name).join(", ") });
  }
  const released = formatReleaseDate(detail.released);
  if (released) rows.push({ label: t("Release date"), value: released });
  if (detail.website) {
    rows.push({
      label: t("Website"),
      value: (
        <button
          onClick={() => openUrl(detail.website!)}
          className="inline-flex max-w-full items-center gap-1 truncate text-ink underline-offset-4 hover:underline"
        >
          <span className="truncate">
            {detail.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
          </span>
          <ExternalLink size={12} className="shrink-0" />
        </button>
      ),
    });
  }
  if (rows.length === 0 && detail.tags.length === 0) return null;
  return (
    <aside className="flex flex-col gap-5 rounded-2xl border border-edge-soft bg-elevated/30 p-6">
      {rows.map((row) => (
        <div key={row.label} className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-subtle">
            {row.label}
          </span>
          <span className="text-[14px] leading-relaxed text-ink">{row.value}</span>
        </div>
      ))}
      {detail.tags.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-subtle">
            {t("Tags")}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {detail.tags.slice(0, 12).map((tag) => (
              <span
                key={tag.id}
                className="rounded-full border border-edge-soft bg-canvas/60 px-2.5 py-0.5 text-[12px] text-ink-muted"
              >
                {tag.name}
              </span>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}

function Screenshots({
  game,
  detail,
  gate,
  active,
}: {
  game: GameSummary;
  detail: GameDetail | null;
  gate: RawgGateState;
  active: boolean;
}) {
  const t = useT();
  const [viewAll, setViewAll] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const seeded = game.shortScreenshots;
  // List responses carry a few screenshots for free; the full set is one request, on demand.
  const needFetch = seeded.length === 0 || viewAll;
  const unavailable = rawgSessionStatus.isCapabilityUnavailable("screenshots");
  const query = useGameScreenshots(gate, game.rawgId, active && needFetch && !unavailable);
  const images = viewAll || seeded.length === 0 ? (query.data ?? seeded) : seeded;
  const total = detail?.counts.screenshots ?? 0;
  if (images.length === 0) return null;
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="text-[17px] font-medium tracking-tight text-ink">{t("Screenshots")}</h3>
        {!viewAll && !unavailable && total > images.length && (
          <button
            onClick={() => setViewAll(true)}
            className="text-[13px] text-ink-muted transition-colors hover:text-ink"
          >
            {t("View all {n}", { n: total })}
          </button>
        )}
      </div>
      <MediaRail>
        {images.map((src, i) => {
          const [thumb, ...fallbacks] = rawgImage(src, 640);
          return (
            <button
              key={src}
              type="button"
              onClick={() => setLightbox(i)}
              className="group relative block w-[300px] shrink-0 cursor-zoom-in overflow-hidden rounded-xl bg-elevated/40"
            >
              <img
                src={thumb}
                alt=""
                loading="lazy"
                onError={(e) => {
                  if (fallbacks[0] && e.currentTarget.src !== fallbacks[0])
                    e.currentTarget.src = fallbacks[0];
                }}
                className="aspect-video w-full object-cover transition-transform duration-300 group-hover:scale-105"
              />
            </button>
          );
        })}
      </MediaRail>
      {lightbox !== null && (
        <MediaLightbox images={images} index={lightbox} onClose={() => setLightbox(null)} />
      )}
    </section>
  );
}

function RelatedRow({
  title,
  gameId,
  kind,
  gate,
  active,
}: {
  title: string;
  gameId: number;
  kind: RelatedKind;
  gate: RawgGateState;
  active: boolean;
}) {
  return (
    <WhenNear minHeight={260} fallback={<GameRowSkeleton title={title} />}>
      <RelatedRowBody title={title} gameId={gameId} kind={kind} gate={gate} active={active} />
    </WhenNear>
  );
}

function RelatedRowBody({
  title,
  gameId,
  kind,
  gate,
  active,
}: {
  title: string;
  gameId: number;
  kind: RelatedKind;
  gate: RawgGateState;
  active: boolean;
}) {
  const query = useGameRelated(gate, gameId, kind, active);
  if (query.isError) return null;
  if (!query.data) return <GameRowSkeleton title={title} />;
  const games = query.data.filter((g) => g.rawgId !== gameId);
  if (games.length === 0) return null;
  return <GameRail title={title} games={games} scrollKey={`game-${gameId}-${kind}`} />;
}

function DeveloperRow({
  developerId,
  developerName,
  exclude,
  gate,
  active,
}: {
  developerId: number;
  developerName: string;
  exclude: number;
  gate: RawgGateState;
  active: boolean;
}) {
  const t = useT();
  const title = t("More from {name}", { name: developerName });
  return (
    <WhenNear minHeight={260} fallback={<GameRowSkeleton title={title} />}>
      <DeveloperRowBody
        title={title}
        developerId={developerId}
        exclude={exclude}
        gate={gate}
        active={active}
      />
    </WhenNear>
  );
}

function DeveloperRowBody({
  title,
  developerId,
  exclude,
  gate,
  active,
}: {
  title: string;
  developerId: number;
  exclude: number;
  gate: RawgGateState;
  active: boolean;
}) {
  const { openGameBrowse } = useView();
  const query = useDeveloperGames(gate, developerId, active);
  if (query.isError) return null;
  if (!query.data) return <GameRowSkeleton title={title} />;
  const games = query.data.filter((g) => g.rawgId !== exclude);
  if (games.length < 2) return null;
  return (
    <GameRail
      title={title}
      games={games}
      scrollKey={`dev-${developerId}`}
      onViewAll={() =>
        openGameBrowse({
          title,
          filter: { developers: String(developerId), ordering: "-added" },
        })
      }
    />
  );
}
