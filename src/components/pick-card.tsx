import { Bookmark, Check, Popcorn, RefreshCcw } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { meta as fetchMeta, narrowMediaType, type Meta } from "@/lib/cinemeta";
import { useContextMenu } from "@/lib/context-menu";
import { useT } from "@/lib/i18n";
import {
  hoverPreviewBlur,
  hoverPreviewEnter,
  hoverPreviewFocus,
  hoverPreviewLeave,
} from "@/lib/hover-preview/store";
import { omdbPrefetch, useOmdbScores } from "@/lib/providers/omdb";
import { cinemetaRatingPrefetch, useCinemetaRating } from "@/lib/providers/cinemeta-rating";
import { harborImdbTitle } from "@/lib/providers/harbor-imdb";
import { mdblistCardPrefetch, useMdblistCardScores } from "@/lib/providers/mdblist-batch";
import { needsImdbForPoster, needsTmdbForPoster, rpdbPoster } from "@/lib/providers/rpdb";
import { tmdbIdFromImdb, tmdbImdbId, useTmdbIdFromImdb, useTmdbImdbId } from "@/lib/providers/tmdb";
import { useSettings } from "@/lib/settings";
import { useSimklCardScores } from "@/lib/simkl/ratings";
import { useView } from "@/lib/view";
import { observe } from "@/lib/visibility";
import { useInWatchlist } from "@/lib/watchlist";
import { useMetaWatched } from "@/lib/watched-flag";
import { useInLocalLibrary } from "@/lib/local-library";
import { LocalDot } from "@/components/local-badge";
import { ClapperMini } from "./icons/clapper-mini";
import { ImdbIcon } from "./icons/imdb-icon";
import { Poster, useLocalizedPoster } from "./poster";
import {
  CardHoverOverlay,
  cardHoverPosterClass,
  type CardHoverStyle,
} from "./pick-card/card-hover";
import { CustomHoverOverlay, customHoverPosterProps } from "./pick-card/custom-hover";
import { ExpandingCardArtwork, useExpandingCard } from "./pick-card/use-expanding-card";
import { getCustomHover } from "@/lib/custom-hover";
import { RtBadge } from "./rt-badge";
import mdblistLogo from "@/assets/addon-logos/mdblist.png";
import letterboxdLogo from "@/assets/addon-logos/letterboxd.png";
import traktLogo from "@/assets/trakt.svg";
import simklLogo from "@/assets/simkl.png";

const WATCHLIST_POS: Record<string, string> = {
  topStart: "top-1.5 start-1.5",
  topEnd: "top-1.5 end-1.5",
  bottomStart: "bottom-1.5 start-1.5",
  bottomEnd: "bottom-1.5 end-1.5",
};

