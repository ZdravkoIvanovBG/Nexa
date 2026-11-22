import { isWindowsDesktop } from "@/lib/platform";
import { loadStoredSettings } from "@/lib/settings/load";
import { type DragPathElement, titleBarMouseDown } from "@/lib/drag-region";

let windowFullscreen = false;
// Bumped on every change, so an OS query that started before a change can be
// recognised as stale instead of clobbering the newer value.
let fullscreenVersion = 0;
// enter/exit calls currently waiting on the OS; the OS is mid-transition then,
// so reconciling against it would read a half-applied state.
let transitionsInFlight = 0;
let suppressNextExit = false;
let marathonReenter = false;
const subs = new Set<() => void>();

export function suppressFullscreenExitOnce(): void {
  suppressNextExit = true;
  setTimeout(() => {
    suppressNextExit = false;
  }, 1000);
}

export function beginMarathonAdvance(): void {
  suppressFullscreenExitOnce();
  marathonReenter = windowFullscreen;
  void isAnyFullscreen().then((fs) => {
    if (fs) marathonReenter = true;
  });
  setTimeout(() => {
    marathonReenter = false;
  }, 10000);
}

export function consumeMarathonReenter(): boolean {
  const v = marathonReenter;
  marathonReenter = false;
  return v;
}

function isTauri(): boolean {
  return (
    typeof window !== "undefined" && ("__TAURI__" in window || "__TAURI_INTERNALS__" in window)
  );
}

function emit(): void {
  for (const fn of subs) fn();
}

export function getWindowFullscreen(): boolean {
  return windowFullscreen;
}

export function subscribeFullscreen(fn: () => void): () => void {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

export function setWindowFullscreen(v: boolean): void {
  if (windowFullscreen === v) return;
  windowFullscreen = v;
  fullscreenVersion++;
  emit();
}

export async function enterWindowFullscreen(): Promise<void> {
  setWindowFullscreen(true);
  if (isTauri()) {
    transitionsInFlight++;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("window_fullscreen_enter");
    } catch {
      /* ignore */
    } finally {
      transitionsInFlight--;
      // If the call failed the cache above is wrong; this puts it right.
      void reconcileWithOs();
    }
  } else if (document.documentElement.requestFullscreen) {
    void document.documentElement.requestFullscreen().catch(() => {});
  }
}

/**
 * `toNormal`: leave as a normal, draggable window (the title-bar button)
 * instead of returning to the pre-fullscreen state (F11, Esc, player).
 */
export async function exitWindowFullscreen(opts: { toNormal?: boolean } = {}): Promise<void> {
  if (suppressNextExit) {
    suppressNextExit = false;
    return;
  }
  setWindowFullscreen(false);
  if (isTauri()) {
    transitionsInFlight++;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("window_fullscreen_exit", {
        restorePosition: loadStoredSettings().fullscreenRestorePosition !== false,
        toNormal: opts.toNormal === true,
      });
    } catch {
      /* ignore */
    } finally {
      transitionsInFlight--;
      void reconcileWithOs();
    }
  } else if (document.fullscreenElement) {
    void document.exitFullscreen().catch(() => {});
  }
}

export async function exitWindowFullscreenOnPlayerClose(): Promise<void> {
  if (loadStoredSettings().keepFullscreenOnExit) return;
  await exitWindowFullscreen();
}

export async function toggleWindowFullscreen(): Promise<void> {
  if (windowFullscreen) await exitWindowFullscreen();
  else await enterWindowFullscreen();
}

async function osWindowFullscreen(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    return await getCurrentWindow()
      .isFullscreen()
      .catch(() => false);
  } catch {
    return false;
  }
}

export async function isAnyFullscreen(): Promise<boolean> {
  if (windowFullscreen) return true;
  if (typeof document !== "undefined" && document.fullscreenElement) return true;
  return osWindowFullscreen();
}

