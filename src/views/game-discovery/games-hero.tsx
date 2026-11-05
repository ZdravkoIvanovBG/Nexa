import { ChevronRight, Info, Star } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useGameDetail } from "@/lib/game-discovery/queries";
import { gameImage } from "@/lib/game-discovery/game-image";
import type { GameSummary } from "@/lib/game-discovery/types";
import type { GamesGate } from "@/lib/game-discovery/use-games-gate";
import { useT } from "@/lib/i18n";
import { useView } from "@/lib/view";
import { observe, usePageVisible } from "@/lib/visibility";
import { MetacriticBadge } from "./game-card";
import { criticScoreOf, heroImageOf, releaseYear, userScoreOf } from "./format";

// Adapted from CinemaHero: same rotation, drag and gradients. No trailer, logo
// or Play button -- neither provider has logo art and launching games isn't
// Phase 1. Slides need landscape art: the caller never passes portrait covers.

const ROTATE_MS = 11000;
const DESCRIPTION_DWELL_MS = 1200;
const EASE_OUT = "cubic-bezier(0.32, 0.72, 0.24, 1)";
const DRAG_BUDGE = 6;
const SNAP_RATIO = 0.18;
const FLICK_VELOCITY = 0.45;

function rubberBand(distance: number, dim: number, c = 0.55): number {
  return (1 - 1 / (distance / dim / c + 1)) * dim * c;
}

