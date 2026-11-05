import { ArrowLeft, ExternalLink, Layers, Star } from "lucide-react";
import { useState } from "react";
import { gamesErrorKind } from "@/lib/game-discovery/errors";
import { providerPageUrl, safeExternalUrl } from "@/lib/game-discovery/external-url";
import { franchiseForSlug } from "@/lib/game-discovery/franchises";
import { providerOf } from "@/lib/game-discovery/game-id";
import { gameImage } from "@/lib/game-discovery/game-image";
import { providerFeatures } from "@/lib/game-discovery/provider";
import {
  useDeveloperGames,
  useGameDetail,
  useGameRelated,
  useGameScreenshots,
  type RelatedKind,
} from "@/lib/game-discovery/queries";
import { rawgSessionStatus } from "@/lib/game-discovery/status";
import type { GameDetail, GameId, GameProvider, GameSummary } from "@/lib/game-discovery/types";
import type { GamesGate } from "@/lib/game-discovery/use-games-gate";
import { useT } from "@/lib/i18n";
import { useView } from "@/lib/view";
import { openUrl } from "@/lib/window";
import { HeroBackdrop } from "../detail/hero-backdrop";
import { MediaRail } from "../detail/media-gallery/media-rail";
import { MediaLightbox } from "../detail/media-lightbox";
import { Pill } from "../detail/pill";
import { Synopsis } from "../detail/synopsis";
import { TitlePlate } from "../detail/title-plate";
import {
  criticScoreOf,
  formatReleaseDate,
  heroImageOf,
  releaseYear,
  userScoreOf,
  VARIANT_LABEL,
} from "./format";
import { MetacriticBadge, PortraitFill } from "./game-card";
import { SaveGameButton, useRefreshSavedGame } from "./save-controls";
import { cardShapeOf, GameRail, GameRowSkeleton } from "./game-row";
import { GamesFrame } from "./games-frame";
import { GamesErrorState, GamesNotice } from "./games-state";
import { WhenNear } from "./when-near";

export function GameDetailView({
  gameId,
  seed,
  active,
}: {
  gameId: GameId;
  seed?: GameSummary;
  active: boolean;
}) {
  return (
    <GamesFrame scrollKey={`game-${gameId}`} active={active}>
      {(gate) =>
        providerOf(gameId) === gate.provider ? (
          <GameDetailBody gameId={gameId} seed={seed} gate={gate} active={active} />
        ) : (
          <OtherProviderGame gameId={gameId} seed={seed} />
        )
      }
    </GamesFrame>
  );
}

const PROVIDER_NAME: Record<GameProvider, string> = { rawg: "RAWG", igdb: "IGDB" };

/**
 * A game from another provider (a saved RAWG record opened while IGDB is
 * active, or the reverse). Its id means nothing to the active provider, so no
 * request is made: the saved snapshot is shown as is and the library entry
 * keeps working. Matching it to the active provider is Stage 6.
 */
