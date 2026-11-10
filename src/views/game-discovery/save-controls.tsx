import {
  Ban,
  Check,
  CircleCheckBig,
  CircleHelp,
  ExternalLink,
  FolderPlus,
  Gamepad2,
  Layers,
  ListOrdered,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  Trophy,
} from "lucide-react";
import { useEffect, useMemo } from "react";
import { emitListToast } from "@/components/lists/list-toast";
import type { FranchiseDef } from "@/lib/game-discovery/franchises";
import { providerOf, type GameProvider } from "@/lib/game-discovery/game-id";
import { providerFeatures } from "@/lib/game-discovery/provider";
import type { GameRef, GameSummary } from "@/lib/game-discovery/types";
import { toGameRef } from "@/lib/game-discovery/types";
import {
  libraryRef,
  libraryRefs,
  possibleMatches,
  savedEquivalent,
} from "@/lib/game-library/identity";
import {
  addCatalogGames,
  addMember,
  boardTier,
  catalogAdditions,
  gameStage,
  isPlaced,
  liveCollections,
  placementsOf,
  refreshSnapshot,
  saveCollection,
  saveGame,
  savedCollection,
} from "@/lib/game-library/rules";
import { snapshotSummary } from "@/lib/game-library/snapshot";
import { changeGameLibrary, useGameLibrary } from "@/lib/game-library/store";
import {
  memberEntryId,
  rootEntryId,
  type GameId,
  type GameRecord,
  type GameStatus,
} from "@/lib/game-library/types";
import { useProfiles } from "@/lib/profiles";
import { useT } from "@/lib/i18n";
import { useView } from "@/lib/view";
import { useActionMenu, type MenuItem } from "../game-library/action-menu";
import {
  completeGame,
  dropGame,
  pauseGame,
  removeFromPlaying,
  replayGame,
  resumeGame,
  sendBackToWishlist,
  startPlaying,
} from "../game-library/play-actions";
import { requestPlayingGame, requestTab, requestTierGame } from "../game-library/tab";
import { addToTierList } from "../game-library/tier-actions";
import { removeWithUndo } from "../game-library/wishlist-actions";

// Saving from Discovery. Everything saved is what's already on screen, so these
// controls cost no provider request of their own.
//
// Every game is saved under its own provider's id (rawg:N or igdb:N), from the
// ref `savableRef` builds, the one place a ref is made. Before it is written,
// each ref goes through libraryRef / libraryRefs, inside the change itself, so
// it is checked against the library as it is at that moment: when the curated
// catalog says the game is already saved under another provider's id, that
// record is used instead, and no second record for the same game is created.
// Nothing here rewrites, merges or deletes an existing record.

/** The ref to save for a game, or null when its provider can't save to the library. */
export function savableRef(game: GameSummary): GameRef | null {
  return providerFeatures(providerOf(game.id)).librarySaves ? toGameRef(game) : null;
}

const PROVIDER_NAME: Record<GameProvider, string> = { rawg: "RAWG", igdb: "IGDB" };

const ICON = { size: 14, strokeWidth: 2 } as const;

const BUTTON =
  "flex h-12 items-center gap-2.5 rounded-full px-6 text-[14.5px] font-medium backdrop-blur-sm transition-colors duration-200";
const PRIMARY = `${BUTTON} bg-ink text-canvas hover:opacity-90`;
const SAVED = `${BUTTON} border border-accent/40 bg-accent/12 text-ink hover:bg-accent/20`;
const SECONDARY = `${BUTTON} border border-edge bg-canvas/50 text-ink hover:bg-canvas/70`;
const NOTE = "flex items-center gap-1.5 text-[12.5px] text-ink-muted";

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

function useOpenTiers(): (gameId: GameId) => void {
  const { openLibrarySection } = useView();
  return (gameId) => {
    requestTierGame(gameId);
    requestTab("tiers");
    openLibrarySection("games");
  };
}

function useOpenPlaying(): (gameId: GameId) => void {
  const { openLibrarySection } = useView();
  return (gameId) => {
    requestPlayingGame(gameId);
    requestTab("playing");
    openLibrarySection("games");
  };
}

const STATUS_LABEL: Record<GameStatus, string> = {
  playing: "Playing",
  paused: "Paused",
  completed: "Completed",
  dropped: "Dropped",
};

const STATUS_ICON = {
  playing: Gamepad2,
  paused: Pause,
  completed: CircleCheckBig,
  dropped: Ban,
} as const;

