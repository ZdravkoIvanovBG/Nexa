import { Hourglass, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Poster } from "@/components/poster";
import { coverImage, gameImage, gameImageKind } from "@/lib/game-discovery/game-image";
import type { BoardTile } from "@/lib/game-library/rules";
import { type Tier } from "@/lib/tracking-tiers";
import { useT } from "@/lib/i18n";
import { dropTile, focusTile, stepTile, tierName } from "./tier-actions";

/**
 * The movie Tier List's colours (src/views/library/tier-row.tsx), repeated
 * rather than imported: that module brings the movie tiles and stores with it.
 * A test keeps the two the same.
 */
export const TIER_STYLE: Record<Tier, string> = {
  S: "bg-rose-500 text-white",
  A: "bg-amber-500 text-white",
  B: "bg-yellow-400 text-neutral-900",
  C: "bg-emerald-500 text-white",
  D: "bg-sky-500 text-white",
  F: "bg-purple-500 text-white",
  unranked: "bg-elevated text-ink-muted",
};

export const BOARD_HINT_ID = "game-tier-hint";

export function GameTierRow({
  tier,
  tiles,
  children,
}: {
  tier: Tier;
  tiles: BoardTile[];
  children: React.ReactNode;
}) {
  const t = useT();
  const label = tierName(t, tier);
  return (
    <div className="flex overflow-hidden rounded-xl border border-edge-soft">
      <div
        className={`flex w-[76px] shrink-0 items-center justify-center px-2 text-center font-display font-medium ${
          tier === "unranked" ? "text-[12px] leading-tight" : "text-[26px]"
        } ${TIER_STYLE[tier]}`}
      >
        {label}
      </div>
      <ul
        data-board-drop={tier}
        aria-label={tier === "unranked" ? t("Unranked") : t("{tier} tier", { tier })}
        // The drop ring is written to this node by use-board-drag, not by props.
        style={{ transition: "box-shadow 120ms ease" }}
        className="flex min-h-[104px] flex-1 flex-wrap content-start gap-2 bg-canvas/30 p-2"
      >
        {children}
        {tiles.length === 0 && (
          <li
            aria-hidden
            className="pointer-events-none flex min-h-[88px] items-center px-2 text-[12px] text-ink-subtle/70"
          >
            {tier === "unranked"
              ? t("Completed games wait here to be ranked")
              : t("Drop games here")}
          </li>
        )}
      </ul>
    </div>
  );
}

