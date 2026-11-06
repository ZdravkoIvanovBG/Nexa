import { useEffect, useState } from "react";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * True while the desktop window is minimised (IGDB Stage 7).
 *
 * WebView2 keeps the page "visible" when its window is minimised, so
 * `document.hidden` alone never pauses anything. Measured in the release
 * build: the Games hero kept rotating and loading art while minimised, at
 * about 8.6% of one core. The Rust shell already reports
 * `harbor://window-activity` on every focus change (the player uses it), so
 * this listens to that and needs no extra permission. A minimise that happens
 * while the window is already unfocused isn't reported; the hero then simply
 * behaves as before.
 */
export function useWindowMinimized(): boolean {
  const [minimized, setMinimized] = useState(false);
  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<{ focused: boolean; minimized: boolean }>("harbor://window-activity", (e) => {
          setMinimized(!e.payload.focused && e.payload.minimized);
        }),
      )
      .then((u) => {
        if (cancelled) u();
        else unlisten = u;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
  return minimized;
}