/** Where a started game can go from the status it has. Mirrors the Currently Playing menu. */
function statusItems(
  t: (key: string, vars?: Record<string, string | number>) => string,
  gameId: GameId,
  name: string,
  status: GameStatus,
  placed: boolean,
  openPlaying: () => void,
  board: { onBoard: boolean; open: () => void },
): MenuItem[] {
  const items: MenuItem[] = [
    {
      id: "view-playing",
      label: t("View in Currently Playing"),
      icon: <Gamepad2 {...ICON} />,
      run: openPlaying,
    },
    { id: "sep-status", separator: true },
  ];
  if (status === "playing") {
    items.push({
      id: "pause",
      label: t("Pause"),
      icon: <Pause {...ICON} />,
      run: () => pauseGame(gameId, name, t),
    });
  }
  if (status === "paused" || status === "dropped") {
    items.push({
      id: "resume",
      label: t("Resume"),
      icon: <Play {...ICON} />,
      run: () => resumeGame(gameId, name, t),
    });
  }
  if (status === "completed") {
    items.push({
      id: "again",
      label: t("Play again"),
      icon: <RotateCcw {...ICON} />,
      run: () => replayGame(gameId, name, t),
    });
  } else {
    items.push({
      id: "complete",
      label: t("Mark completed"),
      icon: <CircleCheckBig {...ICON} />,
      run: () => completeGame(gameId, name, t),
    });
  }
  if (status === "playing" || status === "paused") {
    items.push({
      id: "drop",
      label: t("Drop"),
      icon: <Ban {...ICON} />,
      run: () => dropGame(gameId, name, t),
    });
  }
  items.push(
    { id: "sep-wishlist", separator: true },
    board.onBoard
      ? {
          id: "tiers",
          label: t("View in Tier List"),
          icon: <Trophy {...ICON} />,
          run: board.open,
        }
      : {
          id: "tiers",
          label: t("Add to Tier List"),
          icon: <Trophy {...ICON} />,
          run: () => addToTierList(gameId, name, t, board.open),
        },
    {
      id: "wishlist",
      label: t("Back to Wishlist"),
      icon: <ListOrdered {...ICON} />,
      run: () => sendBackToWishlist(gameId, name, t),
    },
  );
  if (!placed) {
    items.push({
      id: "remove-playing",
      label: t("Remove from Playing"),
      icon: <Trash2 {...ICON} />,
      danger: true,
      run: () => removeFromPlaying(gameId, name, t),
    });
  }
  return items;
}

/**
 * Keeps a saved game's name and art current while its page is open anyway.
 * Only the record saved under this exact id: a record from another provider
 * keeps its own snapshot, whatever the catalog says it is.
 */
export function useRefreshSavedGame(game: GameSummary | null): void {
  const { data, ready } = useGameLibrary();
  const saved = game ? !!data.records[game.id] : false;
  useEffect(() => {
    if (!ready || !saved || !game) return;
    const ref = savableRef(game);
    if (!ref) return;
    changeGameLibrary((d, ctx) => refreshSnapshot(d, ref, ctx));
  }, [ready, saved, game]);
}

