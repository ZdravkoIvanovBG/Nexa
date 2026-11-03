import {
  ArrowUpToLine,
  ChevronDown,
  ChevronUp,
  Info,
  Layers,
  ListStart,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { CollectionMember } from "@/lib/game-library/rules";
import type { GameRecord, QueueEntry } from "@/lib/game-library/types";
import type { MenuItem } from "./action-menu";
import { announce, focusHandle, removeWithUndo, shift, toNext, toTop } from "./wishlist-actions";

type Translate = (key: string, vars?: Record<string, string | number>) => string;

const ICON = { size: 14, strokeWidth: 2 } as const;

export type Place = { index: number; count: number };

/** Moves a row and says where it went, for screen readers and keyboard users. */
export function announceMove(
  t: Translate,
  entryId: string,
  name: string,
  index: number,
  count: number,
  refocus = false,
): void {
  announce(t("{name} moved to position {n} of {total}", { name, n: index + 1, total: count }));
  if (refocus) focusHandle(entryId);
}

function moveItems(
  t: Translate,
  entry: QueueEntry,
  name: string,
  { index, count }: Place,
  scope: "queue" | "collection",
): MenuItem[] {
  const say = (to: number) => announceMove(t, entry.entryId, name, to, count);
  const items: MenuItem[] = [
    {
      id: "top",
      label: scope === "queue" ? t("Move to top") : t("Move to top of collection"),
      icon: <ArrowUpToLine {...ICON} />,
      disabled: index === 0,
      run: () => toTop(entry.entryId) && say(0),
    },
  ];
  if (scope === "queue") {
    items.push({
      id: "next",
      label: t("Play next"),
      icon: <ListStart {...ICON} />,
      disabled: index <= 1,
      run: () => toNext(entry.entryId) && say(1),
    });
  }
  items.push(
    {
      id: "up",
      label: t("Move up"),
      icon: <ChevronUp {...ICON} />,
      disabled: index === 0,
      run: () => shift(entry.entryId, -1) && say(index - 1),
    },
    {
      id: "down",
      label: t("Move down"),
      icon: <ChevronDown {...ICON} />,
      disabled: index >= count - 1,
      run: () => shift(entry.entryId, 1) && say(index + 1),
    },
  );
  return items;
}

export function gameMenu(
  t: Translate,
  entry: QueueEntry,
  record: GameRecord,
  place: Place,
  openDetails: () => void,
): MenuItem[] {
  return [
    { id: "details", label: t("Open details"), icon: <Info {...ICON} />, run: openDetails },
    { id: "sep-1", separator: true },
    ...moveItems(t, entry, record.name, place, "queue"),
    { id: "sep-2", separator: true },
    {
      id: "remove",
      label: t("Remove from Wishlist"),
      icon: <Trash2 {...ICON} />,
      danger: true,
      run: () =>
        removeWithUndo(
          entry.entryId,
          t("Removed {name} from your Wishlist", { name: record.name }),
          t,
        ),
    },
  ];
}

export function collectionMenu(
  t: Translate,
  entry: QueueEntry,
  place: Place,
  options: {
    expanded?: boolean;
    onToggle?: () => void;
    /** Replaces Expand and Collapse, for the Gallery, where a collection opens a sheet. */
    toggleLabel?: string;
    openFranchise: (() => void) | null;
    newGames: number;
    onReview: (() => void) | null;
  },
): MenuItem[] {
  const items: MenuItem[] = [];
  if (options.onToggle) {
    items.push({
      id: "toggle",
      label:
        options.toggleLabel ??
        (options.expanded ? t("Collapse collection") : t("Expand collection")),
      icon: options.expanded ? <ChevronUp {...ICON} /> : <ChevronDown {...ICON} />,
      run: options.onToggle,
    });
  }
  if (options.openFranchise) {
    items.push({
      id: "franchise",
      label: t("Open franchise page"),
      icon: <Layers {...ICON} />,
      run: options.openFranchise,
    });
  }
  if (options.newGames > 0 && options.onReview) {
    items.push({
      id: "review",
      label: t("Review new games ({n})", { n: options.newGames }),
      icon: <Sparkles {...ICON} />,
      run: options.onReview,
    });
  }
  if (items.length > 0) items.push({ id: "sep-1", separator: true });
  items.push(...moveItems(t, entry, entry.title, place, "queue"));
  items.push(
    { id: "sep-2", separator: true },
    {
      id: "remove",
      label: t("Remove collection"),
      icon: <Trash2 {...ICON} />,
      danger: true,
      run: () =>
        removeWithUndo(
          entry.entryId,
          t("Removed the {name} collection from your Wishlist", { name: entry.title }),
          t,
        ),
    },
  );
  return items;
}

export function memberMenu(
  t: Translate,
  member: CollectionMember,
  collectionTitle: string,
  place: Place,
  openDetails: () => void,
): MenuItem[] {
  return [
    { id: "details", label: t("Open details"), icon: <Info {...ICON} />, run: openDetails },
    { id: "sep-1", separator: true },
    ...moveItems(t, member.entry, member.record.name, place, "collection"),
    { id: "sep-2", separator: true },
    {
      id: "remove",
      label: t("Remove from collection"),
      icon: <Trash2 {...ICON} />,
      danger: true,
      run: () =>
        removeWithUndo(
          member.entry.entryId,
          t("Removed {name} from {collection}", {
            name: member.record.name,
            collection: collectionTitle,
          }),
          t,
        ),
    },
  ];
}