function OtherProviderGame({ gameId, seed }: { gameId: GameId; seed?: GameSummary }) {
  const t = useT();
  const { goBack, canGoBack } = useView();
  const source = providerOf(gameId);
  const link = seed ? providerPageUrl(source, seed.slug) : null;
  const note = t(
    "This game was saved from {provider}. Its full details appear when {provider} is the active game data provider; matching saved games across providers comes in a later update.",
    { provider: PROVIDER_NAME[source] },
  );
  if (!seed) {
    return (
      <div className="px-5 pt-28 sm:px-8 lg:px-12">
        <GamesNotice>
          <div className="flex flex-col items-center gap-4">
            {note}
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
  return (
    <>
      <section className="relative">
        <div className="harbor-bleed-stremio relative h-[78vh] min-h-[640px] overflow-hidden bg-canvas">
          {seed.image && <HeroBackdrop url={seed.image} />}
          <div className="absolute inset-0 bg-gradient-to-t from-canvas via-canvas/55 via-45% to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-canvas/85 via-canvas/35 to-transparent rtl:bg-gradient-to-l" />
          <div className="absolute inset-x-0 bottom-0 px-5 pb-14 sm:px-8 lg:px-12">
            <TitlePlate title={seed.name} loading={false} />
            <div className="mt-6 flex flex-wrap items-center gap-2 text-[13px] text-ink-muted">
              <Pill>
                {seed.released
                  ? (formatReleaseDate(seed.released) ?? releaseYear(seed))
                  : t("Release date unknown")}
              </Pill>
              <Pill>{t("Saved from {provider}", { provider: PROVIDER_NAME[source] })}</Pill>
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <SaveGameButton game={seed} franchise={null} />
              {link && (
                <button
                  onClick={() => openUrl(link)}
                  className="flex h-12 items-center gap-2.5 rounded-full border border-edge bg-canvas/50 px-6 text-[14.5px] font-medium text-ink backdrop-blur-sm transition-colors duration-200 hover:bg-canvas/70"
                >
                  <ExternalLink size={16} strokeWidth={2} />
                  {t("View on {provider}", { provider: PROVIDER_NAME[source] })}
                </button>
              )}
            </div>
          </div>
        </div>
      </section>
      <div className="px-5 pb-12 pt-14 sm:px-8 lg:px-12">
        <GamesNotice>{note}</GamesNotice>
      </div>
    </>
  );
}

function GameDetailBody({
  gameId,
  seed,
  gate,
  active,
}: {
  gameId: GameId;
  seed?: GameSummary;
  gate: GamesGate;
  active: boolean;
}) {
  const t = useT();
  const { goBack, canGoBack } = useView();
  const query = useGameDetail(gate, gameId, active);
  const igdb = gate.provider === "igdb";
  const detail = query.data ?? null;
  // The card's summary paints immediately while the detail request runs.
  const game: GameSummary | null = detail ?? seed ?? null;
  useRefreshSavedGame(detail);

  if (query.isSuccess && !detail) {
    return (
      <div className="px-5 pt-28 sm:px-8 lg:px-12">
        <GamesNotice>
          <div className="flex flex-col items-center gap-4">
            {igdb ? t("This game isn't available on IGDB.") : t("RAWG has no game with this id.")}
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
            provider={gate.provider}
            kind={gamesErrorKind(query.error)}
            onRetry={() => void query.refetch()}
          />
        </div>
      );
    }
    return (
      <div className="harbor-bleed-stremio h-[78vh] min-h-[640px] animate-pulse bg-elevated/30" />
    );
  }

  // Hero-quality art first, then the card's landscape art, then another
  // landscape image. A portrait cover is never stretched into the backdrop:
  // it gets a blurred fill instead.
  const portrait = game.imageKind === "portrait";
  const backdrop = heroImageOf(game) ?? (portrait ? null : game.image) ?? detail?.imageAlt ?? null;
  // Curated franchises are keyed by RAWG slugs until Stage 5 maps them to IGDB.
  const franchise = providerFeatures(gate.provider).franchises ? franchiseForSlug(game.slug) : null;
  const page = providerPageUrl(gate.provider, game.slug, detail?.providerUrl);

  return (
    <>
      <section className="relative">
        <div className="harbor-bleed-stremio relative h-[78vh] min-h-[640px] overflow-hidden bg-canvas">
          {backdrop ? (
            <HeroBackdrop url={backdrop} />
          ) : portrait && game.image ? (
            <PortraitFill src={game.image} lazy={false} />
          ) : null}
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
              {game.variant && <Pill>{t(VARIANT_LABEL[game.variant])}</Pill>}
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
              <SaveGameButton game={game} franchise={franchise} />
              {page && (
                <button
                  onClick={() => openUrl(page)}
                  className="flex h-12 items-center gap-2.5 rounded-full border border-edge bg-canvas/50 px-6 text-[14.5px] font-medium text-ink backdrop-blur-sm transition-colors duration-200 hover:bg-canvas/70"
                >
                  <ExternalLink size={16} strokeWidth={2} />
                  {igdb ? t("View on IGDB") : t("View on RAWG")}
                </button>
              )}
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
            {detail?.storyline && (
              <div className="flex flex-col gap-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-subtle">
                  {t("Storyline")}
                </h3>
                <Synopsis text={detail.storyline} />
              </div>
            )}
            {franchise && <FranchiseLink id={franchise.id} name={franchise.name} />}
          </div>
          {detail && <InfoBlock detail={detail} />}
        </div>

        <Screenshots game={game} detail={detail} gate={gate} active={active} />

        {detail && detail.counts.series > 0 && (
          <RelatedRow
            title={t("More in this series")}
            gameId={game.id}
            kind="game-series"
            gate={gate}
            active={active}
          />
        )}
        {detail && detail.counts.additions > 0 && (
          <RelatedRow
            title={t("DLC & expansions")}
            gameId={game.id}
            kind="additions"
            gate={gate}
            active={active}
          />
        )}
        {detail && detail.counts.parents > 0 && (
          <RelatedRow
            title={igdb ? t("Original game") : t("Part of")}
            gameId={game.id}
            kind="parent-games"
            gate={gate}
            active={active}
          />
        )}
        {detail && (detail.counts.versions ?? 0) > 0 && (
          <RelatedRow
            title={t("Remakes & remasters")}
            gameId={game.id}
            kind="versions"
            gate={gate}
            active={active}
          />
        )}
        {detail && (detail.counts.similar ?? 0) > 0 && (
          <RelatedRow
            title={t("Similar games")}
            gameId={game.id}
            kind="similar"
            gate={gate}
            active={active}
          />
        )}
        {detail && detail.developers[0] && (
          <DeveloperRow
            developerId={detail.developers[0].id}
            developerName={detail.developers[0].name}
            exclude={game.id}
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
  const critic = criticScoreOf(game);
  const user = userScoreOf(game);
  if (!critic && !user && game.rating === null) return null;
  return (
    <div className="mt-5 flex flex-wrap items-center gap-6 text-[13.5px] text-ink-muted">
      {critic && (
        <span className="flex items-center gap-2">
          <MetacriticBadge
            score={critic.score}
            size="md"
            title={critic.label === "Metacritic" ? t("Metacritic score") : t("Critic score")}
          />
          <span className="font-medium text-ink">{t(critic.label)}</span>
          {critic.count > 0 && (
            <span className="text-ink-subtle">
              {t("{n} critic reviews", { n: critic.count.toLocaleString() })}
            </span>
          )}
        </span>
      )}
      {user && (
        <span className="flex items-center gap-2" title={t("IGDB user score")}>
          <Star size={15} className="fill-current text-accent" />
          <span className="font-semibold tabular-nums text-ink">{user.score}</span>
          <span>/ 100 · {t("User score")}</span>
          {user.count > 0 && (
            <span className="text-ink-subtle">
              {t("{n} ratings", { n: user.count.toLocaleString() })}
            </span>
          )}
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
  const website = safeExternalUrl(detail.website);
  if (website) {
    rows.push({
      label: t("Website"),
      value: (
        <button
          onClick={() => openUrl(website)}
          className="inline-flex max-w-full items-center gap-1 truncate text-ink underline-offset-4 hover:underline"
        >
          <span className="truncate">{website.replace(/^https?:\/\//, "").replace(/\/$/, "")}</span>
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
  gate: GamesGate;
  active: boolean;
}) {
  const t = useT();
  const [viewAll, setViewAll] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const seeded = game.shortScreenshots;
  // List responses carry a few screenshots for free; the full set is one request, on demand.
  const needFetch = seeded.length === 0 || viewAll;
  const unavailable =
    gate.provider === "rawg" && rawgSessionStatus.isCapabilityUnavailable("screenshots");
  const query = useGameScreenshots(gate, game.id, active && needFetch && !unavailable);
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
          const [thumb, ...fallbacks] = gameImage(src, 640);
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
  gameId: GameId;
  kind: RelatedKind;
  gate: GamesGate;
  active: boolean;
}) {
  return (
    <WhenNear
      minHeight={260}
      fallback={<GameRowSkeleton title={title} shape={cardShapeOf(gate)} />}
    >
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
  gameId: GameId;
  kind: RelatedKind;
  gate: GamesGate;
  active: boolean;
}) {
  const query = useGameRelated(gate, gameId, kind, active);
  if (query.isError) return null;
  if (!query.data) return <GameRowSkeleton title={title} shape={cardShapeOf(gate)} />;
  const games = query.data.filter((g) => g.id !== gameId);
  if (games.length === 0) return null;
  return (
    <GameRail
      title={title}
      games={games}
      scrollKey={`game-${gameId}-${kind}`}
      shape={cardShapeOf(gate)}
    />
  );
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
  exclude: GameId;
  gate: GamesGate;
  active: boolean;
}) {
  const t = useT();
  const title = t("More from {name}", { name: developerName });
  return (
    <WhenNear
      minHeight={260}
      fallback={<GameRowSkeleton title={title} shape={cardShapeOf(gate)} />}
    >
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
  exclude: GameId;
  gate: GamesGate;
  active: boolean;
}) {
  const { openGameBrowse } = useView();
  const query = useDeveloperGames(gate, developerId, active);
  if (query.isError) return null;
  if (!query.data) return <GameRowSkeleton title={title} shape={cardShapeOf(gate)} />;
  const games = query.data.filter((g) => g.id !== exclude);
  if (games.length < 2) return null;
  return (
    <GameRail
      title={title}
      games={games}
      scrollKey={`dev-${developerId}`}
      shape={cardShapeOf(gate)}
      onViewAll={() =>
        openGameBrowse({
          title,
          filter: { developers: String(developerId), ordering: "-added" },
          // A developer id belongs to the provider that reported it.
          provider: gate.provider,
        })
      }
    />
  );
}
