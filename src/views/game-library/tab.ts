// Which Game Library tab is showing, remembered per device. Other pages can ask
// for a tab, for example "View in Wishlist" after saving a game.

export type GameLibraryTab = "wishlist" | "playing" | "tiers";

const TAB_KEY = "harbor.gamelibrary.tab";
const TAB_REQUEST = "harbor:game-library-tab";

export function readSavedTab(): GameLibraryTab {
  try {
    const saved = localStorage.getItem(TAB_KEY);
    if (saved === "wishlist" || saved === "playing" || saved === "tiers") return saved;
  } catch {}
  return "wishlist";
}

export function saveTab(tab: GameLibraryTab): void {
  try {
    localStorage.setItem(TAB_KEY, tab);
  } catch {}
}

/** Selects a tab now if the library is open, or the next time it opens. */
export function requestTab(tab: GameLibraryTab): void {
  saveTab(tab);
  window.dispatchEvent(new CustomEvent<GameLibraryTab>(TAB_REQUEST, { detail: tab }));
}

export function onTabRequest(listener: (tab: GameLibraryTab) => void): () => void {
  const handler = (e: Event) => listener((e as CustomEvent<GameLibraryTab>).detail);
  window.addEventListener(TAB_REQUEST, handler);
  return () => window.removeEventListener(TAB_REQUEST, handler);
}
