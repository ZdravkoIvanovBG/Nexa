import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Which of the app's webview windows this script is running in.
 *
 * PiP, the modal overlay and the HDR overlay all load the same index.html with
 * a query param, so they share an origin -- and therefore a localStorage -- with
 * the main window. Anything that must have exactly one writer per origin (the
 * Supabase auth client, above all) has to branch on this *before* module side
 * effects run, not at render time.
 */

function hasWindowLabel(label: string): boolean {
  try {
    return getCurrentWindow().label === label;
  } catch {
    return false;
  }
}

function hasSearchFlag(param: string, value = "1"): boolean {
  try {
    return new URLSearchParams(window.location.search).get(param) === value;
  } catch {
    return false;
  }
}

export function detectRemoteMode(): boolean {
  try {
    const path = window.location.pathname.replace(/\/+$/, "") || "/";
    if (path === "/remote" || path.endsWith("/remote")) return true;
  } catch {}
  return hasSearchFlag("remote");
}

export function detectPipMode(): boolean {
  return hasSearchFlag("pip") || hasWindowLabel("harbor-pip");
}

export function detectModalOverlay(): boolean {
  return hasSearchFlag("harbor-modal") || hasWindowLabel("harbor-modal-overlay");
}

export function detectHdrOverlay(): boolean {
  return hasSearchFlag("harbor-overlay") || hasWindowLabel("harbor-hdr-overlay");
}

/**
 * True in the auxiliary webviews that share the main window's origin. These must
 * never run an auto-refreshing auth client: two clients rotating the same
 * refresh token race, and the loser persists a token the server already burned.
 *
 * The remote control app is deliberately excluded -- it is served to a separate
 * browser on another device, so it has its own storage and races nothing.
 */
export function isSecondaryWindow(): boolean {
  return detectPipMode() || detectModalOverlay() || detectHdrOverlay();
}
