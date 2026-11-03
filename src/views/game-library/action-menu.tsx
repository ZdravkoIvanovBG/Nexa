import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// The Game Library's menu, opened by right-click or a ⋯ button. It is its own
// small component rather than a target in the global context menu, which is
// built around movie metadata and has no keyboard support. Calling
// preventDefault on the contextmenu event keeps the global menu from opening
// as well.

export type MenuItem =
  | {
      id: string;
      label: string;
      icon: ReactNode;
      run: () => void;
      disabled?: boolean;
      danger?: boolean;
    }
  | { id: string; separator: true };

type Anchor = { x: number; y: number; alignEnd: boolean };

type MenuState = { items: MenuItem[]; anchor: Anchor; trigger: HTMLElement | null };

const MARGIN = 8;
const WIDTH = 236;
const SCROLL_GRACE_MS = 200;

function isAction(item: MenuItem): item is Extract<MenuItem, { run: () => void }> {
  return !("separator" in item);
}

/**
 * Opens the menu below a button, or at the pointer for a right-click. A
 * keyboard-triggered click reports no coordinates, so a button is always
 * placed from its own rectangle.
 */
export function useActionMenu() {
  const [state, setState] = useState<MenuState | null>(null);

  const openFromButton = useCallback((button: HTMLElement, items: MenuItem[]) => {
    const rect = button.getBoundingClientRect();
    const rtl = document.documentElement.dir === "rtl";
    // Lines up with the button's end edge, unless that would push it off screen.
    const endFits = rtl
      ? rect.left + WIDTH <= window.innerWidth - MARGIN
      : rect.right - WIDTH >= MARGIN;
    const extendLeft = rtl ? !endFits : endFits;
    setState({
      items,
      trigger: button,
      anchor: {
        x: extendLeft ? rect.right : rect.left,
        y: rect.bottom + 6,
        alignEnd: extendLeft,
      },
    });
  }, []);

  const openAtPointer = useCallback((event: React.MouseEvent, items: MenuItem[]) => {
    event.preventDefault();
    event.stopPropagation();
    const trigger =
      event.currentTarget instanceof HTMLElement
        ? (event.currentTarget.querySelector<HTMLElement>("[data-menu-trigger]") ??
          event.currentTarget)
        : null;
    setState({ items, trigger, anchor: { x: event.clientX, y: event.clientY, alignEnd: false } });
  }, []);

  const close = useCallback(() => setState(null), []);

  const element = state ? (
    <ActionMenuPopover
      items={state.items}
      anchor={state.anchor}
      onClose={(restoreFocus) => {
        const trigger = state.trigger;
        setState(null);
        if (restoreFocus && trigger?.isConnected) trigger.focus({ preventScroll: true });
      }}
    />
  ) : null;

  return { openFromButton, openAtPointer, close, element, isOpen: state !== null };
}

function ActionMenuPopover({
  items,
  anchor,
  onClose,
}: {
  items: MenuItem[];
  anchor: Anchor;
  onClose: (restoreFocus: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const wantLeft = anchor.alignEnd ? anchor.x - width : anchor.x;
    const left = Math.max(MARGIN, Math.min(wantLeft, window.innerWidth - width - MARGIN));
    const below = anchor.y;
    const top =
      below + height + MARGIN <= window.innerHeight
        ? below
        : Math.max(MARGIN, window.innerHeight - height - MARGIN);
    setPos({ left, top });
  }, [anchor]);

  const buttons = () =>
    Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);

  useEffect(() => {
    if (pos) buttons()[0]?.focus({ preventScroll: true });
  }, [pos]);

  // A scroll still settling when the menu opens, like a touchpad's inertia,
  // would otherwise close it at once. Scrolling after this closes it as usual.
  const openedAt = useRef(0);
  useEffect(() => {
    openedAt.current = performance.now();
  }, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose(false);
    };
    const onScroll = (e: Event) => {
      if (performance.now() - openedAt.current < SCROLL_GRACE_MS) return;
      if (!ref.current?.contains(e.target as Node)) onClose(false);
    };
    const onResize = () => onClose(false);
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("contextmenu", onDown, true);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    window.addEventListener("blur", onResize);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("contextmenu", onDown, true);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("blur", onResize);
    };
  }, [onClose]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const list = buttons();
    const index = list.indexOf(document.activeElement as HTMLButtonElement);
    const focus = (i: number) => list[(i + list.length) % list.length]?.focus();
    if (e.key === "ArrowDown") focus(index + 1);
    else if (e.key === "ArrowUp") focus(index - 1);
    else if (e.key === "Home") focus(0);
    else if (e.key === "End") focus(list.length - 1);
    else if (e.key === "Escape") onClose(true);
    else if (e.key === "Tab") onClose(true);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return createPortal(
    <div
      ref={ref}
      role="menu"
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        left: pos?.left ?? anchor.x,
        top: pos?.top ?? anchor.y,
        width: WIDTH,
        visibility: pos ? "visible" : "hidden",
      }}
      className="fixed z-[240] flex flex-col rounded-xl border border-edge bg-elevated p-1 shadow-[0_18px_50px_-15px_rgba(0,0,0,0.7)] animate-popover-in"
    >
      {items.map((item) =>
        isAction(item) ? (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              onClose(true);
              item.run();
            }}
            className={`flex h-9 shrink-0 items-center gap-2.5 rounded-lg px-3 text-start text-[13px] outline-none transition-colors focus-visible:bg-raised ${
              item.disabled
                ? "cursor-not-allowed text-ink-subtle/55"
                : item.danger
                  ? "text-danger hover:bg-danger/10 focus-visible:bg-danger/10"
                  : "text-ink hover:bg-raised"
            }`}
          >
            <span
              className={`flex w-4 justify-center ${
                item.disabled
                  ? "text-ink-subtle/40"
                  : item.danger
                    ? "text-danger"
                    : "text-ink-muted"
              }`}
            >
              {item.icon}
            </span>
            <span className="truncate">{item.label}</span>
          </button>
        ) : (
          <span key={item.id} aria-hidden className="my-1 h-px shrink-0 bg-edge-soft/60" />
        ),
      )}
    </div>,
    document.body,
  );
}
