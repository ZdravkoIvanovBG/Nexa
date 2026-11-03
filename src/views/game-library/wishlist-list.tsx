import { ChevronDown } from "lucide-react";
import { franchiseById } from "@/lib/game-discovery/franchises";
import type { WishlistItem } from "@/lib/game-library/rules";
import { snapshotSummary } from "@/lib/game-library/snapshot";
import { useT } from "@/lib/i18n";
import { useView } from "@/lib/view";
import { useActionMenu } from "./action-menu";
import { CollectionMembers, newCatalogGames } from "./collection-members";
import { announceMove, collectionMenu, gameMenu } from "./entry-menus";
import { CollectionArt, GameArt } from "./game-art";
import { usePointerSort } from "./use-pointer-sort";
import { moveTo } from "./wishlist-actions";
import { Dot, MoreButton, ReorderButtons, SortHandle, yearOf } from "./wishlist-parts";

const ROW =
  "group/row flex items-center gap-3 rounded-2xl bg-surface/60 py-2.5 ps-2 pe-3 ring-1 ring-edge-soft transition-[background-color,box-shadow] duration-200 hover:bg-surface";
const DRAGGING =
  "[[data-sort-dragging]>&]:bg-elevated [[data-sort-dragging]>&]:shadow-[0_24px_50px_-18px_rgba(0,0,0,0.85)] [[data-sort-dragging]>&]:ring-white/10";

function Rank({ n }: { n: number }) {
  return (
    <span
      className={`w-9 shrink-0 text-center font-display text-[24px] font-medium leading-none tabular-nums ${
        n === 1 ? "text-ink" : "text-ink-subtle"
      }`}
    >
      {n}
    </span>
  );
}

export function WishlistList({
  items,
  expanded,
  onToggle,
}: {
  items: WishlistItem[];
  expanded: ReadonlySet<string>;
  onToggle: (entryId: string) => void;
}) {
  const t = useT();
  const { openGame, openGameFranchise } = useView();
  const menu = useActionMenu();
  const count = items.length;
  const { container: sortContainer, startDrag } = usePointerSort({
    onMove: (id, index) => {
      if (!moveTo(id, index)) return;
      const item = items.find((i) => i.entry.entryId === id);
      if (!item) return;
      const name = item.kind === "game" ? item.record.name : item.entry.title;
      announceMove(t, id, name, index, count);
    },
  });

  return (
    <>
      <ol ref={sortContainer} aria-label={t("Wishlist")} className="flex flex-col gap-2.5">
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
                data-sort-item
                onContextMenu={(e) => menu.openAtPointer(e, menuItems())}
              >
                <div className={`${ROW} ${DRAGGING}`}>
                  <SortHandle
                    entryId={entry.entryId}
                    name={record.name}
                    index={index}
                    count={count}
                    onPointerDown={(e) => startDrag(entry.entryId, e)}
                  />
                  <Rank n={item.rank} />
                  <button
                    type="button"
                    onClick={openDetails}
                    className="flex min-w-0 flex-1 items-center gap-4 rounded-xl text-start"
                  >
                    <GameArt
                      image={record.image}
                      seed={record.gameId}
                      name={record.name}
                      className="w-[124px] shrink-0 sm:w-[148px]"
                    />
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className="truncate text-[15.5px] font-semibold text-ink">
                        {record.name}
                      </span>
                      <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-ink-subtle">
                        {index === 0 && (
                          <span className="font-semibold uppercase tracking-[0.12em] text-accent">
                            {t("Up next")}
                          </span>
                        )}
                        {index === 0 && year && <Dot />}
                        {year && <span className="tabular-nums">{year}</span>}
                        {!year && index !== 0 && <span>{t("Release date unknown")}</span>}
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
                    onOpen={(button) => menu.openFromButton(button, menuItems())}
                  />
                </div>
              </li>
            );
          }

          const open = expanded.has(entry.entryId);
          const total = item.members.length;
          const additions = newCatalogGames(entry);
          const def = entry.franchiseId ? franchiseById(entry.franchiseId) : null;
          const art = entry.image ?? item.members[0]?.record.image ?? null;
          const panelId = `collection-${entry.entryId}`;
          const menuItems = () =>
            collectionMenu(t, entry, place, {
              expanded: open,
              onToggle: () => onToggle(entry.entryId),
              openFranchise: def ? () => openGameFranchise(def.id) : null,
              newGames: additions.length,
              onReview: def ? () => openGameFranchise(def.id) : null,
            });
          return (
            <li
              key={entry.entryId}
              data-sort-item
              onContextMenu={(e) => menu.openAtPointer(e, menuItems())}
            >
              <div className={`${ROW} ${DRAGGING} ${open ? "rounded-b-none" : ""}`}>
                <SortHandle
                  entryId={entry.entryId}
                  name={entry.title}
                  index={index}
                  count={count}
                  onPointerDown={(e) => startDrag(entry.entryId, e)}
                />
                <Rank n={item.rank} />
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={panelId}
                  onClick={() => onToggle(entry.entryId)}
                  className="flex min-w-0 flex-1 items-center gap-4 rounded-xl text-start"
                >
                  <CollectionArt
                    image={art}
                    seed={entry.entryId}
                    name={entry.title}
                    className="mt-1 w-[124px] shrink-0 sm:w-[148px]"
                  />
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-[15.5px] font-semibold text-ink">
                        {entry.title}
                      </span>
                      <ChevronDown
                        size={16}
                        strokeWidth={2.2}
                        className={`shrink-0 text-ink-subtle transition-transform duration-200 ${
                          open ? "rotate-180" : ""
                        }`}
                      />
                    </span>
                    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12.5px] text-ink-subtle">
                      {index === 0 && (
                        <>
                          <span className="font-semibold uppercase tracking-[0.12em] text-accent">
                            {t("Up next")}
                          </span>
                          <Dot />
                        </>
                      )}
                      <span>
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
                      {item.nextUp && (
                        <>
                          <Dot />
                          <span className="truncate">
                            {t("Next: {name}", { name: item.nextUp.name })}
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
                <ReorderButtons
                  entryId={entry.entryId}
                  name={entry.title}
                  index={index}
                  count={count}
                />
                <MoreButton
                  label={t("More options for {name}", { name: entry.title })}
                  onOpen={(button) => menu.openFromButton(button, menuItems())}
                />
              </div>
              {open && (
                <div
                  id={panelId}
                  className="animate-fade-in rounded-b-2xl bg-surface/35 px-3 pb-3 pt-2.5 ring-1 ring-edge-soft sm:ps-14"
                >
                  <CollectionMembers collection={entry} members={item.members} />
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {menu.element}
    </>
  );
}
