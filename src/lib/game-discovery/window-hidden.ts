import { invoke } from "@tauri-apps/api/core";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Whether the desktop window is minimised or hidden to the tray right now
 * (IGDB Stage 7).
 *
 * WebView2 keeps the page "visible" when its window is minimised, so
 * `document.hidden` alone never pauses anything. Measured in the release
 * build: the Games hero kept rotating and loading art while minimised. The
 * hero asks this once before each slide change: one local call every 11 s,
 * no network, and no event state that could leave it paused on screen.
 * Outside the desktop app, or if the call fails, the answer is "not hidden",
 * so rotation behaves as before.
 */
export async function windowHidden(): Promise<boolean> {
  if (!isTauri) return false;
  try {
    return (await invoke<boolean>("harbor_window_hidden")) === true;
  } catch {
    return false;
  }
}