function yearOf(record: Pick<GameRecord, "released">): string {
  return record.released ? record.released.slice(0, 4) : "";
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
  const { openGame } = useView();
  const canSave = useCanSave();
  const menu = useActionMenu();
  const openWishlist = useOpenWishlist();
  const openPlaying = useOpenPlaying();
  const openTiers = useOpenTiers();
  const own = useMemo(() => savableRef(game), [game]);
  // The same game already saved from another provider, by the curated catalog.
  const equivalent = own ? savedEquivalent(data, { gameId: game.id, slug: own.slug }) : null;
  const gameId = equivalent?.gameId ?? game.id;
  const name = equivalent?.name ?? game.name;
  const stage = gameStage(data, gameId);
  const placed = useMemo(() => placementsOf(data, gameId), [data, gameId]);
  if (!canSave || !own) return null;

  const view = { label: t("View in Wishlist"), run: openWishlist };
  // Through libraryRef inside the change, like a save: a game already saved
  // from the other provider is started on that record, never a second one.
  const start = () =>
    startPlaying(own, name, t, {
      label: t("View in Currently Playing"),
      run: () => openPlaying(gameId),
    });
  const savedFrom = equivalent && (
    <span
      className={NOTE}
      title={t("The same game, saved earlier from {provider}.", {
        provider: PROVIDER_NAME[equivalent.provider],
      })}
    >
      {t("Saved from {provider}", { provider: PROVIDER_NAME[equivalent.provider] })}
    </span>
  );
  const save = () => {
    changeGameLibrary((d, ctx) => saveGame(d, libraryRef(d, own), ctx));
    emitListToast(t("Added {name} to your Wishlist", { name }), view);
  };
  const addToCollection = (collectionId: string, title: string) => {
    changeGameLibrary((d, ctx) => addMember(d, collectionId, libraryRef(d, own), ctx));
    emitListToast(t("Added {name} to {collection}", { name, collection: title }), view);
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
    const ownCollection = franchise ? savedCollection(data, franchise.id) : null;
    // Same title and year from another provider, outside the catalog: maybe the
    // same game, maybe not, so the user decides. Nothing is linked either way.
    const maybe = possibleMatches(data, {
      gameId: game.id,
      slug: own.slug,
      name: game.name,
      released: game.released,
    });
    const match = maybe[0] ?? null;
    const onAdd = (button: HTMLElement) => {
      if (!match) return save();
      menu.openFromButton(button, [
        {
          id: "save-anyway",
          label: t("Add this version anyway"),
          icon: <Plus {...ICON} />,
          run: save,
        },
        {
          id: "open-match",
          label: t("Open the saved {provider} game", {
            provider: PROVIDER_NAME[match.provider],
          }),
          icon: <ExternalLink {...ICON} />,
          run: () => openGame(snapshotSummary(match)),
        },
      ]);
    };
    return (
      <>
        <button
          type="button"
          aria-haspopup={match ? "menu" : undefined}
          onClick={(e) => onAdd(e.currentTarget)}
          className={PRIMARY}
        >
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
        {!match && (
          <button type="button" onClick={start} className={SECONDARY}>
            <Play size={16} strokeWidth={2.2} />
            {t("Start playing")}
          </button>
        )}
        {match && (
          <span className={NOTE}>
            <CircleHelp size={14} strokeWidth={2.2} />
            {t("You may already have {name} ({year}) from {provider}.", {
              name: match.name,
              year: yearOf(match),
              provider: PROVIDER_NAME[match.provider],
            })}
          </span>
        )}
        {menu.element}
      </>
    );
  }

  if (stage !== "wishlist" && stage !== "collection") {
    const status: GameStatus = stage;
    const Icon = STATUS_ICON[status];
    const dropped = status === "dropped";
    const record = data.records[gameId];
    const items = statusItems(
      t,
      gameId,
      name,
      status,
      isPlaced(data, gameId),
      () => openPlaying(gameId),
      { onBoard: !!record && boardTier(record) !== null, open: () => openTiers(gameId) },
    );
    return (
      <>
        <button
          type="button"
          aria-haspopup="menu"
          onClick={(e) => menu.openFromButton(e.currentTarget, items)}
          className={dropped ? SECONDARY : SAVED}
        >
          <Icon size={17} strokeWidth={2.4} className={dropped ? "" : "text-accent"} />
          {t(STATUS_LABEL[status])}
        </button>
        {savedFrom}
        {menu.element}
      </>
    );
  }

  const inCollection = placed.collections[0] ?? null;
  const label =
    stage === "wishlist"
      ? t("In Wishlist")
      : t("In {name}", { name: inCollection?.title ?? t("a collection") });
  const items: MenuItem[] = [
    {
      id: "start",
      label: t("Start playing"),
      icon: <Play {...ICON} />,
      run: start,
    },
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
      run: save,
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
          removeWithUndo(rootEntryId(gameId), t("Removed {name} from your Wishlist", { name }), t),
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
              name,
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
      {savedFrom}
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
  /** The catalog slug for a game, which survives provider slug differences. */
  slugOf: (game: GameSummary) => string;
  image: string | null;
}) {
  const t = useT();
  const { data } = useGameLibrary();
  const canSave = useCanSave();
  const menu = useActionMenu();
  const openWishlist = useOpenWishlist();
  if (!canSave || !games || games.length === 0) return null;
  // Every member must be savable; a franchise page never mixes providers.
  const refs = games.map(savableRef);
  if (refs.some((r) => r === null)) return null;
  const memberRefs = refs as GameRef[];

  // One collection per franchise, whichever provider saved it: a collection
  // saved from RAWG is this franchise's collection on an IGDB page too. Its
  // members are never replaced; new catalog games are offered, by catalog slug.
  const saved = savedCollection(data, def.id);
  const view = { label: t("View in Wishlist"), run: openWishlist };

  if (!saved) {
    const save = () => {
      changeGameLibrary((d, ctx) =>
        saveCollection(
          d,
          { franchiseId: def.id, title: def.name, image: image ?? games[0].image },
          libraryRefs(d, memberRefs),
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
  const newRefs = newGames.map(savableRef).filter((r): r is GameRef => r !== null);
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
          addCatalogGames(d, saved.entryId, libraryRefs(d, newRefs), newGames.map(slugOf), ctx),
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
