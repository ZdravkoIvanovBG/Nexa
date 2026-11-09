import { Layers, Trash2, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { franchiseById } from "@/lib/game-discovery/franchises";
import type { WishlistItem } from "@/lib/game-library/rules";
import { snapshotSummary } from "@/lib/game-library/snapshot";
import { useT } from "@/lib/i18n";
import { useView } from "@/lib/view";
import { useActionMenu } from "./action-menu";
import { CollectionMembers, newCatalogGames } from "./collection-members";
import { collectionMenu, gameMenu } from "./entry-menus";
import { CollectionArt, collectionImage, GameArt, type GameArtShape } from "./game-art";
import { removeWithUndo } from "./wishlist-actions";
import { Dot, MoreButton, yearOf } from "./wishlist-parts";

// The same entries as the List, drawn as cards. Reordering here goes through
// each card's menu: dragging stays in the List, where an order reads naturally.

const GRID: Record<GameArtShape, string> = {
  landscape: "grid grid-cols-1 gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4",
  cover:
    "grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 2xl:grid-cols-7",
};

function RankBadge({ n }: { n: number }) {
  return (
    <span className="absolute start-2.5 top-2.5 flex h-8 min-w-8 items-center justify-center rounded-full bg-black/65 px-2 font-display text-[16px] font-medium tabular-nums text-white shadow-[0_4px_14px_-4px_rgba(0,0,0,0.7)] ring-1 ring-white/15 backdrop-blur-md">
      {n}
    </span>
  );
}

const LIFT =
  "transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0.24,1)] will-change-transform group-hover/card:[transform:translate3d(0,-0.4rem,0)] group-focus-within/card:[transform:translate3d(0,-0.4rem,0)]";

export function WishlistGallery({
  items,
  sheetId,
  onOpenSheet,
  shape,
}: {
  items: WishlistItem[];
  sheetId: string | null;
  onOpenSheet: (entryId: string | null) => void;
  shape: GameArtShape;
}) {
  const t = useT();
  const { openGame, openGameFranchise } = useView();
  const menu = useActionMenu();
  const count = items.length;
  const sheet = items.find(
    (item): item is Extract<WishlistItem, { kind: "collection" }> =>
      item.kind === "collection" && item.entry.entryId === sheetId,
  );

  return (
    <>
      <ol aria-label={t("Wishlist")} className={GRID[shape]}>
        {items.map((item, index) => {
          const place = { index, count };
          const { entry } = item;
          if (item.kind === "game") {
            const { record } = item;
            const year = yearOf(record);
            const openDetails = () => openGame(snapshotSummary(record));
            const menuItems = () => gameMenu(t, entry, record, place, openDetails);
            return (
              <li
                key={entry.entryId}
                onContextMenu={(e) => menu.openAtPointer(e, menuItems())}
                className="group/card relative flex min-w-0 flex-col gap-2.5"
              >
                <button
                  type="button"
                  onClick={openDetails}
                  className="flex min-w-0 flex-col gap-2.5 pt-2 text-start"
                >
                  <div className={`relative w-full ${LIFT}`}>
                    <GameArt
                      image={record.image}
                      seed={record.gameId}
                      name={record.name}
                      width={640}
                      shape={shape}
                      showName
                      posterClassName="harbor-card-ring shadow-[0_2px_8px_-2px_rgba(0,0,0,0.4)] transition-[box-shadow] duration-300 group-hover/card:shadow-[0_24px_48px_-14px_rgba(0,0,0,0.65)]"
                    />
                    <RankBadge n={item.rank} />
                  </div>
                  <span className="flex min-w-0 flex-col gap-1 px-0.5">
                    <span className="line-clamp-1 text-[13.5px] font-medium text-ink">
                      {record.name}
                    </span>
                    <span className="flex items-center gap-1.5 text-[12px] text-ink-subtle">
                      {index === 0 && (
                        <span className="font-semibold uppercase tracking-[0.12em] text-accent">
                          {t("Up next")}
                        </span>
                      )}
                      {index === 0 && year && <Dot />}
                      {year && <span className="tabular-nums">{year}</span>}
                    </span>
                  </span>
                </button>
                <CardMenuButton
                  label={t("More options for {name}", { name: record.name })}
                  onOpen={(button) => menu.openFromButton(button, menuItems())}
                />
              </li>
            );
          }

          const total = item.members.length;
          const def = entry.franchiseId ? franchiseById(entry.franchiseId) : null;
          const additions = newCatalogGames(entry);
          const art = collectionImage(entry, item.members, shape);
          const menuItems = () =>
            collectionMenu(t, entry, place, {
              onToggle: () => onOpenSheet(entry.entryId),
              toggleLabel: t("Open collection"),
              openFranchise: def ? () => openGameFranchise(def.id) : null,
              newGames: additions.length,
              onReview: def ? () => openGameFranchise(def.id) : null,
              nextUp: item.nextUp,
            });
          return (
            <li
              key={entry.entryId}
              onContextMenu={(e) => menu.openAtPointer(e, menuItems())}
              className="group/card relative flex min-w-0 flex-col gap-2.5"
            >
              <button
                type="button"
                aria-haspopup="dialog"
                onClick={() => onOpenSheet(entry.entryId)}
                className="flex min-w-0 flex-col gap-2.5 pt-2 text-start"
              >
                <div className={`relative w-full ${LIFT}`}>
                  <CollectionArt
                    image={art}
                    seed={entry.entryId}
                    name={entry.title}
                    width={640}
                    shape={shape}
                    showName
                  />
                  <RankBadge n={item.rank} />
                </div>
                <span className="flex min-w-0 flex-col gap-1 px-0.5">
                  <span className="line-clamp-1 text-[13.5px] font-medium text-ink">
                    {entry.title}
                  </span>
                  <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-ink-subtle">
                    <span className="flex items-center gap-1 font-medium text-ink-muted">
                      <Layers size={12} strokeWidth={2.4} />
                      {total === 1
                        ? t("Collection · 1 game")
                        : t("Collection · {n} games", { n: total })}
                    </span>
                    {item.completed > 0 && (
                      <>
                        <Dot />
                        <span className="tabular-nums">
                          {t("{done} of {total} completed", { done: item.completed, total })}
                        </span>
                      </>
                    )}
                    {additions.length > 0 && (
                      <>
                        <Dot />
                        <span className="font-medium text-accent">
                          {t("{n} new", { n: additions.length })}
                        </span>
                      </>
                    )}
                  </span>
                </span>
              </button>
              <CardMenuButton
                label={t("More options for {name}", { name: entry.title })}
                onOpen={(button) => menu.openFromButton(button, menuItems())}
              />
            </li>
          );
        })}
      </ol>
      {menu.element}
      {sheet && <CollectionSheet item={sheet} shape={shape} onClose={() => onOpenSheet(null)} />}
    </>
  );
}

/** Every card leaves room above its art for a collection's fanned edges, so rows line up. */
function CardMenuButton({
  label,
  onOpen,
}: {
  label: string;
  onOpen: (button: HTMLElement) => void;
}) {
  return (
    <span className="absolute end-2.5 top-[18px] opacity-0 transition-opacity duration-200 group-hover/card:opacity-100 group-focus-within/card:opacity-100">
      <MoreButton
        label={label}
        onOpen={onOpen}
        className="bg-black/60 text-white/90 ring-1 ring-white/15 backdrop-blur-md hover:bg-black/75 hover:text-white"
      />
    </span>
  );
}

/** A collection opened from the Gallery: its games, in their own order, reorderable. */
function CollectionSheet({
  item,
  shape,
  onClose,
}: {
  item: Extract<WishlistItem, { kind: "collection" }>;
  shape: GameArtShape;
  onClose: () => void;
}) {
  const t = useT();
  const { openGameFranchise } = useView();
  const { entry, members } = item;
  const def = entry.franchiseId ? franchiseById(entry.franchiseId) : null;
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnTo = useRef<Element | null>(null);

  useEffect(() => {
    returnTo.current = document.activeElement;
    closeRef.current?.focus();
    return () => {
      if (returnTo.current instanceof HTMLElement && returnTo.current.isConnected) {
        returnTo.current.focus({ preventScroll: true });
      }
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const total = members.length;
  return createPortal(
    <div
      className="animate-fade-in fixed inset-0 z-[230] flex items-center justify-center bg-canvas/80 p-4"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="collection-sheet-title"
        onClick={(e) => e.stopPropagation()}
        className="animate-modal-in flex max-h-[min(86vh,820px)] w-[min(94vw,640px)] flex-col overflow-hidden rounded-2xl border border-edge-soft bg-elevated shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)]"
      >
        <header className="flex items-start gap-4 border-b border-edge-soft p-5">
          <CollectionArt
            image={collectionImage(entry, members, shape)}
            seed={entry.entryId}
            name={entry.title}
            shape={shape}
            className={`mt-1.5 ${shape === "cover" ? "w-[78px]" : "w-[120px]"} shrink-0`}
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-ink-subtle">
              {t("Collection")}
            </p>
            <h2
              id="collection-sheet-title"
              className="truncate font-display text-[24px] font-medium leading-tight text-ink"
            >
              {entry.title}
            </h2>
            <p className="text-[12.5px] text-ink-muted">
              {total === 1 ? t("1 game") : t("{n} games", { n: total })}
              {item.completed > 0 &&
                ` · ${t("{done} of {total} completed", { done: item.completed, total })}`}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            aria-label={t("Close")}
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-white/[0.07] hover:text-ink"
          >
            <X size={18} strokeWidth={2.2} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <CollectionMembers
            collection={entry}
            members={members}
            shape={shape}
            onNavigate={onClose}
          />
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-edge-soft px-5 py-3.5">
          <button
            type="button"
            onClick={() => {
              onClose();
              removeWithUndo(
                entry.entryId,
                t("Removed the {name} collection from your Wishlist", { name: entry.title }),
                t,
              );
            }}
            className="flex h-9 items-center gap-2 rounded-full px-3.5 text-[13px] font-medium text-danger transition-colors hover:bg-danger/10"
          >
            <Trash2 size={14} strokeWidth={2.2} />
            {t("Remove collection")}
          </button>
          {def && (
            <button
              type="button"
              onClick={() => {
                onClose();
                openGameFranchise(def.id);
              }}
              className="flex h-9 items-center gap-2 rounded-full border border-edge px-4 text-[13px] font-medium text-ink transition-colors hover:bg-raised"
            >
              <Layers size={14} strokeWidth={2.2} />
              {t("Open franchise page")}
            </button>
          )}
        </footer>
      </section>
    </div>,
    document.body,
  );
}
