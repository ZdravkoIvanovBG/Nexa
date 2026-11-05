import { Check, FolderPlus, Layers, ListOrdered, Plus, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useMemo } from "react";
import { emitListToast } from "@/components/lists/list-toast";
import type { FranchiseDef } from "@/lib/game-discovery/franchises";
import type { GameSummary } from "@/lib/game-discovery/types";
import { toGameRef } from "@/lib/game-discovery/types";
import {
  addCatalogGames,
  addMember,
  catalogAdditions,
  gameStage,
  liveCollections,
  placementsOf,
  refreshSnapshot,
  saveCollection,
  saveGame,
  savedCollection,
} from "@/lib/game-library/rules";
import { changeGameLibrary, useGameLibrary } from "@/lib/game-library/store";
import { memberEntryId, rootEntryId } from "@/lib/game-library/types";
import { useProfiles } from "@/lib/profiles";
import { useT } from "@/lib/i18n";
import { useView } from "@/lib/view";
import { useActionMenu, type MenuItem } from "../game-library/action-menu";
import { requestTab } from "../game-library/tab";
import { removeWithUndo } from "../game-library/wishlist-actions";

// Saving from Discovery. Everything saved is what's already on screen, so these
// controls cost no RAWG request of their own.

const ICON = { size: 14, strokeWidth: 2 } as const;

const BUTTON =
  "flex h-12 items-center gap-2.5 rounded-full px-6 text-[14.5px] font-medium backdrop-blur-sm transition-colors duration-200";
const PRIMARY = `${BUTTON} bg-ink text-canvas hover:opacity-90`;
const SAVED = `${BUTTON} border border-accent/40 bg-accent/12 text-ink hover:bg-accent/20`;
const SECONDARY = `${BUTTON} border border-edge bg-canvas/50 text-ink hover:bg-canvas/70`;

/** Kid profiles can't open the library, so they get nothing to save into it. */
function useCanSave(): boolean {
  const { activeProfile } = useProfiles();
  const { ready } = useGameLibrary();
  return ready && !activeProfile?.kid;
}

function useOpenWishlist(): () => void {
  const { openLibrarySection } = useView();
  return () => {
    requestTab("wishlist");
    openLibrarySection("games");
  };
}

/** Keeps a saved game's name and art current while its page is open anyway. */
export function useRefreshSavedGame(game: GameSummary | null): void {
  const { data, ready } = useGameLibrary();
  const saved = game ? !!data.records[game.id] : false;
  useEffect(() => {
    if (!ready || !saved || !game) return;
    changeGameLibrary((d, ctx) => refreshSnapshot(d, toGameRef(game), ctx));
  }, [ready, saved, game]);
}

export function SaveGameButton({
  game,
  franchise,
}: {
  game: GameSummary;
  /** The curated franchise this game belongs to, if any. */
  franchise: FranchiseDef | null;
}) {
  const t = useT();
  const { data } = useGameLibrary();
  const canSave = useCanSave();
  const menu = useActionMenu();
  const openWishlist = useOpenWishlist();
  const gameId = game.id;
  const stage = gameStage(data, gameId);
  const placed = useMemo(() => placementsOf(data, gameId), [data, gameId]);
  if (!canSave) return null;

  const view = { label: t("View in Wishlist"), run: openWishlist };
  const addToCollection = (collectionId: string, title: string) => {
    changeGameLibrary((d, ctx) => addMember(d, collectionId, toGameRef(game), ctx));
    emitListToast(t("Added {name} to {collection}", { name: game.name, collection: title }), view);
  };
  const collectionItems: MenuItem[] = liveCollections(data)
    .filter((c) => !placed.collections.some((p) => p.entryId === c.entryId))
    .sort((a, b) =>
      a.franchiseId === franchise?.id ? -1 : b.franchiseId === franchise?.id ? 1 : 0,
    )
    .slice(0, 6)
    .map((c) => ({
      id: `add-${c.entryId}`,
      label: t("Add to {name}", { name: c.title }),
      icon: <FolderPlus {...ICON} />,
      run: () => addToCollection(c.entryId, c.title),
    }));

  if (stage === "none") {
    const save = () => {
      changeGameLibrary((d, ctx) => saveGame(d, toGameRef(game), ctx));
      emitListToast(t("Added {name} to your Wishlist", { name: game.name }), view);
    };
    const ownCollection = franchise ? savedCollection(data, franchise.id) : null;
    return (
      <>
        <button type="button" onClick={save} className={PRIMARY}>
          <Plus size={17} strokeWidth={2.4} />
          {t("Add to Wishlist")}
        </button>
        {ownCollection && (
          <button
            type="button"
            onClick={() => addToCollection(ownCollection.entryId, ownCollection.title)}
            className={SECONDARY}
          >
            <FolderPlus size={16} strokeWidth={2} />
            {t("Add to {name}", { name: ownCollection.title })}
          </button>
        )}
      </>
    );
  }

  if (stage !== "wishlist" && stage !== "collection") {
    // Started from Currently Playing, which arrives in a later stage.
    return (
      <span className={`${BUTTON} border border-edge bg-canvas/50 text-ink-muted`}>
        <Check size={16} strokeWidth={2.4} />
        {t("In your Game Library")}
      </span>
    );
  }

  const inCollection = placed.collections[0] ?? null;
  const label =
    stage === "wishlist"
      ? t("In Wishlist")
      : t("In {name}", { name: inCollection?.title ?? t("a collection") });
  const items: MenuItem[] = [
    {
      id: "view",
      label: t("View in Wishlist"),
      icon: <ListOrdered {...ICON} />,
      run: openWishlist,
    },
  ];
  if (stage === "collection") {
    items.push({
      id: "standalone",
      label: t("Also add on its own"),
      icon: <Plus {...ICON} />,
      run: () => {
        changeGameLibrary((d, ctx) => saveGame(d, toGameRef(game), ctx));
        emitListToast(t("Added {name} to your Wishlist", { name: game.name }), view);
      },
    });
  }
  if (collectionItems.length > 0) {
    items.push({ id: "sep-collections", separator: true }, ...collectionItems);
  }
  if (stage === "wishlist") {
    items.push(
      { id: "sep-remove", separator: true },
      {
        id: "remove",
        label: t("Remove from Wishlist"),
        icon: <Trash2 {...ICON} />,
        danger: true,
        run: () =>
          removeWithUndo(
            rootEntryId(gameId),
            t("Removed {name} from your Wishlist", { name: game.name }),
            t,
          ),
      },
    );
  } else if (inCollection) {
    items.push(
      { id: "sep-remove", separator: true },
      {
        id: "remove-member",
        label: t("Remove from {name}", { name: inCollection.title }),
        icon: <Trash2 {...ICON} />,
        danger: true,
        run: () =>
          removeWithUndo(
            memberEntryId(inCollection.entryId, gameId),
            t("Removed {name} from {collection}", {
              name: game.name,
              collection: inCollection.title,
            }),
            t,
          ),
      },
    );
  }

  return (
    <>
      <button
        type="button"
        aria-haspopup="menu"
        onClick={(e) => menu.openFromButton(e.currentTarget, items)}
        className={SAVED}
      >
        <Check size={17} strokeWidth={2.4} className="text-accent" />
        {label}
      </button>
      {menu.element}
    </>
  );
}

