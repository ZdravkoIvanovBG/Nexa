import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { useT } from "@/lib/i18n";
import { useTvFocusScope } from "@/lib/keyboard-navigation";

export type OverflowItem = { key: string; node: ReactNode };

/**
 * Keeps a transport control cluster inside its column. Everything that fits is
 * rendered inline; the tail moves into a "More" popover so no control is ever
 * lost or pushed off-screen on a narrow window.
 *
 * Measurement mirrors `src/chrome/nav-overflow.tsx`: an invisible ghost row
 * holds every item at full size so widths stay knowable even while the visible
 * row is truncated. The ghost is `invisible`, so `isVisible()` in
 * keyboard-navigation skips it and D-pad focus never lands there.
 */
export function ControlOverflow({
  items,
  gapPx,
  className = "",
}: {
  items: OverflowItem[];
  gapPx: number;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(items.length);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const ghost = ghostRef.current;
    if (!container || !ghost) return;

    const measure = () => {
      const els = Array.from(ghost.querySelectorAll<HTMLElement>("[data-ghost-item]"));
      const moreW = ghost.querySelector<HTMLElement>("[data-ghost-more]")?.offsetWidth ?? 0;
      const widths = els.map((el) => el.offsetWidth);
      const avail = container.clientWidth;
      if (avail <= 0) return;

      const totalAll = widths.reduce((a, b) => a + b, 0) + gapPx * Math.max(0, widths.length - 1);
      if (totalAll <= avail) {
        setVisible(widths.length);
        return;
      }
      let used = moreW + gapPx;
      let count = 0;
      for (const w of widths) {
        const add = w + gapPx;
        if (used + add > avail) break;
        used += add;
        count++;
      }
      setVisible(count);
    };

    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    document.fonts?.ready.then(measure).catch(() => {});
    return () => ro.disconnect();
  }, [items, gapPx]);

  const shown = items.slice(0, visible);
  const hidden = items.slice(visible);

  return (
    <div
      ref={containerRef}
      className={`relative flex min-w-0 flex-1 items-center justify-end ${className}`}
      style={{ gap: gapPx }}
    >
      {shown.map((it) => (
        <span key={it.key} className="shrink-0">
          {it.node}
        </span>
      ))}
      {hidden.length > 0 && <MoreMenu items={hidden} gapPx={gapPx} />}

      <div
        ref={ghostRef}
        aria-hidden
        className="pointer-events-none invisible absolute start-0 top-0 flex w-0 items-center overflow-hidden"
        style={{ gap: gapPx }}
      >
        {items.map((it) => (
          <span key={it.key} data-ghost-item className="shrink-0">
            {it.node}
          </span>
        ))}
        <span data-ghost-more className="shrink-0">
          <MoreButton open={false} />
        </span>
      </div>
    </div>
  );
}

function MoreMenu({ items, gapPx }: { items: OverflowItem[]; gapPx: number }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useTvFocusScope(open, ref);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <MoreButton open={open} onClick={() => setOpen((o) => !o)} label={t("common.more")} />
      {open && (
        <div
          data-tv-focus-scope
          className="absolute end-0 bottom-[calc(100%+10px)] z-40 flex max-w-[min(20rem,calc(100vw-2rem))] flex-wrap items-center justify-end rounded-2xl border border-white/15 bg-black/85 p-1.5 shadow-[0_24px_60px_-15px_rgba(0,0,0,0.9)] backdrop-blur-md"
          style={{ gap: gapPx }}
        >
          {items.map((it) => (
            <span key={it.key} className="shrink-0">
              {it.node}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function MoreButton({
  open,
  onClick,
  label,
}: {
  open: boolean;
  onClick?: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label={label ?? "More"}
      title={label}
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors ${
        open ? "bg-white/22 text-white" : "text-white/85 hover:bg-white/10 hover:text-white"
      }`}
    >
      <MoreHorizontal size={22} strokeWidth={2} />
    </button>
  );
}
