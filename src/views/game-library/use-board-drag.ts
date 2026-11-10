import { useCallback, useEffect, useRef } from "react";
import type { GameId } from "@/lib/game-library/types";
import type { Tier } from "@/lib/tracking-tiers";
import { insertionSlot, type Box } from "./board-geometry";

// Dragging a game around the Tier List. The same approach as the movie Tier
// List and the Wishlist: raw pointer events, because HTML5 drag and drop
// misbehaves in the Windows WebView; a 6 px threshold so a press stays a
// click; and nothing but direct DOM writes until the pointer is released,
// when the move is committed once. Added here: a marker showing the exact
// slot (computed without the dragged tile, so the drop lands where it shows),
// scrolling near the edges, and Escape to cancel.

const THRESHOLD_PX = 6;
const EDGE_PX = 64;
const MAX_SCROLL_PX = 18;
const GAP_PX = 8;
const ROW_SHADOW = "inset 0 0 0 2px var(--color-accent)";

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return null;
}

function box(el: Element): Box {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

export type BoardDrop = { gameId: GameId; tier: Tier; slot: number };

export function useBoardDrag(onDrop: (drop: BoardDrop) => void) {
  const onDropRef = useRef(onDrop);
  const cancelRef = useRef<(() => void) | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    onDropRef.current = onDrop;
  }, [onDrop]);

  // A board that unmounts mid-drag (tab or profile change) leaves nothing behind.
  useEffect(() => () => cancelRef.current?.(), []);

  const start = useCallback((gameId: GameId, e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || cancelRef.current) return;
    const handle = e.currentTarget;
    const tile = handle.closest<HTMLElement>("[data-board-tile]");
    if (!tile) return;
    const pointerId = e.pointerId;
    const startX = e.clientX;
    const startY = e.clientY;
    const origin = tile.getBoundingClientRect();
    const grabX = startX - origin.left;
    const grabY = startY - origin.top;
    const rtl = getComputedStyle(tile).direction === "rtl";
    const scroller = scrollParent(tile);
    let lastX = startX;
    let lastY = startY;
    let started = false;
    let target: { tier: Tier; slot: number } | null = null;
    let ghost: HTMLElement | null = null;
    let marker: HTMLElement | null = null;
    let row: HTMLElement | null = null;
    let frame: number | null = null;

    const setRow = (next: HTMLElement | null) => {
      if (next === row) return;
      if (row) row.style.boxShadow = "";
      if (next) next.style.boxShadow = ROW_SHADOW;
      row = next;
    };

    const locate = () => {
      if (!ghost || !marker) return;
      ghost.style.transform = `translate3d(${lastX - grabX}px, ${lastY - grabY}px, 0) rotate(2deg)`;
      const drop = document
        .elementFromPoint(lastX, lastY)
        ?.closest<HTMLElement>("[data-board-drop]");
      if (!drop) {
        target = null;
        marker.style.display = "none";
        setRow(null);
        return;
      }
      const tiles = Array.from(drop.querySelectorAll<HTMLElement>("[data-board-tile]")).filter(
        (el) => el.dataset.boardTile !== gameId,
      );
      const area = drop.getBoundingClientRect();
      const style = getComputedStyle(drop);
      const padStart = parseFloat(rtl ? style.paddingRight : style.paddingLeft) || 0;
      const padTop = parseFloat(style.paddingTop) || 0;
      const empty: Box = {
        left: area.left + padStart - GAP_PX / 2,
        right: area.right - padStart + GAP_PX / 2,
        top: area.top + padTop,
        bottom: area.top + padTop + origin.height,
      };
      const slot = insertionSlot(tiles.map(box), lastX, lastY, { empty, gap: GAP_PX, rtl });
      target = { tier: drop.dataset.boardDrop as Tier, slot: slot.index };
      marker.style.display = "block";
      marker.style.transform = `translate3d(${slot.x - 1.5}px, ${slot.top}px, 0)`;
      marker.style.height = `${Math.max(24, slot.bottom - slot.top)}px`;
      setRow(drop);
    };

    // Holds the step so it can schedule itself, as in use-pointer-sort.
    const scroll = { step: () => {} };
    scroll.step = () => {
      frame = null;
      if (!scroller || !started) return;
      const rect = scroller.getBoundingClientRect();
      let speed = 0;
      if (lastY < rect.top + EDGE_PX) {
        speed = -MAX_SCROLL_PX * Math.min(1, (rect.top + EDGE_PX - lastY) / EDGE_PX);
      } else if (lastY > rect.bottom - EDGE_PX) {
        speed = MAX_SCROLL_PX * Math.min(1, (lastY - (rect.bottom - EDGE_PX)) / EDGE_PX);
      }
      if (speed === 0) return;
      scroller.scrollTop += speed;
      locate();
      frame = window.requestAnimationFrame(scroll.step);
    };

    const begin = () => {
      started = true;
      ghost = tile.cloneNode(true) as HTMLElement;
      for (const el of [ghost, ...Array.from(ghost.querySelectorAll<HTMLElement>("*"))]) {
        el.removeAttribute("id");
        el.removeAttribute("data-board-tile");
        el.removeAttribute("data-tile-handle");
      }
      ghost.setAttribute("aria-hidden", "true");
      Object.assign(ghost.style, {
        position: "fixed",
        left: "0",
        top: "0",
        width: `${origin.width}px`,
        margin: "0",
        // The clone is a list item; outside its list it would grow a bullet.
        display: "block",
        listStyle: "none",
        zIndex: "400",
        pointerEvents: "none",
        opacity: "0.92",
        filter: "drop-shadow(0 18px 30px rgba(0,0,0,0.55))",
        willChange: "transform",
      });
      marker = document.createElement("div");
      marker.setAttribute("aria-hidden", "true");
      Object.assign(marker.style, {
        position: "fixed",
        left: "0",
        top: "0",
        width: "3px",
        borderRadius: "3px",
        background: "var(--color-accent)",
        boxShadow: "0 0 10px var(--color-accent)",
        zIndex: "399",
        pointerEvents: "none",
        display: "none",
      });
      document.body.append(ghost, marker);
      tile.style.opacity = "0.35";
      document.body.style.cursor = "grabbing";
      document.body.style.userSelect = "none";
    };

    let detach = () => {};

    const end = (commit: boolean) => {
      cancelRef.current = null;
      if (frame !== null) window.cancelAnimationFrame(frame);
      detach();
      try {
        handle.releasePointerCapture(pointerId);
      } catch {
        /* already released */
      }
      if (!started) return;
      ghost?.remove();
      marker?.remove();
      setRow(null);
      tile.style.opacity = "";
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      // The release that ends a drag also clicks the tile; that click must not
      // open the game. It arrives in this same task, so a timeout clears it.
      suppressClick.current = true;
      const drop = commit ? target : null;
      window.setTimeout(() => {
        suppressClick.current = false;
        if (drop) onDropRef.current({ gameId, tier: drop.tier, slot: drop.slot });
      }, 0);
    };

    const onPointerMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      lastX = ev.clientX;
      lastY = ev.clientY;
      if (!started) {
        if (Math.hypot(lastX - startX, lastY - startY) < THRESHOLD_PX) return;
        begin();
      }
      ev.preventDefault();
      locate();
      if (frame === null) frame = window.requestAnimationFrame(scroll.step);
    };
    const onPointerUp = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) end(true);
    };
    const onPointerCancel = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) end(false);
    };
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape" || !started) return;
      ev.preventDefault();
      ev.stopPropagation();
      end(false);
    };
    const onBlur = () => end(false);

    try {
      handle.setPointerCapture(pointerId);
    } catch {
      /* capture is a nicety: the window listeners still see the pointer */
    }
    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("blur", onBlur);
    detach = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("blur", onBlur);
    };
    cancelRef.current = () => end(false);
  }, []);

  /** True once, for the click that ends a drag. */
  const consumeClick = useCallback(() => {
    const suppressed = suppressClick.current;
    suppressClick.current = false;
    return suppressed;
  }, []);

  return { start, consumeClick };
}
