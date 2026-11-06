import { ChevronDown, ChevronUp, Ellipsis, GripVertical } from "lucide-react";
import { useState } from "react";
import type { GameRecord, GameStatus } from "@/lib/game-library/types";
import { useT } from "@/lib/i18n";
import { announceMove } from "./entry-menus";
import { announce, moveTo, shift, toTop } from "./wishlist-actions";

export const HANDLE_HINT_ID = "game-wishlist-handle-hint";

export function yearOf(record: Pick<GameRecord, "released">): string | null {
  return record.released ? record.released.slice(0, 4) : null;
}

/**
 * The drag handle, which is also the keyboard way to reorder: arrow keys move
 * one place, Home and End to the ends. Focus stays on it after each move.
 *
 * With TV navigation on (the default), the app's arrow keys move focus, so the
 * handle doesn't take them at rest: pressing Down on a handle goes to the next
 * row, as everywhere else. Enter or Space lifts it instead. While lifted it
 * sets data-tv-local-keys, so TV navigation leaves every key to it: the arrows
 * move the game, and Enter, Space or Escape puts it down (Escape doesn't go
 * Back). Leaving the handle puts it down too. With TV navigation off the
 * arrows reach the handle directly, as before, lifted or not.
 */
export function SortHandle({
  entryId,
  name,
  index,
  count,
  onPointerDown,
  disabled,
}: {
  entryId: string;
  name: string;
  index: number;
  count: number;
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const [lifted, setLifted] = useState(false);
  const lift = (next: boolean) => {
    setLifted(next);
    announce(next ? t("Picked up {name}", { name }) : t("Put down {name}", { name }));
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      lift(!lifted);
      return;
    }
    if (e.key === "Escape" && lifted) {
      e.preventDefault();
      e.stopPropagation();
      lift(false);
      return;
    }
    let to = -1;
    if (e.key === "ArrowUp" && index > 0) to = shift(entryId, -1) ? index - 1 : -1;
    else if (e.key === "ArrowDown" && index < count - 1) to = shift(entryId, 1) ? index + 1 : -1;
    else if (e.key === "Home" && index > 0) to = toTop(entryId) ? 0 : -1;
    else if (e.key === "End" && index < count - 1) to = moveTo(entryId, count - 1) ? count - 1 : -1;
    else if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    if (to >= 0) announceMove(t, entryId, name, to, count, true);
  };
  return (
    <button
      type="button"
      data-sort-handle={entryId}
      data-tv-local-keys={lifted ? "true" : undefined}
      aria-label={t("Reorder {name}", { name })}
      aria-describedby={HANDLE_HINT_ID}
      aria-pressed={lifted}
      disabled={disabled || count < 2}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onBlur={(e) => {
        if (!lifted) return;
        // A move re-renders the list and focus comes straight back to this
        // handle (focusHandle), so only a real departure puts the game down.
        const handle = e.currentTarget;
        window.setTimeout(() => {
          if (document.activeElement !== handle) setLifted(false);
        }, 0);
      }}
      className="flex h-9 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-ink-subtle/70 transition-colors hover:text-ink focus-visible:text-ink active:cursor-grabbing disabled:cursor-default disabled:opacity-30 aria-pressed:bg-white/[0.1] aria-pressed:text-ink"
    >
      <GripVertical size={16} strokeWidth={2} />
    </button>
  );
}

export function ReorderButtons({
  entryId,
  name,
  index,
  count,
}: {
  entryId: string;
  name: string;
  index: number;
  count: number;
}) {
  const t = useT();
  const move = (delta: number) => {
    if (shift(entryId, delta)) announceMove(t, entryId, name, index + delta, count);
  };
  const button =
    "flex h-8 w-8 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-white/[0.07] hover:text-ink disabled:pointer-events-none disabled:opacity-25";
  return (
    <span className="flex items-center opacity-0 transition-opacity duration-200 group-hover/row:opacity-100 group-focus-within/row:opacity-100">
      <button
        type="button"
        aria-label={t("Move {name} up", { name })}
        disabled={index === 0}
        onClick={() => move(-1)}
        className={button}
      >
        <ChevronUp size={16} strokeWidth={2.2} />
      </button>
      <button
        type="button"
        aria-label={t("Move {name} down", { name })}
        disabled={index >= count - 1}
        onClick={() => move(1)}
        className={button}
      >
        <ChevronDown size={16} strokeWidth={2.2} />
      </button>
    </span>
  );
}

export function MoreButton({
  label,
  onOpen,
  className = "",
}: {
  label: string;
  onOpen: (button: HTMLElement) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      data-menu-trigger
      aria-label={label}
      aria-haspopup="menu"
      onClick={(e) => onOpen(e.currentTarget)}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-white/[0.07] hover:text-ink ${className}`}
    >
      <Ellipsis size={17} strokeWidth={2.2} />
    </button>
  );
}

const STATUS_LABEL: Record<GameStatus, string> = {
  playing: "Playing",
  paused: "Paused",
  completed: "Completed",
  dropped: "Dropped",
};

export function StatusChip({ status }: { status: GameStatus }) {
  const t = useT();
  const tone =
    status === "completed"
      ? "bg-emerald-400/12 text-emerald-300"
      : status === "playing"
        ? "bg-accent/15 text-accent"
        : "bg-white/[0.07] text-ink-muted";
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] ${tone}`}
    >
      {t(STATUS_LABEL[status])}
    </span>
  );
}

/** The dot between parts of a meta line. */
export function Dot() {
  return <span aria-hidden className="h-1 w-1 shrink-0 rounded-full bg-ink-subtle/60" />;
}
