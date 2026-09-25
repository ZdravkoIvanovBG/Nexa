// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import { sidebarWidthClass } from "../src/lib/chrome-metrics.ts";
import { tiersFor } from "../src/lib/player/size-tiers.ts";

const tauriConf = JSON.parse(
  readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
) as { app: { windows: Array<Record<string, unknown>> } };
const pipRs = readFileSync(new URL("../src-tauri/src/pip.rs", import.meta.url), "utf8");
const libRs = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
const fullscreenRs = readFileSync(
  new URL("../src-tauri/src/fullscreen.rs", import.meta.url),
  "utf8",
);
const appTsx = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

const mainWindow = tauriConf.app.windows.find((w) => w.label === "main")!;

test("the main window stays resizable with a floor that fits a 1080p @150% desktop", () => {
  assert.equal(mainWindow.resizable, true);
  assert.equal(mainWindow.maximizable, true);
  // A 1920x1080 display at Windows' default 150% scaling is ~1280x680 logical
  // once the taskbar is removed, so the floor has to stay well inside that.
  assert.ok(
    (mainWindow.minWidth as number) <= 840,
    "minWidth must leave room to shrink on a high-DPI laptop",
  );
  assert.ok((mainWindow.minHeight as number) <= 600, "minHeight must fit a 680px logical desktop");
  assert.equal(mainWindow.minWidth, 800);
  assert.equal(mainWindow.minHeight, 560);
});

test("pip.rs restores the main window to the same floor the config declares", () => {
  // PiP shrinks the window to 360x240 and has to put it back; a hardcoded
  // number here silently drifts from tauri.conf.json.
  const w = pipRs.match(/const MAIN_MIN_W: f64 = ([\d.]+);/)?.[1];
  const h = pipRs.match(/const MAIN_MIN_H: f64 = ([\d.]+);/)?.[1];
  assert.ok(w && h, "pip.rs must declare MAIN_MIN_W / MAIN_MIN_H");
  assert.equal(Number(w), mainWindow.minWidth);
  assert.equal(Number(h), mainWindow.minHeight);
  assert.doesNotMatch(
    pipRs,
    /LogicalSize::new\(960\.0, 600\.0\)/,
    "pip.rs must not reintroduce a hardcoded 960x600 floor",
  );
});

test("player size tiers switch at the documented widths", () => {
  const wide = tiersFor(1920, 1080);
  assert.deepEqual([wide.mid, wide.compact, wide.tight, wide.short], [false, false, false, false]);

  assert.equal(tiersFor(1299, 800).mid, true);
  assert.equal(tiersFor(1300, 800).mid, false);
  assert.equal(tiersFor(999, 800).compact, true);
  assert.equal(tiersFor(1000, 800).compact, false);
  assert.equal(tiersFor(599, 800).tight, true);
  assert.equal(tiersFor(600, 800).tight, false);
  assert.equal(tiersFor(1920, 619).short, true);
  assert.equal(tiersFor(1920, 620).short, false);
});

test("at the minimum window size the player keeps its full-size controls", () => {
  // 800x560 must not fall into `tight`, or the transport loses its time
  // readouts and volume track at the smallest supported window.
  const floor = tiersFor(mainWindow.minWidth as number, mainWindow.minHeight as number);
  assert.equal(floor.tight, false);
  assert.equal(floor.compact, true);
  assert.equal(floor.short, true);
});

test("every sidebar layout publishes its own width, and expanded widths are lg-gated", () => {
  const layouts = ["sidebar", "nord", "dracula", "forest", "rail", "stremio"];
  for (const l of layouts) {
    assert.match(
      sidebarWidthClass(l, true),
      /\[--harbor-sidebar-w:\d+px\]/,
      `${l} must publish a collapsed width`,
    );
    assert.match(sidebarWidthClass(l, false), /\[--harbor-sidebar-w:\d+px\]/);
  }

  // The topbar used to hardcode 240px for all of these; they are genuinely different.
  assert.notEqual(sidebarWidthClass("nord", false), sidebarWidthClass("dracula", false));
  assert.notEqual(sidebarWidthClass("sidebar", false), sidebarWidthClass("nord", false));

  // Variants whose sidebar only expands at lg must carry the lg: variant.
  for (const l of ["sidebar", "nord", "dracula", "forest"]) {
    assert.match(sidebarWidthClass(l, false), /lg:\[--harbor-sidebar-w:\d+px\]/, l);
  }

  // Layouts without a sidebar must collapse the offset to zero.
  assert.match(sidebarWidthClass("topdock", false), /\[--harbor-sidebar-w:0px\]/);
  assert.match(sidebarWidthClass("minui", false), /\[--harbor-sidebar-w:0px\]/);
});

