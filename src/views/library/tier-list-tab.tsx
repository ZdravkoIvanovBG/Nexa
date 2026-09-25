import { Trophy } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import {
  ALL_TIERS,
  moveToTier,
  useTierBoard,
  type MediaKind,
  type Tier,
  type WatchedEntry,
} from "@/lib/library-tracking";
import { useT } from "@/lib/i18n";
import { FilterPill } from "./shared";
import { TierRow } from "./tier-row";

const TIER_LABEL: Record<Tier, string> = {
  S: "S",
  A: "A",
  B: "B",
  C: "C",
  D: "D",
  F: "F",
  unranked: "Unranked",
};

// Below this many pixels of pointer travel, a press is treated as a click
// (opening the detail page) rather than the start of a drag.
const DRAG_THRESHOLD = 6;

const ROW_HOVER_SHADOW = "inset 0 0 0 2px var(--color-accent)";
const TILE_HOVER_SHADOW = "0 0 0 2px var(--color-canvas), 0 0 0 4px var(--color-accent)";

const KIND_KEY = "harbor.library.tiers.kind";

function readSavedKind(): MediaKind {
  try {
    return localStorage.getItem(KIND_KEY) === "movie" ? "movie" : "series";
  } catch {
    return "series";
  }
}

export function TierListTab() {
  const t = useT();
  const [kind, setKind] = useState<MediaKind>(readSavedKind);
  const { board, counts } = useTierBoard(kind);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const ghostImgRef = useRef<HTMLImageElement | null>(null);
  const tileRefs = useRef(new Map<string, HTMLDivElement>());
  // Teardown for a drag still in flight, so switching kind or leaving the tab
  // can end it without committing a move against the list that is going away.
  const endDragRef = useRef<((commit: boolean) => void) | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(KIND_KEY, kind);
    } catch {}
    endDragRef.current?.(false);
  }, [kind]);

  useEffect(() => () => endDragRef.current?.(false), []);

  const registerTile = (id: string, el: HTMLDivElement | null) => {
    if (el) tileRefs.current.set(id, el);
    else tileRefs.current.delete(id);
  };

  // Pure-imperative drag: HTML5 native drag-and-drop is handled by the OS on
  // Windows (Tauri's native drop target), which can block or fight the
  // webview's own DnD engine, so this drives off raw pointer events instead.
  // Every live-drag visual (ghost position, source dimming, drop-target
  // highlight) is written straight to DOM nodes via refs on each
  // pointermove -- no setState calls, so no re-renders -- and the board only
  // updates once, via moveToTier(), when the pointer is released.
  const startDrag = (e: ReactPointerEvent, entry: WatchedEntry) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const sourceEl = tileRefs.current.get(entry.id);
    const ghostEl = ghostRef.current;
    const ghostImg = ghostImgRef.current;
    if (!sourceEl || !ghostEl || !ghostImg) return;

    const startX = e.clientX;
    const startY = e.clientY;
    let active = false;
    let hoverEl: HTMLElement | null = null;
    let hoverTarget: { tier: Tier; index: number } | null = null;

    const onMove = (ev: PointerEvent) => {
      if (!active) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
        active = true;
        sourceEl.style.opacity = "0.4";
        sourceEl.style.cursor = "grabbing";
        if (entry.poster) {
          ghostImg.src = entry.poster;
          ghostImg.style.visibility = "visible";
        } else {
          ghostImg.removeAttribute("src");
          ghostImg.style.visibility = "hidden";
        }
        ghostEl.style.display = "block";
      }
      ev.preventDefault();
      ghostEl.style.transform = `translate3d(${ev.clientX}px, ${ev.clientY}px, 0) translate(-50%, -50%) rotate(3deg)`;

      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const tileEl = el?.closest("[data-tier-tile]") as HTMLElement | null;
      const rowEl = el?.closest("[data-tier-drop]") as HTMLElement | null;
      let nextEl: HTMLElement | null = null;
      let nextTarget: { tier: Tier; index: number } | null = null;
      if (tileEl && tileEl.dataset.tierTile !== entry.id) {
        nextEl = tileEl;
        nextTarget = {
          tier: tileEl.dataset.tierRow as Tier,
          index: Number(tileEl.dataset.tierIndex),
        };
      } else if (rowEl) {
        nextEl = rowEl;
        nextTarget = {
          tier: rowEl.dataset.tierDrop as Tier,
          index: Number(rowEl.dataset.tierCount),
        };
      }
      if (nextEl !== hoverEl) {
        if (hoverEl) hoverEl.style.boxShadow = "";
        if (nextEl)
          nextEl.style.boxShadow = nextEl === tileEl ? TILE_HOVER_SHADOW : ROW_HOVER_SHADOW;
        hoverEl = nextEl;
      }
      hoverTarget = nextTarget;
    };

    // Called with commit=false on unmount and on a kind switch. The drop
    // highlight lives on a DOM node React reuses across both (rows are keyed
    // by tier and never own boxShadow), so nothing else would clear it.
    const endDrag = (commit: boolean) => {
      endDragRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      sourceEl.style.opacity = "";
      sourceEl.style.cursor = "";
      ghostEl.style.display = "none";
      if (hoverEl) hoverEl.style.boxShadow = "";
      if (commit && active && hoverTarget) {
        moveToTier(entry.id, hoverTarget.tier, hoverTarget.index);
      }
    };
    const onUp = () => endDrag(true);

    endDragRef.current = endDrag;
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  if (counts.movie === 0 && counts.series === 0) return <EmptyTiers />;

  const total = counts[kind];

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-[12px] tabular-nums text-ink-muted">
            {t("{n} watched", { n: total })}
          </span>
          <div
            role="group"
            aria-label={t("Tier list type")}
            className="flex items-center gap-1 rounded-full bg-elevated/40 p-0.5 ring-1 ring-edge-soft/60"
          >
            <FilterPill
              active={kind === "series"}
              pressed={kind === "series"}
              onClick={() => setKind("series")}
            >
              {t("Shows")}
            </FilterPill>
            <FilterPill
              active={kind === "movie"}
              pressed={kind === "movie"}
              onClick={() => setKind("movie")}
            >
              {t("Movies")}
            </FilterPill>
          </div>
        </div>
        {total > 0 && (
          <span className="text-[12px] text-ink-subtle">
            {t("Drag a poster into a tier to rank it.")}
          </span>
        )}
      </div>
      {total === 0 ? (
        <EmptyTiers kind={kind} />
      ) : (
        <div className="flex flex-col gap-2">
          {ALL_TIERS.map((tier) => (
            <TierRow
              key={tier}
              tier={tier}
              label={t(TIER_LABEL[tier])}
              entries={board[tier]}
              registerTile={registerTile}
              onTilePointerDown={startDrag}
            />
          ))}
        </div>
      )}
      {createPortal(
        <div
          ref={ghostRef}
          className="pointer-events-none fixed left-0 top-0 z-[400] w-[64px] opacity-90"
          style={{ display: "none", willChange: "transform" }}
        >
          <div className="overflow-hidden rounded-[var(--poster-radius,12px)] bg-elevated shadow-[0_12px_30px_-8px_rgba(0,0,0,0.6)]">
            <img ref={ghostImgRef} alt="" className="aspect-[2/3] w-full object-cover" />
          </div>
        </div>,
        document.body,
      )}
    </section>
  );
}

/** Without `kind`, the first-run state for a library with nothing watched at all. */
function EmptyTiers({ kind }: { kind?: MediaKind }) {
  const t = useT();
  const title =
    kind === "movie"
      ? "No watched movies yet"
      : kind === "series"
        ? "No watched shows yet"
        : "Nothing watched yet";
  const body =
    kind === "movie"
      ? "Movies you finish will appear here."
      : kind === "series"
        ? "Shows you finish will appear here."
        : "Mark a movie or show as watched from its detail page, then rank it here from S down to F.";
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-edge-soft bg-canvas/30 px-8 py-20 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-elevated/60 text-ink-subtle ring-1 ring-edge-soft/60">
        <Trophy size={24} strokeWidth={1.6} />
      </span>
      <div className="flex flex-col gap-1.5">
        <h2 className="font-display text-[20px] font-medium text-ink">{t(title)}</h2>
        <p className="max-w-sm text-[13px] leading-relaxed text-ink-muted">{t(body)}</p>
      </div>
    </div>
  );
}
