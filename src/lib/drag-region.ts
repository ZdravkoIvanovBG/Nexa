// Mirrors Tauri 2's drag-region test (tauri/src/window/scripts/drag.js), so the
// fullscreen guard blocks exactly the mousedowns Tauri would turn into a window
// drag or a double-click maximize, and never a click on an interactive element.
// Dependency-free so node --test can exercise it.

export const TAURI_DRAG_REGION_ATTR = "data-tauri-drag-region";

const CLICKABLE_TAGS = new Set(["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "LABEL", "SUMMARY"]);
const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "menuitem",
  "tab",
  "checkbox",
  "radio",
  "switch",
  "option",
]);

/** The parts of an element the test reads. */
export type DragPathElement = {
  tagName: string;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
};

function isClickable(el: DragPathElement): boolean {
  return (
    CLICKABLE_TAGS.has(el.tagName) ||
    (el.hasAttribute("contenteditable") && el.getAttribute("contenteditable") !== "false") ||
    (el.hasAttribute("tabindex") && el.getAttribute("tabindex") !== "-1") ||
    INTERACTIVE_ROLES.has(el.getAttribute("role") ?? "")
  );
}

/** `path` is the event's composed path, target first, non-elements removed. */
export function isTauriDragRegion(path: readonly DragPathElement[]): boolean {
  for (const el of path) {
    const attr = el.getAttribute(TAURI_DRAG_REGION_ATTR);
    if (isClickable(el) && attr === null) return false;
    if (attr === null) continue;
    if (attr === "false") return false;
    if (attr === "deep") return true;
    if (attr === "" || attr === "true") return el === path[0];
  }
  return false;
}

/**
 * Whether a mousedown would make Tauri drag or maximize the window: the same
 * conditions as Tauri's own listener (left button, single or double click).
 */
export function wouldTauriDragOrMaximize(
  e: { button: number; detail: number },
  path: readonly DragPathElement[],
): boolean {
  return e.button === 0 && (e.detail === 1 || e.detail === 2) && isTauriDragRegion(path);
}

/**
 * Marks a layout's title bar: the top bar of the default layout, Royal, Top
 * Dock, Cinematic and MinUI. Only a double-click on a drag region inside one
 * changes the window state; content and sidebars keep single-press dragging.
 */
export const WINDOW_TITLEBAR_ATTR = "data-window-titlebar";

/**
 * Empty title-bar space that isn't a drag region right now: the default top
 * bar drops its drag region in fullscreen. Like a plain drag region, it counts
 * only when it is the element clicked, never a child of it.
 */
export const TITLEBAR_SPACE_ATTR = "data-window-titlebar-space";

/** What the window guard does with a mousedown, before Tauri's own listener sees it. */
export type TitleBarAction = "pass" | "block" | "exit-fullscreen";

/**
 * Windows only (the guard's caller checks). Tauri turns a mousedown on a drag
 * region into a window drag (first press) or maximize/restore (second press).
 * - Not a drag region, or not the left button: untouched.
 * - True fullscreen: never a drag; a double-click on the title bar leaves
 *   fullscreen to a normal window, as the Maximize/Restore button does.
 * - Normal or maximized: dragging is untouched; a double-click maximizes or
 *   restores only on the title bar, never on content, sidebars or the player.
 */
export function titleBarMouseDown(
  e: { button: number; detail: number },
  path: readonly DragPathElement[],
  fullscreen: boolean,
): TitleBarAction {
  const onTitleBar = path.some((el) => el.hasAttribute(WINDOW_TITLEBAR_ATTR));
  const tauriActs = wouldTauriDragOrMaximize(e, path);
  if (fullscreen) {
    const emptySpace = tauriActs || (path.length > 0 && path[0].hasAttribute(TITLEBAR_SPACE_ATTR));
    if (e.button === 0 && e.detail === 2 && onTitleBar && emptySpace) return "exit-fullscreen";
    return tauriActs ? "block" : "pass";
  }
  if (!tauriActs) return "pass";
  return e.detail === 2 && !onTitleBar ? "block" : "pass";
}
