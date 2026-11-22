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
