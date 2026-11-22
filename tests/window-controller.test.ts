// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import {
  isTauriDragRegion,
  titleBarMouseDown,
  wouldTauriDragOrMaximize,
} from "../src/lib/drag-region.ts";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const fullscreenRs = read("src-tauri/src/fullscreen.rs");
const libRs = read("src-tauri/src/lib.rs");
const pipRs = read("src-tauri/src/pip.rs");
const windowTs = read("src/lib/window.ts");
const fullscreenState = read("src/lib/fullscreen-state.ts");

// --- drag-region mirror ----------------------------------------------------

type FakeEl = {
  tagName: string;
  attrs: Record<string, string>;
  getAttribute(n: string): string | null;
  hasAttribute(n: string): boolean;
};
const el = (tagName: string, attrs: Record<string, string> = {}): FakeEl => ({
  tagName,
  attrs,
  getAttribute: (n) => (n in attrs ? attrs[n] : null),
  hasAttribute: (n) => n in attrs,
});
const DRAG = "data-tauri-drag-region";

test("a click directly on a drag region is a window drag", () => {
  const header = el("HEADER", { [DRAG]: "" });
  assert.equal(isTauriDragRegion([header, el("BODY")]), true);
  assert.equal(isTauriDragRegion([el("DIV", { [DRAG]: "true" })]), true);
});

test("title-bar buttons inside a drag region are never treated as drag", () => {
  const header = el("HEADER", { [DRAG]: "" });
  // The window-control buttons carry data-tauri-drag-region="false".
  assert.equal(isTauriDragRegion([el("BUTTON", { [DRAG]: "false" }), header]), false);
  // Any button, link, input or interactive role blocks the drag.
  for (const tag of ["BUTTON", "A", "INPUT", "SELECT", "TEXTAREA", "LABEL", "SUMMARY"]) {
    assert.equal(isTauriDragRegion([el(tag), header]), false, tag);
  }
  assert.equal(isTauriDragRegion([el("DIV", { role: "button" }), header]), false);
  assert.equal(isTauriDragRegion([el("DIV", { tabindex: "0" }), header]), false);
  // An svg/span inside a button: the button on the path blocks it.
  assert.equal(isTauriDragRegion([el("SPAN"), el("BUTTON"), header]), false);
});

test("a child of a plain drag region is not a drag, a child of a deep one is", () => {
  assert.equal(isTauriDragRegion([el("SPAN"), el("HEADER", { [DRAG]: "" })]), false);
  assert.equal(isTauriDragRegion([el("SPAN"), el("HEADER", { [DRAG]: "deep" })]), true);
  assert.equal(isTauriDragRegion([el("SPAN"), el("DIV")]), false);
});

test("only left single and double clicks count, like Tauri's own listener", () => {
  const path = [el("HEADER", { [DRAG]: "" })];
  assert.equal(wouldTauriDragOrMaximize({ button: 0, detail: 1 }, path), true);
  assert.equal(wouldTauriDragOrMaximize({ button: 0, detail: 2 }, path), true);
  assert.equal(wouldTauriDragOrMaximize({ button: 0, detail: 3 }, path), false);
  assert.equal(wouldTauriDragOrMaximize({ button: 2, detail: 1 }, path), false);
});

test("the drag-region mirror follows Tauri's drag.js rules", () => {
  // Guard against Tauri changing its rules under us: the mirror's sets must
  // match the installed script.
  const cargoLock = read("src-tauri/Cargo.lock");
  const version = cargoLock.match(/name = "tauri"\nversion = "([^"]+)"/)?.[1];
  assert.ok(version, "tauri version in Cargo.lock");
  const mirror = read("src/lib/drag-region.ts");
  for (const tag of ["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "LABEL", "SUMMARY"]) {
    assert.ok(mirror.includes(`"${tag}"`), tag);
  }
  for (const role of [
    "button",
    "link",
    "menuitem",
    "tab",
    "checkbox",
    "radio",
    "switch",
    "option",
  ]) {
    assert.ok(mirror.includes(`"${role}"`), role);
  }
});

