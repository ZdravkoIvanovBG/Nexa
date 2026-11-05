import { Sparkles } from "lucide-react";
import { franchiseById } from "@/lib/game-discovery/franchises";
import { snapshotSummary } from "@/lib/game-library/snapshot";
import { catalogAdditions, markCatalogSeen, type CollectionMember } from "@/lib/game-library/rules";
import { changeGameLibrary } from "@/lib/game-library/store";
import type { QueueEntry } from "@/lib/game-library/types";
import { useT } from "@/lib/i18n";
import { useView } from "@/lib/view";
import { useActionMenu } from "./action-menu";
import { announceMove, memberMenu } from "./entry-menus";
import { GameArt, type GameArtShape } from "./game-art";
import { usePointerSort } from "./use-pointer-sort";
import { moveTo } from "./wishlist-actions";
import { Dot, MoreButton, ReorderButtons, SortHandle, StatusChip, yearOf } from "./wishlist-parts";

/** Catalog games added to a franchise since this collection was saved. Needs no RAWG. */
export function newCatalogGames(entry: QueueEntry): string[] {
  const def = entry.franchiseId ? franchiseById(entry.franchiseId) : null;
  return def ? catalogAdditions(entry, def.mainline) : [];
}

export function dismissNewGames(entry: QueueEntry): void {
  const slugs = newCatalogGames(entry);
  if (slugs.length === 0) return;
  changeGameLibrary((data, ctx) => markCatalogSeen(data, entry.entryId, slugs, ctx));
}

/**
 * A collection's games in the user's own order. A list of its own, so dragging
 * here moves games within the collection and never the collection.
 */
export function CollectionMembers({
  collection,
  members,
  shape,
  onNavigate,
}: {
  collection: QueueEntry;
  members: CollectionMember[];
  shape: GameArtShape;
  /** Runs before leaving the page, for the sheet to close itself. */
  onNavigate?: () => void;
}) {
  const t = useT();
  const { openGame, openGameFranchise } = useView();
  const menu = useActionMenu();
  const { container: sortContainer, startDrag } = usePointerSort({
    onMove: (id, index) => {
      if (!moveTo(id, index)) return;
      const member = members.find((m) => m.entry.entryId === id);
      if (member) announceMove(t, id, member.record.name, index, members.length);
    },
  });
  const additions = newCatalogGames(collection);
  const count = members.length;

  return (
    <div className="flex flex-col gap-2">
      {additions.length > 0 && collection.franchiseId && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-accent/[0.08] px-3.5 py-2.5 text-[12.5px] text-ink ring-1 ring-accent/20">
          <Sparkles size={14} strokeWidth={2.2} className="shrink-0 text-accent" />
          <span className="min-w-0 flex-1">
            {additions.length === 1
              ? t("1 new game has been added to this franchise.")
              : t("{n} new games have been added to this franchise.", { n: additions.length })}
          </span>
          <button
            type="button"
            onClick={() => {
              onNavigate?.();
              openGameFranchise(collection.franchiseId!);
            }}
            className="h-7 rounded-full bg-accent/15 px-3 font-semibold text-accent transition-colors hover:bg-accent/25"
          >
            {t("Review")}
          </button>
          <button
            type="button"
            onClick={() => dismissNewGames(collection)}
            className="h-7 rounded-full px-3 font-medium text-ink-muted transition-colors hover:text-ink"
          >
            {t("Dismiss")}
          </button>
        </div>
      )}

      {count === 0 ? (
        <p className="rounded-xl bg-white/[0.025] px-4 py-3 text-[13px] text-ink-muted ring-1 ring-edge-soft">
          {t("Every game has been removed from this collection.")}
        </p>
      ) : (
        <ol
          ref={sortContainer}
          aria-label={t("Games in {name}", { name: collection.title })}
          className="flex flex-col gap-1.5"
        >
          {members.map((member, index) => {
            const { entry, record } = member;
            const year = yearOf(record);
            const openDetails = () => {
              onNavigate?.();
              openGame(snapshotSummary(record));
            };
            const items = () =>
              memberMenu(t, member, collection.title, { index, count }, openDetails);
            return (
              <li
                key={entry.entryId}
                data-sort-item
                onContextMenu={(e) => menu.openAtPointer(e, items())}
                className="group/row flex items-center gap-2.5 rounded-xl bg-white/[0.025] py-1.5 ps-1.5 pe-2 ring-1 ring-white/[0.04] transition-[background-color,box-shadow] duration-200 hover:bg-white/[0.05] data-[sort-dragging]:bg-elevated data-[sort-dragging]:shadow-[0_18px_40px_-16px_rgba(0,0,0,0.8)] data-[sort-dragging]:ring-white/10"
              >
                <SortHandle
                  entryId={entry.entryId}
                  name={record.name}
                  index={index}
                  count={count}
                  onPointerDown={(e) => startDrag(entry.entryId, e)}
                />
                <span className="w-6 shrink-0 text-center text-[13px] font-semibold tabular-nums text-ink-subtle">
                  {index + 1}
                </span>
                <button
                  type="button"
                  onClick={openDetails}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-start"
                >
                  <GameArt
                    image={record.image}
                    seed={record.gameId}
                    name={record.name}
                    shape={shape}
                    className={`${shape === "cover" ? "w-[40px]" : "w-[92px]"} shrink-0`}
                  />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-[14px] font-medium text-ink">{record.name}</span>
                    <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-ink-subtle">
                      {year && <span className="tabular-nums">{year}</span>}
                      {year && record.status && <Dot />}
                      {record.status && <StatusChip status={record.status} />}
                    </span>
                  </span>
                </button>
                <ReorderButtons
                  entryId={entry.entryId}
                  name={record.name}
                  index={index}
                  count={count}
                />
                <MoreButton
                  label={t("More options for {name}", { name: record.name })}
                  onOpen={(button) => menu.openFromButton(button, items())}
                />
              </li>
            );
          })}
        </ol>
      )}
      {menu.element}
    </div>
  );
}
