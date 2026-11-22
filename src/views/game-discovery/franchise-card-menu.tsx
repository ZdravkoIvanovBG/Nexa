import { Layers, ListOrdered, Play, Plus } from "lucide-react";
import { emitListToast } from "@/components/lists/list-toast";
import type { FranchiseDef } from "@/lib/game-discovery/franchises";
import { providerFeatures } from "@/lib/game-discovery/provider";
import { resolveFranchiseData, useFranchiseGamesLoader } from "@/lib/game-discovery/queries";
import type { GameRef } from "@/lib/game-discovery/types";
import type { GamesGate } from "@/lib/game-discovery/use-games-gate";
import { activeGameProfile, useGameLibrary } from "@/lib/game-library/store";
import { useT } from "@/lib/i18n";
import { useView } from "@/lib/view";
import { isKeyboardContextMenu, useActionMenu, type MenuItem } from "../game-library/action-menu";
import { startRecord } from "../game-library/play-actions";
import { franchiseMenuActions } from "./game-menu";
import {
  franchiseCollectionStateOf,
  savableRef,
  saveCollectionToWishlist,
  useCanSave,
  useOpenWishlist,
} from "./save-controls";

// A franchise card's right-click menu: Nexa's own menu in place of the
// browser's. Every action is one the franchise page or the Wishlist already
// offers, run through the same functions: saving goes through
// saveCollectionToWishlist with the franchise page's own data (its cached
// query, or that query fetched once), and starting goes through startRecord,
// as the Wishlist's collection row does.

const ICON = { size: 14, strokeWidth: 2 } as const;

export function useFranchiseCardMenu(
  franchise: FranchiseDef,
  gate: GamesGate,
  image: string | null,
): { onContextMenu: (event: React.MouseEvent<HTMLElement>) => void; element: React.ReactNode } {
  const t = useT();
  const { data } = useGameLibrary();
  const { openGameFranchise } = useView();
  const canSave = useCanSave();
  const openWishlist = useOpenWishlist();
  const load = useFranchiseGamesLoader(gate);
  const menu = useActionMenu();

  const add = async () => {
    if (!load) return;
    // The collection goes to the profile the user chose it from, or nowhere.
    const profileId = activeGameProfile() ?? "";
    const view = { label: t("View in Wishlist"), run: openWishlist };
    try {
      // The franchise page saves its main series in release order; so does this.
      const games = resolveFranchiseData(await load(franchise), "release").groups.main;
      const refs = games.map(savableRef);
      if (games.length === 0 || refs.some((r) => r === null)) throw new Error("not savable");
      saveCollectionToWishlist(franchise, refs as GameRef[], image ?? games[0].image, t, view, {
        profileId,
      });
    } catch {
      emitListToast(
        t("Couldn't add the {name} collection. Try again from its page.", {
          name: franchise.name,
        }),
        { label: t("Open"), run: () => openGameFranchise(franchise.id) },
      );
    }
  };

  // Built when the menu opens, from the library as it is at that moment.
  const build = (): MenuItem[] => {
    const state = franchiseCollectionStateOf(data, franchise.id);
    const next = state.nextUp;
    const actions = franchiseMenuActions({
      canSave,
      saved: state.saved,
      canAdd: load !== null && providerFeatures(gate.provider).librarySaves,
      hasNext: next !== null,
    });
    return actions.map((action, i): MenuItem => {
      switch (action) {
        case "separator":
          return { id: `sep-${i}`, separator: true };
        case "open":
          return {
            id: action,
            label: t("Open collection"),
            icon: <Layers {...ICON} />,
            run: () => openGameFranchise(franchise.id),
          };
        case "add-wishlist":
          return {
            id: action,
            label: t("Add to Wishlist"),
            icon: <Plus {...ICON} />,
            run: () => void add(),
          };
        case "view-wishlist":
          return {
            id: action,
            label: t("View in Wishlist"),
            icon: <ListOrdered {...ICON} />,
            run: openWishlist,
          };
        case "start-next":
          return {
            id: action,
            label: t("Start {name}", { name: next?.name ?? "" }),
            icon: <Play {...ICON} />,
            run: () => {
              if (next) startRecord(next.gameId, next.name, t);
            },
          };
      }
    });
  };

  const onContextMenu = (event: React.MouseEvent<HTMLElement>) => {
    // Never the browser's menu, and not the app-wide menu behind the card.
    event.preventDefault();
    event.stopPropagation();
    const trigger = event.currentTarget;
    // The Menu key and Shift+F10 open it below the card; focus returns to the
    // card when it closes.
    if (isKeyboardContextMenu(event)) menu.openFromButton(trigger, build());
    else menu.openAt(event.clientX, event.clientY, trigger, build());
  };

  return { onContextMenu, element: menu.element };
}