export function SaveCollectionButton({
  def,
  games,
  slugOf,
  image,
}: {
  def: FranchiseDef;
  /** The franchise's main series as resolved, in release order. */
  games: GameSummary[] | null;
  /** The catalog slug for a game, which survives RAWG slug redirects. */
  slugOf: (game: GameSummary) => string;
  image: string | null;
}) {
  const t = useT();
  const { data } = useGameLibrary();
  const canSave = useCanSave();
  const menu = useActionMenu();
  const openWishlist = useOpenWishlist();
  if (!canSave || !games || games.length === 0) return null;

  const saved = savedCollection(data, def.id);
  const view = { label: t("View in Wishlist"), run: openWishlist };

  if (!saved) {
    const save = () => {
      changeGameLibrary((d, ctx) =>
        saveCollection(
          d,
          { franchiseId: def.id, title: def.name, image: image ?? games[0].image },
          games.map(toGameRef),
          def.mainline,
          ctx,
        ),
      );
      emitListToast(t("Added the {name} collection to your Wishlist", { name: def.name }), view);
    };
    return (
      <button type="button" onClick={save} className={PRIMARY}>
        <Plus size={17} strokeWidth={2.4} />
        {t("Add Collection to Wishlist")}
      </button>
    );
  }

  const offered = new Set(catalogAdditions(saved, def.mainline));
  const newGames = games.filter((g) => offered.has(slugOf(g)));
  const items: MenuItem[] = [
    {
      id: "view",
      label: t("View in Wishlist"),
      icon: <ListOrdered {...ICON} />,
      run: openWishlist,
    },
  ];
  if (newGames.length > 0) {
    items.push({
      id: "add-new",
      label:
        newGames.length === 1
          ? t("Add 1 new game")
          : t("Add {n} new games", { n: newGames.length }),
      icon: <Sparkles {...ICON} />,
      run: () => {
        changeGameLibrary((d, ctx) =>
          addCatalogGames(d, saved.entryId, newGames.map(toGameRef), newGames.map(slugOf), ctx),
        );
        emitListToast(
          newGames.length === 1
            ? t("Added 1 game to {name}", { name: saved.title })
            : t("Added {n} games to {name}", { n: newGames.length, name: saved.title }),
          view,
        );
      },
    });
  }
  items.push(
    { id: "sep", separator: true },
    {
      id: "remove",
      label: t("Remove collection"),
      icon: <Trash2 {...ICON} />,
      danger: true,
      run: () =>
        removeWithUndo(
          saved.entryId,
          t("Removed the {name} collection from your Wishlist", { name: saved.title }),
          t,
        ),
    },
  );

  return (
    <>
      <button
        type="button"
        aria-haspopup="menu"
        onClick={(e) => menu.openFromButton(e.currentTarget, items)}
        className={SAVED}
      >
        <Layers size={16} strokeWidth={2.2} className="text-accent" />
        {t("Collection in Wishlist")}
        {newGames.length > 0 && (
          <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[11px] font-semibold text-accent">
            {t("{n} new", { n: newGames.length })}
          </span>
        )}
      </button>
      {menu.element}
    </>
  );
}
