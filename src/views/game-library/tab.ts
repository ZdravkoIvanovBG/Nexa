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

const PLAYING_REQUEST = "harbor:game-library-playing";
let pendingPlayingGame: string | null = null;

/**
 * Asks Currently Playing to show this game: its filter is selected and the card
 * scrolled into view, now if the tab is open or when it next opens.
 */
export function requestPlayingGame(gameId: string): void {
  pendingPlayingGame = gameId;
  window.dispatchEvent(new CustomEvent<string>(PLAYING_REQUEST, { detail: gameId }));
}

/** The request waiting for the tab to open, taken once. */
export function takePlayingRequest(): string | null {
  const gameId = pendingPlayingGame;
  pendingPlayingGame = null;
  return gameId;
}

export function onPlayingRequest(listener: (gameId: string) => void): () => void {
  const handler = (e: Event) => {
    pendingPlayingGame = null;
    listener((e as CustomEvent<string>).detail);
  };
  window.addEventListener(PLAYING_REQUEST, handler);
  return () => window.removeEventListener(PLAYING_REQUEST, handler);
}