export async function exitAnyFullscreen(): Promise<void> {
  if (typeof document !== "undefined" && document.fullscreenElement) {
    await document.exitFullscreen().catch(() => {});
  }
  if (isTauri() && isWindowsDesktop()) {
    // Through the controller, so the window returns to its real pre-fullscreen
    // state. Not via exitWindowFullscreen(): a pending suppressNextExit must not
    // skip this one (see below).
    transitionsInFlight++;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("window_fullscreen_exit", {
        restorePosition: loadStoredSettings().fullscreenRestorePosition !== false,
        toNormal: false,
      });
    } catch {
      /* ignore */
    } finally {
      transitionsInFlight--;
    }
    setWindowFullscreen(false);
    void reconcileWithOs();
    return;
  }
  if (isTauri()) {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const w = getCurrentWindow();
      if (await w.isFullscreen().catch(() => false)) await w.setFullscreen(false).catch(() => {});
    } catch {
      /* ignore */
    }
  }
  // The OS window was just forced out of fullscreen above, so this is
  // unconditional. Going through exitWindowFullscreen() would let a pending
  // suppressNextExit (armed by a marathon advance) skip the update and leave
  // the cache claiming fullscreen while the window is not.
  setWindowFullscreen(false);
}

/**
 * Brings the cached flag back in line with the real OS window. The cache is
 * the only thing the resize handles and startResize() consult, so a wrong value
 * that is never re-checked silently disables window resizing for the session.
 *
 * Skipped while an enter/exit is in flight (the OS is mid-transition), and
 * retried if the cache changed while the query was pending.
 */
async function reconcileWithOs(attempts = 3): Promise<void> {
  if (!isTauri()) return;
  for (let i = 0; i < attempts; i++) {
    if (transitionsInFlight > 0) return;
    const version = fullscreenVersion;
    const os = await osWindowFullscreen();
    if (transitionsInFlight > 0) return;
    if (version === fullscreenVersion) {
      setWindowFullscreen(os);
      return;
    }
  }
}

/** True while a drag or double-click on a drag region must not reach Tauri. */
export function fullscreenBlocksWindowDrag(): boolean {
  return isWindowsDesktop() && windowFullscreen;
}

/**
 * Windows. Decides what Tauri may do with a mousedown on a drag region
 * (titleBarMouseDown):
 * - In true fullscreen a drag region must neither drag the window nor maximize
 *   it: either one strands the window fullscreen-styled, without a sizing
 *   border, Snap or resizing. A double-click on the title bar instead leaves
 *   fullscreen to a normal window, as the Maximize/Restore button does.
 * - Otherwise only a double-click on the title bar maximizes or restores. Many
 *   pages mark their own background as a drag region so it can move the window;
 *   a double-click in a gap there must not resize Nexa.
 * Tauri's drag listener is on `document`, so this listener on <html> runs after
 * the page's own handlers (React, buttons) and before Tauri's. It stops only
 * mousedowns Tauri itself would act on, which Tauri also stops, so
 * document/window listeners see the same events as before.
 */
export function installFullscreenDragGuard(root: HTMLElement): () => void {
  const onMouseDown = (e: MouseEvent) => {
    if (!isWindowsDesktop()) return;
    const path = e
      .composedPath()
      .filter(
        (n): n is HTMLElement => typeof HTMLElement !== "undefined" && n instanceof HTMLElement,
      );
    const action = titleBarMouseDown(e, path as DragPathElement[], fullscreenBlocksWindowDrag());
    if (action === "pass") return;
    e.preventDefault();
    e.stopPropagation();
    if (action === "exit-fullscreen") void exitWindowFullscreen({ toNormal: true });
  };
  root.addEventListener("mousedown", onMouseDown);
  return () => root.removeEventListener("mousedown", onMouseDown);
}

if (isTauri()) {
  installFullscreenDragGuard(document.documentElement);
  void reconcileWithOs();
  // Rust announces every fullscreen change, including ones the frontend did not
  // start (e.g. restored window state).
  void import("@tauri-apps/api/event")
    .then(({ listen }) => {
      void listen("fs://entered", () => setWindowFullscreen(true));
      void listen("fs://exited", () => setWindowFullscreen(false));
    })
    .catch(() => {});
  // Fullscreen can also change without an event: exitAnyFullscreen(), the mac
  // toggleMaximize() and the layout editor call the window API directly.
  window.addEventListener("focus", () => void reconcileWithOs());
}
