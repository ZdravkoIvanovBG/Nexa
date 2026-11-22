import { openUrl as tauriOpenUrl } from "@tauri-apps/plugin-opener";
import { getCurrentWindow, type Window } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import {
  exitWindowFullscreen,
  getWindowFullscreen,
  toggleWindowFullscreen,
} from "@/lib/fullscreen-state";
import { isMacDesktop, isWindowsDesktop } from "@/lib/platform";
import { useWindowFullscreen } from "@/lib/use-window-fullscreen";

const win: Window | null = isTauri() ? getCurrentWindow() : null;

const IS_MAC = isMacDesktop();
const IS_WINDOWS = isWindowsDesktop();

function isTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export const minimize = () => win?.minimize();

export const toggleMaximize = async () => {
  if (!win) return;
  if (IS_MAC) {
    const fs = await win.isFullscreen().catch(() => false);
    await win.setFullscreen(!fs).catch(() => {});
    return;
  }
  if (isWindowsDesktop()) {
    // In true fullscreen the button leaves to a normal window; maximizing a
    // fullscreen window would strand it without borders, Snap or resizing.
    const fs = await win.isFullscreen().catch(() => getWindowFullscreen());
    if (fs) {
      await exitWindowFullscreen({ toNormal: true });
      return;
    }
  }
  await win.toggleMaximize().catch(() => {});
};

/**
 * The default title bar's Maximize/Restore button. Windows: leaves true
 * fullscreen to a normal window, otherwise a real maximize/restore. Elsewhere
 * it keeps toggling fullscreen as before.
 */
export const windowMaxButton = async () => {
  if (isWindowsDesktop()) {
    await toggleMaximize();
    return;
  }
  await toggleWindowFullscreen();
};

export const close = () => win?.close();

export type ResizeDir =
  | "East"
  | "North"
  | "NorthEast"
  | "NorthWest"
  | "South"
  | "SouthEast"
  | "SouthWest"
  | "West";

export function startResize(direction: ResizeDir) {
  if (getWindowFullscreen()) return;
  win?.startResizeDragging(direction).catch(() => {});
}

export function useMaximized(): boolean {
  const [maxed, setMaxed] = useState(false);
  useEffect(() => {
    if (!win) return;
    let cancelled = false;
    let timer: number | null = null;
    const check = () => {
      (IS_MAC ? win.isFullscreen() : win.isMaximized())
        .then((v) => {
          if (!cancelled) setMaxed(v);
        })
        .catch(() => {});
    };
    check();
    const schedule = () => {
      if (timer != null) return;
      timer = window.setTimeout(() => {
        timer = null;
        check();
      }, 150);
    };
    // The resize handles hide while this is true, and a resize event is the only
    // thing that re-checks it. If the listener never registers, or the value was
    // wrong at mount, nothing else could ever correct it, so also re-check on
    // focus.
    const unlisten = win.onResized(schedule).catch(() => null);
    window.addEventListener("focus", schedule);
    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
      window.removeEventListener("focus", schedule);
      unlisten.then((fn) => fn?.());
    };
  }, []);
  return maxed;
}

/**
 * Whether a Maximize/Restore button shows "Restore". On Windows that is
 * maximized or true fullscreen (the button leaves fullscreen), the same in
 * every layout.
 */
export function useWindowRestoreIcon(): boolean {
  const maximized = useMaximized();
  const fullscreen = useWindowFullscreen();
  return IS_WINDOWS ? maximized || fullscreen : maximized;
}

export function openUrl(url: string) {
  if (!url) return;
  if (isTauri()) {
    tauriOpenUrl(url).catch(() => {
      invoke("browser_open", { url }).catch(() => {
        try {
          window.open(url, "_blank", "noopener,noreferrer");
        } catch {
          /* swallow */
        }
      });
    });
    return;
  }
  try {
    window.open(url, "_blank", "noopener,noreferrer");
  } catch {
    /* swallow */
  }
}

// Hosts that aggressively block iframe embedding (X-Frame-Options DENY,
// bot/captcha challenges, etc.). For these, skip the viewport — open
// in the user's real browser instead, like a normal link.
const IFRAME_HOSTILE_HOSTS = [
  "imdb.com",
  "www.imdb.com",
  "m.imdb.com",
  "youtube.com",
  "www.youtube.com",
  "accounts.google.com",
  "github.com",
  "x.com",
  "twitter.com",
];

function isIframeHostile(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return IFRAME_HOSTILE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

export function openInAppBrowser(url: string, title?: string) {
  if (!url) return;
  if (isIframeHostile(url)) {
    openUrl(url);
    return;
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("harbor:open-embed-viewport", { detail: { url, title } }));
  }
}