export const PickCard = memo(function PickCard({
  meta,
  flagRerun = false,
  kids = false,
}: {
  meta: Meta;
  flagRerun?: boolean;
  kids?: boolean;
}) {
  const { openMeta, openPicker } = useView();
  const { open: openContextMenu } = useContextMenu();
  const { settings } = useSettings();
  const ref = useRef<HTMLButtonElement>(null);
  const expandingCard = useExpandingCard({
    cardRef: ref,
    meta,
    tmdbKey: settings.tmdbKey,
    focusEnabled: settings.posterFocusedCard,
  });
  const cardStyle: CardHoverStyle =
    kids || !settings.hoverPreviewEnabled ? "none" : settings.cardHoverStyle;
  const activeCustom = cardStyle === "custom" ? getCustomHover(settings.customHoverId) : null;
  const inCardHover: CardHoverStyle =
    cardStyle === "default" || cardStyle === "custom" ? "none" : cardStyle;
  const customProps = activeCustom ? customHoverPosterProps(activeCustom) : null;
  const badgeFade =
    inCardHover !== "none" || activeCustom
      ? "transition-opacity duration-150 group-hover:opacity-0 group-focus-within:opacity-0"
      : "";
  const t = useT();
  const inCinema = isInCinema(meta);
  const rerun = (inCinema || flagRerun) && isRerun(meta);
  const showCinema = inCinema && !rerun;
  const newBadge = !rerun && !inCinema ? deriveBadge(meta) : null;
  const resolvedImdb = useTmdbImdbId(meta.id);
  const imdbId = resolvedImdb ?? undefined;
  const cached = useOmdbScores(imdbId);
  const ratingTt = imdbId;
  const [harborRating, setHarborRating] = useState<string | undefined>();
  useEffect(() => {
    setHarborRating(undefined);
    if (!ratingTt || !ratingTt.startsWith("tt")) return;
    let cancelled = false;
    harborImdbTitle(ratingTt)
      .then((r) => {
        if (!cancelled && r != null) setHarborRating(r.toFixed(1));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [ratingTt]);
  const mediaKind = meta.type === "series" ? "show" : "movie";
  const wantMdblist =
    settings.showPopcornBadge ||
    settings.showMetacriticBadge ||
    settings.showLetterboxdBadge ||
    settings.showMdblistBadge ||
    settings.showTraktBadge;
  const cardScores = useMdblistCardScores(wantMdblist ? imdbId : undefined, mediaKind);
  const hasInlineImdb = meta.id.startsWith("tt") && !!meta.imdbRating;
  const wantCinemetaRating = settings.showImdbBadge && !hasInlineImdb;
  const cinemetaRating = useCinemetaRating(wantCinemetaRating ? imdbId : undefined);
  const cardImdbValue =
    harborRating ??
    cached?.imdbRating ??
    cinemetaRating ??
    (meta.id.startsWith("tt") ? meta.imdbRating : undefined);
  const cardRating = cardImdbValue
    ? settings.showImdbBadge
      ? cardImdbValue
      : undefined
    : settings.showTmdbBadge
      ? meta.imdbRating
      : undefined;
  const cardRatingSource = cardImdbValue ? "imdb" : "tmdb";
  const simklCardScore = useSimklCardScores(settings.showSimklBadge ? imdbId : undefined);
  const cardBadges: CardBadge[] = [];
  if (cardRating) cardBadges.push({ kind: "rating", source: cardRatingSource, value: cardRating });
  if (settings.showSimklBadge && simklCardScore.score != null)
    cardBadges.push({ kind: "simkl", value: simklCardScore.score });
  if (settings.showRtBadge && cached?.rtCritics != null)
    cardBadges.push({ kind: "rt", value: cached.rtCritics });
  if (settings.showPopcornBadge && cardScores?.rtAudience != null)
    cardBadges.push({ kind: "audience", value: cardScores.rtAudience });
  if (settings.showMetacriticBadge && cardScores?.metacritic != null)
    cardBadges.push({ kind: "metacritic", value: cardScores.metacritic });
  if (settings.showLetterboxdBadge && cardScores?.letterboxd != null)
    cardBadges.push({ kind: "letterboxd", value: cardScores.letterboxd });
  if (settings.showMdblistBadge && cardScores?.score != null)
    cardBadges.push({ kind: "mdblist", value: cardScores.score });
  if (settings.showTraktBadge && cardScores?.trakt != null)
    cardBadges.push({ kind: "trakt", value: cardScores.trakt });
  const altIds = useMemo(() => [imdbId], [imdbId]);
  const inWatchlist = useInWatchlist(meta.id, altIds);
  const watched = useMetaWatched(meta.id, meta.type);
  const inLocalLibrary = useInLocalLibrary(meta.id, altIds);

  const [posterFailed, setPosterFailed] = useState(false);
  const [hydratedPoster, setHydratedPoster] = useState<string | undefined>();
  const localizedPoster = useLocalizedPoster(meta.id);
  const wantTmdbPoster = needsTmdbForPoster(settings.rpdbKey, meta.id);
  const resolvedTmdb = useTmdbIdFromImdb(wantTmdbPoster ? meta.id : undefined);
  const posterNeedsImdb = needsImdbForPoster(settings.rpdbKey, meta.id);
  const posterAltId = posterNeedsImdb
    ? imdbId
    : wantTmdbPoster
      ? (resolvedTmdb ?? undefined)
      : undefined;
  const posterPending =
    !!settings.tmdbKey &&
    ((posterNeedsImdb && resolvedImdb === undefined) ||
      (wantTmdbPoster && resolvedTmdb === undefined));
  const posterCandidates = useMemo(() => {
    if (posterPending) return [];
    const base = localizedPoster ?? meta.poster;
    const seen = new Set<string>();
    const out: string[] = [];
    for (const u of [
      rpdbPoster(settings.rpdbKey, meta.id, base, posterAltId),
      localizedPoster,
      meta.poster,
      hydratedPoster,
    ]) {
      if (!u || seen.has(u)) continue;
      seen.add(u);
      out.push(u);
    }
    return out;
  }, [
    settings.rpdbKey,
    meta.id,
    posterAltId,
    meta.poster,
    hydratedPoster,
    localizedPoster,
    posterPending,
  ]);
  const posterSrc = posterCandidates[0];

  useEffect(() => {
    setPosterFailed(false);
  }, [posterCandidates]);

  useEffect(() => {
    setHydratedPoster(undefined);
  }, [meta.id]);

  useEffect(() => {
    if ((posterSrc !== undefined && !posterFailed) || hydratedPoster || posterPending) return;
    let cancelled = false;
    const hydrator = fetchMeta(narrowMediaType(meta.type), meta.id).then((full) =>
      full ? { poster: full.poster } : null,
    );
    hydrator
      .then((res) => {
        if (cancelled || !res?.poster) return;
        setHydratedPoster(res.poster);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [posterSrc, posterFailed, hydratedPoster, meta.type, meta.id, posterPending]);

  useEffect(() => {
    if (
      !settings.omdbKey &&
      !settings.mdblistKey &&
      !needsImdbForPoster(settings.rpdbKey, meta.id) &&
      !wantTmdbPoster &&
      !wantCinemetaRating
    )
      return;
    const el = ref.current;
    if (!el) return;
    let off: (() => void) | null = null;
    off = observe(el, async (visible) => {
      if (!visible) return;
      off?.();
      off = null;
      if (wantTmdbPoster) {
        void tmdbIdFromImdb(settings.tmdbKey, meta.id, meta.type === "series" ? "series" : "movie");
      }
      const id = await tmdbImdbId(settings.tmdbKey, meta.id);
      if (!id) return;
      if (settings.omdbKey) omdbPrefetch(settings.omdbKey, id);
      if (settings.mdblistKey && wantMdblist) {
        mdblistCardPrefetch(id, meta.type === "series" ? "show" : "movie");
      }
      if (wantCinemetaRating)
        cinemetaRatingPrefetch(id, meta.type === "series" ? "series" : "movie");
    });
    return () => off?.();
  }, [
    meta.id,
    meta.type,
    settings.tmdbKey,
    settings.omdbKey,
    settings.mdblistKey,
    wantMdblist,
    settings.rpdbKey,
    wantCinemetaRating,
  ]);

  return (
    <button
      ref={ref}
      onClick={() => openMeta(meta)}
      onContextMenu={(e) => openContextMenu(e, { kind: "meta", meta })}
      onFocus={(e) => {
        expandingCard.onFocus();
        if (!expandingCard.enabled) hoverPreviewFocus(meta, e.currentTarget);
      }}
      onBlur={(e) => {
        expandingCard.onBlur();
        hoverPreviewBlur(e.currentTarget);
      }}
      data-media-card
      data-expanding-card={expandingCard.enabled ? "" : undefined}
      data-row-card-expanded={expandingCard.expanded ? "true" : undefined}
      data-row-card-collapsing={expandingCard.collapsing ? "" : undefined}
      data-row-card-title-collapsing={expandingCard.titleCollapsing ? "" : undefined}
      data-focused-card={expandingCard.focusEnabled ? "" : undefined}
      data-no-card-ring={inCardHover !== "none" || activeCustom ? "" : undefined}
      className="group relative z-0 flex w-full min-w-0 flex-col gap-2.5 text-start"
    >
      <div
        data-preview-anchor
        onPointerEnter={(e) => hoverPreviewEnter(meta, e.currentTarget, e.buttons)}
        onPointerLeave={(e) => hoverPreviewLeave(e.currentTarget)}
        style={customProps?.style}
        className={`relative w-full transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0.24,1)] will-change-transform group-hover:[-webkit-transform:translate3d(0,-0.5rem,0)] group-hover:[transform:translate3d(0,-0.5rem,0)] ${
          expandingCard.enabled ? "expanding-card-poster-frame" : ""
        } ${
          expandingCard.focusEnabled
            ? "group-focus:[-webkit-transform:translate3d(0,-0.5rem,0)] group-focus:[transform:translate3d(0,-0.5rem,0)]"
            : ""
        }`}
      >
        <Poster
          src={posterSrc}
          fallbacks={posterCandidates.slice(1)}
          seed={meta.id}
          lowResImdb={imdbId}
          ratio="portrait"
          onError={() => setPosterFailed(true)}
          className={`harbor-card-ring rounded-[var(--poster-radius,12px)] shadow-[0_2px_8px_-2px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.06)] transition-[box-shadow] duration-300 group-hover:shadow-[0_24px_48px_-14px_rgba(0,0,0,0.65),inset_0_1px_0_rgba(255,255,255,0.08)] ${
            customProps ? customProps.className : cardHoverPosterClass(inCardHover)
          }`}
        >
          <ExpandingCardArtwork
            src={expandingCard.artwork}
            onReady={expandingCard.onArtworkReady}
            onError={expandingCard.onArtworkError}
          />
        </Poster>
        {activeCustom ? (
          <CustomHoverOverlay
            config={activeCustom}
            meta={meta}
            onPlay={() => {
              if (meta.type === "movie")
                openPicker(meta, undefined, { autoPlay: true, resume: true });
              else openMeta(meta);
            }}
          />
        ) : inCardHover !== "none" ? (
          <CardHoverOverlay
            meta={meta}
            style={inCardHover}
            onPlay={() => {
              if (meta.type === "movie")
                openPicker(meta, undefined, { autoPlay: true, resume: true });
              else openMeta(meta);
            }}
          />
        ) : null}
        <div className={badgeFade}>
          {settings.showCardBadges && (
            <>
              {rerun && <RerunBadge year={meta.releaseInfo} />}
              {showCinema && <CinemaBadge />}
              {newBadge && <Badge label={t(newBadge.label)} tone={newBadge.tone} kids={kids} />}
            </>
          )}
          {inWatchlist && settings.watchlistBadge !== "off" && (
            <span
              className={`pointer-events-none absolute flex h-6 w-6 items-center justify-center rounded-full bg-canvas/85 text-ink ring-1 ring-edge-soft/70 backdrop-blur-sm ${WATCHLIST_POS[settings.watchlistBadge]}`}
              title={t("In your watchlist")}
              aria-label={t("In watchlist")}
            >
              <Bookmark size={11} strokeWidth={2.6} fill="currentColor" />
            </span>
          )}
          {watched && (
            <span
              className="pointer-events-none absolute bottom-1.5 start-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/90 text-white ring-1 ring-emerald-300/40 backdrop-blur-sm"
              title={t("Watched")}
              aria-label={t("Watched")}
            >
              <Check size={12} strokeWidth={3} />
            </span>
          )}
          {settings.showLocalLibraryBadge && inLocalLibrary && (
            <LocalDot
              title={t("In your local library")}
              className={`bottom-1.5 ${settings.watchlistBadge === "bottomStart" ? "start-9" : "start-1.5"}`}
            />
          )}
          {kids ? (
            cardRating && <KidsStarBadge value={cardRating} placement={settings.badgePlacement} />
          ) : (
            <ScoreStack
              badges={cardBadges}
              limit={settings.cardBadgeLimit}
              placement={settings.badgePlacement}
            />
          )}
        </div>
      </div>
      {!settings.hidePosterTitles && (
        <p
          data-expanding-card-title
          className={
            kids
              ? "line-clamp-2 min-h-9 text-[15px] font-bold leading-snug text-[#0e3a43]"
              : "line-clamp-2 min-h-9 text-[13px] font-medium leading-snug text-ink"
          }
        >
          <span data-expanding-card-title-name>{meta.name}</span>
          {meta.releaseInfo && <span data-expanding-card-title-meta>{meta.releaseInfo}</span>}
        </p>
      )}
    </button>
  );
});

type CardBadge =
  | { kind: "rating"; source: "imdb" | "tmdb"; value: string }
  | { kind: "rt"; value: number }
  | { kind: "audience"; value: number }
  | { kind: "metacritic"; value: number }
  | { kind: "letterboxd"; value: number }
  | { kind: "mdblist"; value: number }
  | { kind: "trakt"; value: number }
  | { kind: "simkl"; value: number };

function metacriticTone(v: number): string {
  if (v >= 61) return "bg-emerald-500";
  if (v >= 40) return "bg-amber-500";
  return "bg-red-500";
}

function BadgeContent({ badge }: { badge: CardBadge }) {
  switch (badge.kind) {
    case "rating":
      return (
        <span className="flex items-center gap-1">
          {badge.source === "tmdb" ? (
            <span className="text-[8.5px] font-bold leading-none tracking-tight text-ink-muted">
              TMDB
            </span>
          ) : (
            <ImdbIcon className="h-[11px] w-auto rounded-[2px]" />
          )}
          <span>{badge.value}</span>
        </span>
      );
    case "rt":
      return (
        <span className="flex items-center gap-0.5">
          <RtBadge score={badge.value} className="h-[12px] w-auto" />
          <span>{badge.value}%</span>
        </span>
      );
    case "audience":
      return (
        <span className="flex items-center gap-0.5">
          <Popcorn
            size={12}
            strokeWidth={2.4}
            className={badge.value >= 60 ? "text-accent" : "text-ink-muted"}
          />
          <span>{Math.round(badge.value)}%</span>
        </span>
      );
    case "metacritic":
      return (
        <span
          className={`flex h-[13px] min-w-[15px] items-center justify-center rounded-[3px] px-0.5 text-[8.5px] font-bold text-white ${metacriticTone(badge.value)}`}
        >
          {Math.round(badge.value)}
        </span>
      );
    case "letterboxd":
      return (
        <span className="flex items-center gap-0.5">
          <img
            src={letterboxdLogo}
            alt=""
            className="h-[11px] w-[11px] rounded-[2px] object-cover"
          />
          <span>{(badge.value / 2).toFixed(1)}</span>
        </span>
      );
    case "mdblist":
      return (
        <span className="flex items-center gap-0.5">
          <img
            src={mdblistLogo}
            alt=""
            className="h-[11px] w-[11px] rounded-[2px] object-contain"
          />
          <span>{Math.round(badge.value)}</span>
        </span>
      );
    case "trakt":
      return (
        <span className="flex items-center gap-0.5">
          <img src={traktLogo} alt="" className="h-[11px] w-[11px] object-contain" />
          <span>{Math.round(badge.value)}%</span>
        </span>
      );
    case "simkl":
      return (
        <span className="flex items-center gap-0.5">
          <img src={simklLogo} alt="" className="h-[11px] w-[11px] rounded-[2px] object-contain" />
          <span>{Math.round(badge.value)}</span>
        </span>
      );
  }
}

function ScoreStack({
  badges,
  limit = 3,
  placement = "bottom",
}: {
  badges: CardBadge[];
  limit?: number;
  placement?: "top" | "bottom";
}) {
  const shown = badges.slice(0, Math.max(1, limit));
  if (shown.length === 0) return null;
  const scale = shown.length <= 3 ? 1 : shown.length === 4 ? 0.88 : shown.length === 5 ? 0.78 : 0.7;
  return (
    <div
      style={scale < 1 ? { transform: `scale(${scale})`, transformOrigin: "right" } : undefined}
      className={`absolute end-1.5 flex items-center gap-1 whitespace-nowrap rounded-md bg-canvas/95 px-1.5 py-0.5 text-[10px] font-semibold text-ink ${
        placement === "top" ? "top-1.5" : "bottom-1.5"
      }`}
    >
      {shown.map((b, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <span className="opacity-30">·</span>}
          <BadgeContent badge={b} />
        </span>
      ))}
    </div>
  );
}

type BadgeTone = "default" | "accent";

function Badge({
  label,
  tone = "default",
  kids = false,
  dubShift = false,
}: {
  label: string;
  tone?: BadgeTone;
  kids?: boolean;
  dubShift?: boolean;
}) {
  const styles = kids
    ? "bg-black text-white"
    : tone === "accent"
      ? "bg-accent/90 text-canvas"
      : "border border-edge-soft bg-canvas/95 text-ink";
  return (
    <span
      className={`absolute start-2 ${dubShift ? "top-[28px]" : "top-2"} rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${styles}`}
    >
      {label}
    </span>
  );
}

function KidsStarBadge({
  value,
  placement = "bottom",
}: {
  value: string;
  placement?: "top" | "bottom";
}) {
  return (
    <span
      className={`pointer-events-none absolute end-1 grid h-9 w-9 place-items-center ${
        placement === "top" ? "top-1" : "bottom-1"
      }`}
    >
      <img
        src="/kids/starbadge.svg"
        alt=""
        draggable={false}
        className="absolute inset-0 h-full w-full object-contain drop-shadow-[0_2px_6px_rgba(0,0,0,0.3)]"
      />
      <span className="relative translate-y-[1px] text-[9px] font-extrabold leading-none text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.6)]">
        {value}
      </span>
    </span>
  );
}

function deriveBadge(meta: Meta): { label: string; tone?: BadgeTone } | null {
  const year = new Date().getFullYear();
  if (meta.releaseInfo === String(year)) return { label: "New" };
  return null;
}

function isInCinema(meta: Meta): boolean {
  return meta.type === "movie" && meta.inTheaters === true;
}

function isRerun(meta: Meta): boolean {
  if (meta.type !== "movie") return false;
  if (!meta.releaseDate) return false;
  const released = Date.parse(meta.releaseDate);
  if (Number.isNaN(released)) return false;
  const monthsOld = (Date.now() - released) / (1000 * 60 * 60 * 24 * 30.44);
  return monthsOld > 9;
}

function CinemaBadge({ dubShift = false }: { dubShift?: boolean }) {
  const t = useT();
  return (
    <span
      className={`harbor-cinema-badge absolute start-2 ${dubShift ? "top-[28px]" : "top-2"} flex items-center gap-1 rounded-md bg-canvas/95 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.14em]`}
    >
      <ClapperMini size={10} />
      <span>{t("In Cinema")}</span>
    </span>
  );
}

function RerunBadge({ year, dubShift = false }: { year?: string; dubShift?: boolean }) {
  const t = useT();
  return (
    <span
      className={`absolute start-2 ${dubShift ? "top-[28px]" : "top-2"} flex items-center gap-1 rounded-md border border-edge-soft bg-canvas/95 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.14em] text-ink-muted`}
    >
      <RefreshCcw size={9} strokeWidth={2.4} />
      <span>
        {t("Rerun")}
        {year ? ` · ${year}` : ""}
      </span>
    </span>
  );
}