export function GamesHero({
  slides,
  gate,
  kicker,
}: {
  slides: GameSummary[];
  gate: GamesGate;
  /** The row the slides come from, e.g. "Popular this year". */
  kicker: string;
}) {
  const t = useT();
  const [activeIndex, setActive] = useState(0);
  const active = activeIndex < slides.length ? activeIndex : 0;
  const [paused, setPaused] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [offset, setOffset] = useState(0);
  const [inViewport, setInViewport] = useState(true);
  const pageVisible = usePageVisible();
  const ref = useRef<HTMLElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const startX = useRef(0);
  const lastX = useRef(0);
  const lastT = useRef(0);
  const velocity = useRef(0);
  const moved = useRef(false);
  const widthRef = useRef(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return observe(el, setInViewport);
  }, []);

  useEffect(() => {
    if (paused || dragging || !inViewport || !pageVisible || slides.length < 2) return;
    const id = setInterval(() => setActive((a) => (a + 1) % slides.length), ROTATE_MS);
    return () => clearInterval(id);
  }, [paused, dragging, inViewport, pageVisible, slides.length]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || slides.length < 2) return;
    widthRef.current = viewportRef.current?.clientWidth ?? 1000;
    setDragging(true);
    moved.current = false;
    startX.current = e.clientX;
    lastX.current = e.clientX;
    lastT.current = performance.now();
    velocity.current = 0;
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const dx = e.clientX - startX.current;
    if (Math.abs(dx) > DRAG_BUDGE) {
      if (!moved.current) {
        try {
          viewportRef.current?.setPointerCapture(e.pointerId);
        } catch {}
      }
      moved.current = true;
    }
    const now = performance.now();
    const dt = now - lastT.current;
    if (dt > 0) {
      const inst = (e.clientX - lastX.current) / dt;
      velocity.current = velocity.current * 0.6 + inst * 0.4;
    }
    lastX.current = e.clientX;
    lastT.current = now;
    const W = widthRef.current || 1000;
    let next = dx;
    if (active === 0 && dx > 0) next = rubberBand(dx, W);
    else if (active === slides.length - 1 && dx < 0) next = -rubberBand(-dx, W);
    setOffset(next);
  };
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    try {
      if (viewportRef.current?.hasPointerCapture?.(e.pointerId)) {
        viewportRef.current.releasePointerCapture(e.pointerId);
      }
    } catch {}
    setDragging(false);
    const W = widthRef.current || 1000;
    const threshold = W * SNAP_RATIO;
    const v = velocity.current;
    const wantNext = (offset < -threshold || v < -FLICK_VELOCITY) && active < slides.length - 1;
    const wantPrev = (offset > threshold || v > FLICK_VELOCITY) && active > 0;
    if (wantNext) setActive(active + 1);
    else if (wantPrev) setActive(active - 1);
    setOffset(0);
  };
  const onClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    if (moved.current) {
      e.stopPropagation();
      e.preventDefault();
    }
  };

  const trackTransform = `translate3d(calc(${-active * 100}% + ${offset}px), 0, 0)`;

  return (
    <section
      ref={ref}
      className="harbor-bleed-stremio relative h-[78vh] min-h-[640px] overflow-hidden bg-canvas"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div
        ref={viewportRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={onClickCapture}
        className={`relative h-full w-full overflow-hidden select-none ${
          slides.length > 1 ? (dragging ? "cursor-grabbing" : "cursor-grab") : ""
        }`}
        style={{ touchAction: "pan-y" }}
      >
        <div
          className="flex h-full w-full"
          style={{
            transform: trackTransform,
            transition: dragging ? "none" : `transform 700ms ${EASE_OUT}`,
            willChange: "transform",
          }}
        >
          {slides.map((game, i) => {
            const shouldMount = Math.abs(i - active) <= 1 || dragging;
            return (
              <div key={game.id} className="relative h-full w-full shrink-0">
                {shouldMount ? (
                  <GameSlide
                    game={game}
                    active={i === active && !dragging && inViewport && pageVisible}
                    gate={gate}
                    kicker={kicker}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      {slides.length > 1 && (
        <div className="absolute bottom-7 left-1/2 z-10 flex -translate-x-1/2 gap-2.5">
          {slides.map((_, i) => (
            <button
              key={i}
              onClick={() => setActive(i)}
              aria-label={t("Slide {n}", { n: i + 1 })}
              className={`h-1.5 rounded-full transition-all duration-500 ${
                i === active ? "w-10 bg-ink" : "w-1.5 bg-ink-muted/55 hover:bg-ink-muted"
              }`}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function GameSlide({
  game,
  active,
  gate,
  kicker,
}: {
  game: GameSummary;
  active: boolean;
  gate: GamesGate;
  kicker: string;
}) {
  const t = useT();
  const { openGame } = useView();
  // Only a slide the user actually dwells on costs a detail request; the
  // result is shared with the Game detail page.
  const [dwelled, setDwelled] = useState(false);
  useEffect(() => {
    if (!active || dwelled) return;
    const id = window.setTimeout(() => setDwelled(true), DESCRIPTION_DWELL_MS);
    return () => window.clearTimeout(id);
  }, [active, dwelled]);
  const detail = useGameDetail(gate, game.id, dwelled);
  const description = detail.data?.description ?? null;
  const year = releaseYear(game);
  const genres = game.genres.slice(0, 2).map((g) => g.name);
  const critic = criticScoreOf(game);
  const user = userScoreOf(game);
  // RAWG keeps its original URL here; IGDB hero art is already full size.
  const [image] = gameImage(heroImageOf(game), null);

  return (
    <div aria-hidden={!active} className="relative h-full w-full">
      {image && (
        <img
          src={image}
          alt=""
          decoding="async"
          fetchPriority={active ? "high" : "low"}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-canvas via-canvas/70 via-30% to-transparent" />
      <div className="absolute inset-y-0 start-0 w-3/5 bg-gradient-to-r from-canvas/95 via-canvas/55 to-transparent rtl:bg-gradient-to-l" />

      <div className="relative flex h-full items-end pb-28 ps-20 pe-20">
        <div className="flex max-w-[640px] flex-col gap-5">
          <span className="text-[11px] font-bold uppercase tracking-[0.42em] text-ink-subtle">
            {t(kicker)}
          </span>
          <h2
            className="font-display text-[clamp(44px,5.4vw,72px)] font-medium leading-[0.95] tracking-tight text-ink [text-wrap:balance]"
            style={{ animation: "harbor-fade-in 420ms cubic-bezier(0.32, 0.72, 0.24, 1) both" }}
          >
            {game.name}
          </h2>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[13px] tracking-wide text-ink-muted">
            {year && <span className="tabular-nums">{year}</span>}
            {genres.length > 0 && year && <Dot />}
            {genres.length > 0 && <span>{genres.join(" · ")}</span>}
            {critic && <Dot />}
            {critic && (
              <span className="flex items-center gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
                  {t(critic.label)}
                </span>
                <MetacriticBadge
                  score={critic.score}
                  title={critic.label === "Metacritic" ? t("Metacritic score") : t("Critic score")}
                />
              </span>
            )}
            {user && <Dot />}
            {user && (
              <span className="flex items-center gap-1.5" title={t("IGDB user score")}>
                <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
                  {t("User score")}
                </span>
                <Star size={12} className="fill-current text-accent" />
                <span className="font-semibold tabular-nums text-ink">{user.score}</span>
              </span>
            )}
            {game.rating !== null && <Dot />}
            {game.rating !== null && (
              <span className="flex items-center gap-1.5" title={t("RAWG community rating")}>
                <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
                  RAWG
                </span>
                <Star size={12} className="fill-current text-accent" />
                <span className="font-semibold tabular-nums text-ink">
                  {game.rating.toFixed(1)}
                </span>
              </span>
            )}
          </div>
          <p
            className={`line-clamp-2 min-h-[3.25em] max-w-[560px] text-[15.5px] leading-relaxed text-ink-muted transition-opacity duration-500 ${
              description ? "opacity-100" : "opacity-0"
            }`}
          >
            {description ?? ""}
          </p>
          <div className="mt-1 flex items-center gap-3">
            <button
              onClick={() => openGame(game)}
              className="flex h-12 items-center gap-2.5 rounded-md border border-edge bg-canvas/50 px-6 text-[14.5px] font-medium text-ink backdrop-blur-sm transition-colors duration-200 hover:bg-canvas/70"
            >
              <Info size={16} strokeWidth={2} />
              {t("More info")}
              <ChevronRight size={15} strokeWidth={2} className="dir-icon opacity-65" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Dot() {
  return <span className="h-1 w-1 rounded-full bg-ink-subtle/60" />;
}
