import { useCallback, useEffect, useRef, useState } from "react";
import { arrange, type Geometry } from "./sort-geometry";

// Pointer-driven reordering for one list, modelled on the movie Tier List's
// drag: the same 6px threshold, and nothing but direct style writes until the
// pointer is released, when the move is committed once. HTML5 drag and drop is
// avoided for the same reason as there: it misbehaves in the Windows WebView.
//
// Each list gets its own instance and only ever sees its direct children, so
// dragging a game inside a collection can't move the collection itself.

const THRESHOLD_PX = 6;
const EDGE_PX = 64;
const MAX_SCROLL_PX = 18;
const SHIFT_MS = 180;

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return null;
}

export function usePointerSort({
  onMove,
  disabled = false,
}: {
  /** `index` is the item's new place among the list's items. */
  onMove: (id: string, index: number) => void;
  disabled?: boolean;
}) {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const onMoveRef = useRef(onMove);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  useEffect(() => {
    onMoveRef.current = onMove;
  }, [onMove]);

  // A list that unmounts mid-drag leaves nothing behind.
  useEffect(() => () => cancelRef.current?.(), []);

  const startDrag = useCallback(
    (id: string, e: React.PointerEvent<HTMLElement>) => {
      if (disabled || e.button !== 0 || cancelRef.current) return;
      const handle = e.currentTarget;
      const item = handle.closest<HTMLElement>("[data-sort-item]");
      if (!container || !item || item.parentElement !== container) return;
      const items = Array.from(container.children).filter(
        (child): child is HTMLElement =>
          child instanceof HTMLElement && child.hasAttribute("data-sort-item"),
      );
      const from = items.indexOf(item);
      if (from < 0 || items.length < 2) return;
      e.preventDefault();

      const rects = items.map((el) => el.getBoundingClientRect());
      const geo: Geometry = {
        tops: rects.map((r) => r.top),
        heights: rects.map((r) => r.height),
        from,
      };
      const scroller = scrollParent(container);
      const startScroll = scroller?.scrollTop ?? 0;
      const pointerId = e.pointerId;
      const startY = e.clientY;
      let lastY = startY;
      let started = false;
      let target = from;
      let frame: number | null = null;

      const layout = () => {
        const scrolled = scroller ? scroller.scrollTop - startScroll : 0;
        const result = arrange(geo, startY, lastY - startY + scrolled);
        target = result.target;
        items.forEach((el, i) => {
          const y = i === from ? result.offset : result.shifts[i];
          el.style.transform = y ? `translate3d(0, ${y}px, 0)` : "";
        });
      };

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
        layout();
        frame = window.requestAnimationFrame(scroll.step);
      };

      const begin = () => {
        started = true;
        setDraggingId(id);
        document.body.style.cursor = "grabbing";
        items.forEach((el, i) => {
          if (i === from) {
            el.setAttribute("data-sort-dragging", "");
            el.style.position = "relative";
            el.style.zIndex = "20";
            el.style.transition = "none";
          } else {
            el.style.transition = `transform ${SHIFT_MS}ms cubic-bezier(0.2, 0, 0, 1)`;
          }
        });
      };

      // Set once the listeners exist, so ending can remove exactly those.
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
        // Snap, rather than animate, into the order React is about to render.
        for (const el of items) {
          el.style.transition = "none";
          el.style.transform = "";
          el.style.zIndex = "";
          el.style.position = "";
          el.removeAttribute("data-sort-dragging");
        }
        window.requestAnimationFrame(() => {
          for (const el of items) el.style.transition = "";
        });
        document.body.style.cursor = "";
        setDraggingId(null);
        if (commit && target !== from) onMoveRef.current(id, target);
      };

      const onPointerMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        lastY = ev.clientY;
        if (!started) {
          if (Math.abs(lastY - startY) < THRESHOLD_PX) return;
          begin();
        }
        layout();
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

      try {
        handle.setPointerCapture(pointerId);
      } catch {
        /* capture is a nicety: the window listeners still see the pointer */
      }
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerCancel);
      window.addEventListener("keydown", onKeyDown, true);
      detach = () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerCancel);
        window.removeEventListener("keydown", onKeyDown, true);
      };
      cancelRef.current = () => end(false);
    },
    [disabled, container],
  );

  return { container: setContainer, startDrag, draggingId };
}