export function GameTierTile({
  tile,
  tier,
  index,
  count,
  lifted,
  highlighted,
  onLift,
  onPointerDown,
  onClick,
  onRemove,
}: {
  tile: BoardTile;
  tier: Tier;
  index: number;
  count: number;
  lifted: boolean;
  highlighted: boolean;
  onLift: (lifted: boolean) => void;
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  onClick: () => void;
  /** Takes the game off the board only; its status, notes and progress stay. */
  onRemove: (fromKeyboard: boolean) => void;
}) {
  const t = useT();
  const { record, notCompleted } = tile;
  const { gameId, name } = record;
  // The movie Tier List's remove control (src/views/library/tier-tile.tsx):
  // an X on hover, a red Remove to confirm, and leaving it cancels.
  const [confirmRemove, setConfirmRemove] = useState(false);

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!lifted) {
      if (e.key !== " ") return; // Enter opens the game, like any button
      e.preventDefault();
      e.stopPropagation();
      onLift(true);
      return;
    }
    const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
    let moved = false;
    switch (e.key) {
      case "ArrowLeft":
        moved = stepTile(gameId, rtl ? "right" : "left", t);
        break;
      case "ArrowRight":
        moved = stepTile(gameId, rtl ? "left" : "right", t);
        break;
      case "ArrowUp":
        moved = stepTile(gameId, "up", t);
        break;
      case "ArrowDown":
        moved = stepTile(gameId, "down", t);
        break;
      case "Home":
        moved = index > 0 && dropTile(gameId, tier, 0, t);
        break;
      case "End":
        moved = index < count - 1 && dropTile(gameId, tier, Number.MAX_SAFE_INTEGER, t);
        break;
      case "Enter":
      case " ":
      case "Escape":
        onLift(false);
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (moved) focusTile(gameId);
  };

  return (
    <li
      data-board-tile={gameId}
      // Tiles have no menu of their own; the browser's has nothing for them.
      onContextMenu={(e) => e.preventDefault()}
      className="group/tile relative w-[64px] select-none"
    >
      <button
        type="button"
        data-tile-handle={gameId}
        data-tv-local-keys={lifted ? "true" : undefined}
        aria-label={t(
          notCompleted
            ? "{name}, not completed, {tier}, position {n} of {total}"
            : "{name}, {tier}, position {n} of {total}",
          { name, tier: tierName(t, tier), n: index + 1, total: count },
        )}
        aria-describedby={BOARD_HINT_ID}
        aria-pressed={lifted}
        onPointerDown={onPointerDown}
        onDragStart={(e) => e.preventDefault()}
        onClick={onClick}
        onKeyDown={onKeyDown}
        onKeyUp={(e) => {
          // Space would click the button on release; it lifts and drops instead.
          if (e.key === " ") e.preventDefault();
        }}
        onBlur={() => {
          if (!lifted) return;
          // A move re-renders the tile and focus comes straight back to it, so
          // only a real departure puts the game down.
          const id = gameId;
          window.setTimeout(() => {
            const active = document.activeElement;
            if (!(active instanceof HTMLElement) || active.dataset.tileHandle !== id) onLift(false);
          }, 80);
        }}
        className={`block w-full cursor-grab touch-none rounded-[var(--poster-radius,12px)] text-start outline-none transition-shadow active:cursor-grabbing ${
          lifted ? "ring-2 ring-accent" : highlighted ? "ring-2 ring-accent/70" : ""
        }`}
      >
        <TileArt image={record.image} seed={gameId} />
        <span className="mt-1 block truncate text-center text-[10.5px] leading-tight text-ink-muted">
          {name}
        </span>
      </button>
      {notCompleted && (
        <span
          title={t("Not completed")}
          className="absolute start-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-canvas/85 text-ink-muted ring-1 ring-white/15"
        >
          <Hourglass size={9} strokeWidth={2.6} aria-hidden />
        </span>
      )}
      <button
        type="button"
        data-tile-remove={gameId}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseLeave={() => setConfirmRemove(false)}
        // Only a real move of focus (Tab away) cancels. With TV navigation on,
        // every pointerdown is followed by a programmatic blur() a frame later
        // (keyboard-navigation.ts), between the press and its click; cancelling
        // on that would undo the confirmation before Remove could be clicked.
        onBlur={(e) => {
          if (e.relatedTarget instanceof Node && !e.currentTarget.contains(e.relatedTarget))
            setConfirmRemove(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && confirmRemove) {
            e.preventDefault();
            e.stopPropagation();
            setConfirmRemove(false);
          }
        }}
        onClick={(e) => {
          e.stopPropagation();
          if (confirmRemove) {
            setConfirmRemove(false);
            // A keyboard press reports no clicks; focus then moves on to a neighbour.
            onRemove(e.detail === 0);
          } else {
            setConfirmRemove(true);
          }
        }}
        title={confirmRemove ? undefined : t("Remove from Tier List")}
        aria-label={
          confirmRemove
            ? t("Confirm remove {name} from Tier List", { name })
            : t("Remove {name} from Tier List", { name })
        }
        className={`absolute end-1 top-1 flex h-6 items-center justify-center gap-1 rounded-full text-white shadow-[0_2px_8px_rgba(0,0,0,0.4)] transition-all duration-200 ${
          confirmRemove
            ? "bg-danger px-2 text-[10px] font-semibold"
            : "w-6 bg-canvas/70 opacity-0 backdrop-blur-sm hover:bg-canvas/90 focus-visible:opacity-100 group-hover/tile:opacity-100 [@media(hover:none)]:opacity-100"
        }`}
      >
        <X size={12} strokeWidth={2.4} />
        {confirmRemove && t("Remove")}
      </button>
    </li>
  );
}

const FRAME =
  "relative aspect-[2/3] w-full overflow-hidden rounded-[var(--poster-radius,12px)] bg-elevated shadow-[0_2px_8px_-2px_rgba(0,0,0,0.4)]";

/**
 * A tile's art in the movie board's 2:3 poster frame. IGDB covers (3:4) fill
 * it the way posters do, losing a sliver at each side rather than being
 * squeezed. Landscape art (RAWG, IGDB artwork) is shown whole on a plain
 * panel, never cropped, stretched or set on a blurred copy.
 * Without art, or when it fails to load, the usual seeded plate stands in; the
 * caption under the tile names the game.
 */
function TileArt({
  image,
  seed,
  children,
}: {
  image: string | null;
  seed: string;
  children?: ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  const kind = gameImageKind(image);
  if (image && kind === "landscape" && !failed) {
    return (
      <div className={`${FRAME} pointer-events-none flex items-center`}>
        <img
          src={gameImage(image, 420)[0] ?? image}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
          className="h-auto w-full object-contain"
        />
        {children}
      </div>
    );
  }
  const [src, ...fallbacks] = kind === "cover" ? coverImage(image) : [];
  return (
    <div className={`${FRAME} pointer-events-none`}>
      <Poster
        src={src}
        fallbacks={fallbacks}
        seed={seed}
        ratio="portrait"
        lazy
        className="rounded-[var(--poster-radius,12px)]"
      />
      {children}
    </div>
  );
}
