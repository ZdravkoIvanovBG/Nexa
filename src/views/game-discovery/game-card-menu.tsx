import {
  CircleCheckBig,
  Gamepad2,
  Info,
  ListOrdered,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Trash2,
  Trophy,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef } from "react";
import type { GameSummary } from "@/lib/game-discovery/types";
import { useGameLibrary } from "@/lib/game-library/store";
import { rootEntryId } from "@/lib/game-library/types";
import { useT } from "@/lib/i18n";
import { useView } from "@/lib/view";
import { isKeyboardContextMenu, useActionMenu, type MenuItem } from "../game-library/action-menu";
import {
  markGamePlayed,
  pauseGame,
  replayGame,
  resumeGame,
  startPlaying,
} from "../game-library/play-actions";
import { addToTierList } from "../game-library/tier-actions";
import { removeWithUndo } from "../game-library/wishlist-actions";
import { gameMenuActions, type GameMenuAction } from "./game-menu";
import {
  libraryStateOf,
  savableRef,
  saveToWishlist,
  useCanSave,
  useOpenPlaying,
  useOpenTiers,
  useOpenWishlist,
} from "./save-controls";

// A game card's right-click menu: Nexa's own menu, in place of the browser's
// image menu. Cards are many and cheap, so they share one menu: a card hands
// its game to openGameCardMenu, and the one GameCardMenuHost (mounted by App
// while a Games page is open) reads the game's place in the library at that
// moment and opens the menu. Every action is one the game page offers too.

type Request = {
  game: GameSummary;
  x: number;
  y: number;
  trigger: HTMLElement;
  fromKeyboard: boolean;
};

let host: ((request: Request) => void) | null = null;

/**
 * For a card's onContextMenu. The Menu key and Shift+F10 raise the same event;
 * those open the menu below the card instead of at the pointer.
 */
export function openGameCardMenu(event: React.MouseEvent<HTMLElement>, game: GameSummary): void {
  // Never the browser's image menu, and not the app-wide menu behind the card.
  event.preventDefault();
  event.stopPropagation();
  const fromKeyboard = isKeyboardContextMenu(event);
  host?.({ game, x: event.clientX, y: event.clientY, trigger: event.currentTarget, fromKeyboard });
}

const ICON = { size: 14, strokeWidth: 2 } as const;

export function GameCardMenuHost() {
  const t = useT();
  const { data } = useGameLibrary();
  const { openGame } = useView();
  const canSave = useCanSave();
  const menu = useActionMenu();
  const openWishlist = useOpenWishlist();
  const openPlaying = useOpenPlaying();
  const openTiers = useOpenTiers();

  // The menu is built when it opens, from the state of that moment.
  const build = (game: GameSummary): MenuItem[] => {
    const own = savableRef(game);
    const state = own ? libraryStateOf(data, game, own) : null;
    const actions = gameMenuActions({
      canSave: canSave && own !== null,
      stage: state?.stage ?? "none",
      standalone: state?.standalone ?? false,
      maybeSame: state?.match != null,
      onBoard: state?.onBoard ?? false,
    });
    const gameId = state?.gameId ?? game.id;
    const name = state?.name ?? game.name;
    const view = { label: t("View in Wishlist"), run: openWishlist };
    const item = (id: GameMenuAction): MenuItem | null => {
      switch (id) {
        case "details":
          return {
            id,
            label: t("View details"),
            icon: <Info {...ICON} />,
            run: () => openGame(game),
          };
        case "add-wishlist":
          // A maybe-the-same game is decided on its page, where both are shown.
          return state?.match
            ? {
                id,
                label: t("Add to Wishlist…"),
                icon: <Plus {...ICON} />,
                run: () => openGame(game),
              }
            : {
                id,
                label: t("Add to Wishlist"),
                icon: <Plus {...ICON} />,
                run: () => own && saveToWishlist(own, name, t, view),
              };
        case "view-wishlist":
          return {
            id,
            label: t("View in Wishlist"),
            icon: <ListOrdered {...ICON} />,
            run: openWishlist,
          };
        case "remove-wishlist":
          return {
            id,
            label: t("Remove from Wishlist"),
            icon: <Trash2 {...ICON} />,
            danger: true,
            run: () =>
              removeWithUndo(
                rootEntryId(gameId),
                t("Removed {name} from your Wishlist", { name }),
                t,
              ),
          };
        case "start":
          return {
            id,
            label: t("Start Playing"),
            icon: <Play {...ICON} />,
            run: () =>
              own &&
              startPlaying(own, name, t, {
                label: t("View in Currently Playing"),
                run: () => openPlaying(gameId),
              }),
          };
        case "resume":
          return {
            id,
            label: t("Resume"),
            icon: <Play {...ICON} />,
            run: () => resumeGame(gameId, name, t),
          };
        case "pause":
          return {
            id,
            label: t("Pause"),
            icon: <Pause {...ICON} />,
            run: () => pauseGame(gameId, name, t),
          };
        case "played":
          return {
            id,
            label: t("Mark as Played"),
            icon: <CircleCheckBig {...ICON} />,
            run: () => own && markGamePlayed(own, name, t),
          };
        case "again":
          return {
            id,
            label: t("Play again"),
            icon: <RotateCcw {...ICON} />,
            run: () => replayGame(gameId, name, t),
          };
        case "view-playing":
          return {
            id,
            label: t("View in Currently Playing"),
            icon: <Gamepad2 {...ICON} />,
            run: () => openPlaying(gameId),
          };
        case "view-tiers":
          return {
            id,
            label: t("View in Tier List"),
            icon: <Trophy {...ICON} />,
            run: () => openTiers(gameId),
          };
        case "add-tiers":
          return {
            id,
            label: t("Add to Tier List"),
            icon: <Trophy {...ICON} />,
            run: () => addToTierList(gameId, name, t, () => openTiers(gameId)),
          };
      }
    };
    return actions.flatMap((a, i): MenuItem[] => {
      if (a === "separator") return [{ id: `sep-${i}`, separator: true }];
      const it = item(a);
      return it ? [it] : [];
    });
  };

  const latest = useRef(build);
  useLayoutEffect(() => {
    latest.current = build;
  });
  const { openAt, openFromButton } = menu;
  useEffect(() => {
    const handle = (r: Request) => {
      const items = latest.current(r.game);
      if (r.fromKeyboard) openFromButton(r.trigger, items);
      else openAt(r.x, r.y, r.trigger, items);
    };
    host = handle;
    return () => {
      if (host === handle) host = null;
    };
  }, [openAt, openFromButton]);

  return menu.element;
}