test("window-state never restores fullscreen, which would leave the borderless window unresizable", () => {
  // The main window is undecorated, so a launch restored into fullscreen has no OS
  // sizing border and the JS resize handles correctly hide themselves. Restoring the
  // flag made resizing work or not depending on how the previous session ended.
  // The flag list holds no parentheses, so the first `)` closes the call.
  const block = libRs.match(/\.with_state_flags\(([^)]*)\)/)?.[1];
  assert.ok(block, "lib.rs must configure tauri_plugin_window_state with explicit flags");
  assert.ok(!block.includes("StateFlags::FULLSCREEN"), "FULLSCREEN must not be restored");
  for (const kept of ["SIZE", "POSITION", "MAXIMIZED"]) {
    assert.ok(block.includes(`StateFlags::${kept}`), `${kept} must still be persisted`);
  }
});

test("auxiliary windows are excluded from window-state persistence", () => {
  const deny = libRs.match(/\.with_denylist\(&\[([\s\S]*?)\]\)/)?.[1];
  assert.ok(deny, "lib.rs must pass a denylist to tauri_plugin_window_state");
  for (const label of [
    "harbor-pip",
    "harbor-browser",
    "harbor-hdr-overlay",
    "harbor-modal-overlay",
  ]) {
    assert.ok(deny.includes(`"${label}"`), `${label} must be denylisted`);
  }
});

test("quitting leaves fullscreen first so the saved size and position are the windowed ones", () => {
  const traySource = readFileSync(new URL("../src-tauri/src/tray.rs", import.meta.url), "utf8");
  assert.match(libRs, /fn leave_fullscreen_before_exit/);
  assert.match(libRs, /leave_fullscreen_before_exit\(&main\)/, "window close path");
  assert.match(traySource, /leave_fullscreen_before_exit\(&w\)/, "tray quit path");
});

test("the app enters fullscreen once at launch, from setup, through the shared helper", () => {
  assert.match(fullscreenRs, /pub\(crate\) fn enter_fullscreen_now/);
  // The frontend command must reuse it so there is a single set_fullscreen(true) site.
  const command = fullscreenRs.match(/pub async fn window_fullscreen_enter[\s\S]*?Ok\(\(\)\)/)?.[0];
  assert.ok(command?.includes("enter_fullscreen_now"), "command must call the shared helper");
  assert.equal(fullscreenRs.match(/\.set_fullscreen\(true\)/g)?.length, 1);

  // After ensure_window_on_screen (so its monitor check still sees the windowed rect)
  // and after window-state's restore_state, which has already run before setup.
  const ensure = libRs.indexOf("ensure_window_on_screen(&app.handle());");
  const enter = libRs.indexOf("fullscreen::enter_fullscreen_now(");
  assert.ok(ensure !== -1 && enter !== -1, "lib.rs setup must call enter_fullscreen_now");
  assert.ok(enter > ensure, "launch fullscreen must come after ensure_window_on_screen");
});

test("launch fullscreen is not configured through tauri.conf.json", () => {
  // window-state's restore_state runs inside the window build, after the config flag is
  // applied, and would then set_size/set_position/maximize an already-fullscreen window.
  assert.ok(!("fullscreen" in mainWindow), "do not add a fullscreen key to the main window");
});

test("mounting the app does not exit the fullscreen it just launched into", () => {
  // The effect runs once on mount with playerActive already false. It must only fire
  // after a player has actually been active.
  assert.doesNotMatch(
    appTsx,
    /if \(!playerActive\) void exitWindowFullscreenOnPlayerClose\(\);/,
    "player-close exit must be guarded against first mount",
  );
  assert.match(appTsx, /hadPlayer/);
});