// --- controller wiring -------------------------------------------------------

test("there is one controller: no runtime fallback to the v0.11.0 behavior", () => {
  assert.doesNotMatch(fullscreenRs, /NEXA_WINDOW_CONTROLLER|FullscreenImpl|is_placement/);
  assert.doesNotMatch(libRs, /window_controller_mode/);
  for (const f of ["src/lib/fullscreen-state.ts", "src/lib/window.ts", "src/chrome/topbar.tsx"]) {
    assert.doesNotMatch(read(f), /ControllerMode|window_controller_mode/, f);
  }
  // Placement capture is Windows-only; other platforms keep the saved-rect exit.
  assert.match(fullscreenRs, /#\[cfg\(not\(windows\)\)\]\s*\{\s*let _ = main;\s*None\s*\}/);
});

test("launch is still true fullscreen, after the one-time repair", () => {
  const ensure = libRs.indexOf("ensure_window_on_screen(&app.handle());");
  const repair = libRs.indexOf("fullscreen::repair_legacy_window_state_once(");
  const enter = libRs.indexOf("fullscreen::enter_fullscreen_now(");
  assert.ok(ensure !== -1 && repair !== -1 && enter !== -1);
  assert.ok(ensure < repair && repair < enter, "ensure → repair → launch fullscreen");
});

test("the repair runs once per installation, on Windows only", () => {
  const fn = fullscreenRs.match(
    /pub\(crate\) fn repair_legacy_window_state_once[\s\S]*?\n}\n/,
  )?.[0];
  assert.ok(fn);
  assert.match(fn, /if marker\.exists\(\) \{\s*return;/);
  assert.match(
    fullscreenRs,
    /#\[cfg\(windows\)\]\r?\npub\(crate\) fn repair_legacy_window_state_once/,
  );
  assert.match(libRs, /#\[cfg\(windows\)\]\s*fullscreen::repair_legacy_window_state_once/);
  assert.match(fn, /std::fs::write\(&marker/);
});

test("no lock is held across a native window call", () => {
  // Every lock in the controller is a single statement that reads or replaces a value.
  for (const m of fullscreenRs.matchAll(/\.lock\(\)\.unwrap\(\)/g)) {
    const line = fullscreenRs.slice(
      fullscreenRs.lastIndexOf("\n", m.index) + 1,
      fullscreenRs.indexOf("\n", m.index),
    );
    assert.match(
      line,
      /^\s*(\*state\.\w+\.lock\(\)\.unwrap\(\) = |let saved = state\.saved\.lock\(\)\.unwrap\(\)\.take\(\);|let \w+ = \*state\.\w+\.lock\(\)\.unwrap\(\);\r?$)/,
      line,
    );
  }
  assert.doesNotMatch(
    fullscreenRs,
    /let \w+ = state\.\w+\.lock\(\)\.unwrap\(\);/,
    "no long-lived guard",
  );
});

test("overlapping transitions are no-ops, not waits", () => {
  assert.match(fullscreenRs, /BusyGuard::try_acquire\(&state\.busy\)/);
  assert.doesNotMatch(fullscreenRs, /busy\.lock\(\)/);
});

test("close and tray quit restore the pre-fullscreen placement", () => {
  assert.match(
    libRs,
    /fn leave_fullscreen_before_exit[\s\S]*?fullscreen::exit_fullscreen_for_close\(window\)/,
  );
  assert.match(fullscreenRs, /apply_placement_now\(main, &saved, saved\.maximized\)/);
});

test("PiP from fullscreen leaves fullscreen first and returns to it", () => {
  assert.match(pipRs, /crate::fullscreen::exit_fullscreen\(/);
  assert.match(pipRs, /\(crate::fullscreen::capture_placement\(&main\), was_fullscreen\)/);
  assert.match(pipRs, /crate::fullscreen::apply_placement\(&app, &main, p, p\.maximized, false\)/);
  assert.match(pipRs, /if was_fullscreen \{\s*let fs_state[\s\S]*?enter_fullscreen_now/);
});

// --- frontend ----------------------------------------------------------------

test("the maximize button leaves true fullscreen to a normal window", () => {
  const fn = windowTs.match(/export const toggleMaximize = async \(\) => \{[\s\S]*?\n\};/)?.[0];
  assert.ok(fn);
  assert.match(fn, /exitWindowFullscreen\(\{ toNormal: true \}\)/);
  assert.match(fn, /win\.toggleMaximize\(\)/);
});

test("every layout's Maximize/Restore button uses the shared action and icon state", () => {
  const layouts = [
    "src/chrome/cinematic-overlay.tsx",
    "src/chrome/royal-topbar.tsx",
    "src/chrome/topdock.tsx",
    "src/chrome/window-controls.tsx",
    "src/components/player/transport/window-control-buttons.tsx",
    "src/chrome/siderail.tsx",
    "src/chrome/minui-dock/floating-top.tsx",
  ];
  for (const f of layouts) {
    const src = read(f);
    assert.match(src, /toggleMaximize/, `${f}: shared maximize action`);
    assert.match(src, /useWindowRestoreIcon\(\)/, `${f}: shared icon state`);
    assert.doesNotMatch(src, /useMaximized\(\)/, `${f}: no private maximized state`);
  }
  const topbar = read("src/chrome/topbar.tsx");
  assert.match(topbar, /windowMaxButton\(\)/);
  assert.match(topbar, /useWindowRestoreIcon\(\)/);
});

test("the window guard is installed, on Windows, with the title-bar rule", () => {
  assert.match(fullscreenState, /installFullscreenDragGuard\(document\.documentElement\)/);
  assert.match(fullscreenState, /if \(!isWindowsDesktop\(\)\) return;/);
  assert.match(
    fullscreenState,
    /const action = titleBarMouseDown\(e, path as DragPathElement\[\], fullscreenBlocksWindowDrag\(\)\);\s*if \(action === "pass"\) return;\s*e\.preventDefault\(\);\s*e\.stopPropagation\(\);\s*if \(action === "exit-fullscreen"\) void exitWindowFullscreen\(\{ toNormal: true \}\);/,
  );
  assert.match(fullscreenState, /return isWindowsDesktop\(\) && windowFullscreen;/);
  // Bubble phase on <html>: after the page's handlers, before Tauri's document listener.
  assert.match(fullscreenState, /root\.addEventListener\("mousedown", onMouseDown\);/);
  assert.match(
    read("src/views/player/drag-click-stage.tsx"),
    /if \(fullscreenBlocksWindowDrag\(\)\) return;/,
  );
});

test("fullscreen exits from Esc, the player and the layout editor go through the controller", () => {
  const anyExit = fullscreenState.match(/export async function exitAnyFullscreen[\s\S]*?\n}/)?.[0];
  assert.ok(anyExit);
  assert.match(anyExit, /invoke\("window_fullscreen_exit"/);
  assert.match(
    read("src/views/settings/player-layout-panel/editor-overlay.tsx"),
    /await toggleWindowFullscreen\(\);/,
  );
});

// --- double-click: only the title bar changes the window state ---------------

const TB = "data-window-titlebar";
const SPACE = "data-window-titlebar-space";
const press = (detail: number) => ({ button: 0, detail });

test("in a normal or maximized window, only a title-bar double-click maximizes or restores", () => {
  const titleBar = [el("DIV", { [DRAG]: "" }), el("HEADER", { [TB]: "" }), el("BODY")];
  const content = [el("DIV", { [DRAG]: "" }), el("MAIN"), el("BODY")];
  const sidebarLogoStrip = [el("DIV", { [DRAG]: "" }), el("ASIDE"), el("BODY")];
  // Title bar: Tauri drags on the first press and maximizes on the second.
  assert.equal(titleBarMouseDown(press(1), titleBar, false), "pass");
  assert.equal(titleBarMouseDown(press(2), titleBar, false), "pass");
  // Content and sidebars: still drag the window, never resize it.
  for (const path of [content, sidebarLogoStrip]) {
    assert.equal(titleBarMouseDown(press(1), path, false), "pass", "single press still drags");
    assert.equal(titleBarMouseDown(press(2), path, false), "block", "double-click does nothing");
  }
  // Not a drag region at all (cards, buttons, text): never touched.
  const button = [el("BUTTON"), el("HEADER", { [TB]: "" })];
  const card = [el("IMG"), el("BUTTON"), el("DIV", { [DRAG]: "" })];
  for (const path of [button, card, [el("SPAN"), el("DIV", { [DRAG]: "" })]]) {
    assert.equal(titleBarMouseDown(press(2), path, false), "pass");
    assert.equal(titleBarMouseDown(press(2), path, true), "pass");
  }
  // Right button and triple clicks are Tauri's no-ops anyway.
  assert.equal(titleBarMouseDown({ button: 2, detail: 2 }, content, false), "pass");
  assert.equal(titleBarMouseDown(press(3), content, false), "pass");
});

test("in true fullscreen nothing drags; a title-bar double-click leaves to a normal window", () => {
  const titleBar = [el("DIV", { [DRAG]: "" }), el("HEADER", { [TB]: "" })];
  // The default top bar has no drag region in fullscreen, only the marker.
  const defaultBarSpace = [el("DIV", { [SPACE]: "" }), el("HEADER", { [TB]: "" })];
  const content = [el("DIV", { [DRAG]: "" }), el("MAIN")];
  assert.equal(titleBarMouseDown(press(1), titleBar, true), "block", "no window drag");
  assert.equal(titleBarMouseDown(press(2), titleBar, true), "exit-fullscreen");
  assert.equal(
    titleBarMouseDown(press(1), defaultBarSpace, true),
    "pass",
    "single click as before",
  );
  assert.equal(titleBarMouseDown(press(2), defaultBarSpace, true), "exit-fullscreen");
  assert.equal(titleBarMouseDown(press(1), content, true), "block");
  assert.equal(
    titleBarMouseDown(press(2), content, true),
    "block",
    "content never leaves fullscreen",
  );
  // The marker counts only on the element clicked, like a plain drag region.
  const insideSpace = [el("SPAN"), el("DIV", { [SPACE]: "" }), el("HEADER", { [TB]: "" })];
  assert.equal(titleBarMouseDown(press(2), insideSpace, true), "pass");
  // Outside the title bar the marker means nothing.
  assert.equal(titleBarMouseDown(press(2), [el("DIV", { [SPACE]: "" })], true), "pass");
});

test("every layout's top bar is marked as the title bar, and nothing else is", () => {
  for (const f of [
    "src/chrome/topbar.tsx",
    "src/chrome/royal-topbar.tsx",
    "src/chrome/topdock.tsx",
    "src/chrome/cinematic-overlay.tsx",
    "src/chrome/minui-dock/floating-top.tsx",
  ]) {
    assert.equal((read(f).match(/data-window-titlebar\b(?!-)/g) ?? []).length, 1, f);
  }
  // Content pages, sidebars and the player keep their drag regions unmarked.
  for (const f of [
    "src/views/home.tsx",
    "src/views/library.tsx",
    "src/views/game-library.tsx",
    "src/views/game-discovery.tsx",
    "src/views/discover.tsx",
    "src/views/detail.tsx",
    "src/chrome/sidebar.tsx",
    "src/components/player/transport.tsx",
    "src/views/pip.tsx",
  ]) {
    assert.doesNotMatch(read(f), /data-window-titlebar/, f);
  }
  // The default bar: a drag region when windowed, the empty-space marker in fullscreen.
  assert.match(
    read("src/chrome/topbar.tsx"),
    /const dragProps = !IS_TAURI\s*\? \{\}\s*: fullscreen\s*\? \{ "data-window-titlebar-space": true \}\s*: \{ "data-tauri-drag-region": true \};/,
  );
});

test("the player's own double-click is a React handler, untouched by the window guard", () => {
  const stage = read("src/views/player/drag-click-stage.tsx");
  assert.match(stage, /onDoubleClick=\{\(e\) => \{/);
  assert.doesNotMatch(stage, /data-tauri-drag-region/);
});
