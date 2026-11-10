import {
  Ban,
  ChevronDown,
  CircleCheckBig,
  History,
  Info,
  Layers,
  ListOrdered,
  NotebookPen,
  Pause,
  Percent,
  Play,
  RotateCcw,
  Trash2,
  Trophy,
} from "lucide-react";
import { useMemo } from "react";
import { TIERS } from "@/lib/tracking-tiers";
import {
  boardTier,
  isPlaced,
  notesPreview,
  placementsOf,
  playDates,
} from "@/lib/game-library/rules";
import { snapshotSummary } from "@/lib/game-library/snapshot";
import type { NoteDraft } from "@/lib/game-library/note-drafts";
import type { GameLibraryData, GameRecord } from "@/lib/game-library/types";
import { useT, useUiLanguage } from "@/lib/i18n";
import { useView } from "@/lib/view";
import type { MenuItem } from "./action-menu";
import { GameArt, type GameArtShape } from "./game-art";
import { NotesEditor } from "./notes-editor";
import {
  completeGame,
  dropGame,
  pauseGame,
  removeFromPlaying,
  replayGame,
  resumeGame,
  sendBackToWishlist,
  setTracking,
} from "./play-actions";
import { ProgressControl } from "./progress-control";
import { addToTierList, rankGame, showInTiers } from "./tier-actions";
import { Dot, MoreButton, StatusChip, yearOf } from "./wishlist-parts";

type Translate = (key: string, vars?: Record<string, string | number>) => string;

const ICON = { size: 14, strokeWidth: 2 } as const;

const PILL =
  "flex h-9 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold transition-colors";
const PRIMARY = `${PILL} border border-accent/55 bg-accent/15 text-accent hover:bg-accent/22`;
const SECONDARY = `${PILL} border border-edge text-ink-muted hover:border-ink-subtle hover:text-ink`;

/** Art sized like the Watching cards: 16:9 at 168 px, or a 3:4 cover at 88 px. */
const ART: Record<GameArtShape, string> = {
  landscape: "w-[132px] sm:w-[168px]",
  cover: "w-[72px] sm:w-[88px]",
};

export function formatDay(at: number, language: string): string {
  return new Date(at).toLocaleDateString(language, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** The ⋯ and right-click menu. Every status a game can move to from where it is. */
export function playingMenu(
  t: Translate,
  record: GameRecord,
  placed: boolean,
  options: { openDetails: () => void; openNotes: () => void; onBoard: boolean },
): MenuItem[] {
  const { gameId, name, status } = record;
  const items: MenuItem[] = [
    { id: "details", label: t("Open details"), icon: <Info {...ICON} />, run: options.openDetails },
    {
      id: "notes",
      label: t("Edit notes"),
      icon: <NotebookPen {...ICON} />,
      run: options.openNotes,
    },
    {
      id: "progress",
      label: record.progressEnabled ? t("Stop tracking progress") : t("Track progress"),
      icon: <Percent {...ICON} />,
      run: () => setTracking(gameId, !record.progressEnabled),
    },
    { id: "sep-1", separator: true },
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
    { id: "sep-2", separator: true },
    options.onBoard
      ? {
          id: "tiers",
          label: t("View in Tier List"),
          icon: <Trophy {...ICON} />,
          run: () => showInTiers(gameId),
        }
      : {
          id: "tiers",
          label: t("Add to Tier List"),
          icon: <Trophy {...ICON} />,
          run: () => addToTierList(gameId, name, t, () => showInTiers(gameId)),
        },
    {
      id: "wishlist",
      label: t("Back to Wishlist"),
      icon: <ListOrdered {...ICON} />,
      run: () => sendBackToWishlist(gameId, name, t),
    },
  );
  // On a list, leaving Currently Playing is Back to Wishlist; only a game on no
  // list needs its own way out, and its record stays for a later re-add.
  if (!placed) {
    items.push({
      id: "remove",
      label: t("Remove from Playing"),
      icon: <Trash2 {...ICON} />,
      danger: true,
      run: () => removeFromPlaying(gameId, name, t),
    });
  }
  return items;
}

export function PlayingCard({
  data,
  record,
  profileId,
  shape,
  expanded,
  focusNotes,
  highlighted,
  draft,
  onToggle,
  onOpenNotes,
  onMenu,
}: {
  data: GameLibraryData;
  record: GameRecord;
  profileId: string;
  shape: GameArtShape;
  expanded: boolean;
  /** Puts the caret in the notes when the card opens for them. */
  focusNotes: boolean;
  highlighted: boolean;
  /** A note version kept on this device, waiting for the user's decision. */
  draft: NoteDraft | null;
  onToggle: () => void;
  onOpenNotes: () => void;
  onMenu: (target: HTMLElement | React.MouseEvent, items: MenuItem[]) => void;
}) {
  const t = useT();
  const language = useUiLanguage();
  const { openGame } = useView();
  const { gameId, name, status } = record;
  const placed = isPlaced(data, gameId);
  const collections = useMemo(() => placementsOf(data, gameId).collections, [data, gameId]);
  const dates = playDates(record);
  const year = yearOf(record);
  const preview = notesPreview(record.notes);
  const ranked =
    record.tier && (TIERS as readonly string[]).includes(record.tier) ? record.tier : null;
  const openDetails = () => openGame(snapshotSummary(record));
  const onBoard = boardTier(record) !== null;
  // A completed card says it on its Rank button instead.
  const rankBadge = ranked && status !== "completed" ? ranked : null;
  const items = () =>
    playingMenu(t, record, placed, { openDetails, openNotes: onOpenNotes, onBoard });
  const panelId = `playing-${gameId}`;

  const dateLine =
    status === "completed" && dates.completed
      ? t("Completed {date}", { date: formatDay(dates.completed, language) })
      : dates.started
        ? t("Started {date}", { date: formatDay(dates.started, language) })
        : null;

  return (
    <article
      data-playing-card={gameId}
      aria-label={name}
      onContextMenu={(e) => onMenu(e, items())}
      className={`flex flex-col gap-4 rounded-2xl border bg-surface p-4 transition-[background-color,border-color,box-shadow] duration-300 hover:bg-elevated ${
        highlighted
          ? "border-accent/60 shadow-[0_0_0_3px_rgba(255,255,255,0.04)]"
          : "border-edge-soft"
      }`}
    >
      <div className="flex gap-4">
        <button
          type="button"
          onClick={openDetails}
          aria-label={t("Open details for {name}", { name })}
          className={`${ART[shape]} shrink-0 self-start overflow-hidden rounded-xl transition-[transform,opacity] duration-200 hover:scale-[1.03] ${
            status === "paused" || status === "dropped" ? "opacity-70" : ""
          }`}
        >
          <GameArt image={record.image} seed={gameId} name={name} shape={shape} />
        </button>

        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
          <div className="flex min-w-0 flex-col gap-1">
            <button type="button" onClick={openDetails} className="min-w-0 text-start">
              <h3 className="truncate font-display text-[17px] font-medium text-ink transition-colors hover:text-accent">
                {name}
              </h3>
            </button>
            <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] text-ink-muted">
              {status && <StatusChip status={status} />}
              {year && <Dot />}
              {year && <span className="tabular-nums">{year}</span>}
              {dateLine && <Dot />}
              {dateLine && <span>{dateLine}</span>}
            </p>
            {(collections.length > 0 || rankBadge) && (
              <p className="flex min-w-0 flex-wrap items-center gap-1.5 text-[11.5px] text-ink-subtle">
                {collections.slice(0, 2).map((c) => (
                  <span
                    key={c.entryId}
                    className="inline-flex max-w-full items-center gap-1 truncate rounded-full bg-white/[0.05] px-2 py-0.5"
                  >
                    <Layers size={11} strokeWidth={2.2} className="shrink-0" />
                    <span className="truncate">{t("In {name}", { name: c.title })}</span>
                  </span>
                ))}
                {rankBadge && (
                  <span className="rounded-full bg-white/[0.05] px-2 py-0.5 font-semibold">
                    {t("Ranked {tier}", { tier: rankBadge })}
                  </span>
                )}
              </p>
            )}
          </div>

          {record.progressEnabled && (
            <div className="flex items-center gap-2.5">
              <span
                role="progressbar"
                aria-label={t("Progress")}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={record.progress ?? 0}
                className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/[0.07]"
              >
                <span
                  className="block h-full rounded-full bg-accent transition-[width] duration-300"
                  style={{ width: `${record.progress ?? 0}%` }}
                />
              </span>
              <span className="w-9 shrink-0 text-end text-[12px] font-semibold tabular-nums text-ink-muted">
                {record.progress ?? 0}%
              </span>
            </div>
          )}

          {!expanded && (preview || draft) && (
            <p className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-ink-muted">
              {draft && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-400/10 px-2 py-0.5 text-[11px] font-semibold text-amber-200">
                  <History size={11} strokeWidth={2.4} />
                  {t("Note to review")}
                </span>
              )}
              {preview && <span className="truncate">{preview}</span>}
            </p>
          )}

          <div className="mt-auto flex flex-wrap items-center gap-2 pt-0.5">
            {status === "playing" && (
              <>
                <button
                  type="button"
                  onClick={() => pauseGame(gameId, name, t)}
                  className={SECONDARY}
                >
                  <Pause size={14} strokeWidth={2.4} />
                  {t("Pause")}
                </button>
                <button
                  type="button"
                  onClick={() => completeGame(gameId, name, t)}
                  className={PRIMARY}
                >
                  <CircleCheckBig size={14} strokeWidth={2.4} />
                  {t("Mark completed")}
                </button>
              </>
            )}
            {status === "paused" && (
              <>
                <button
                  type="button"
                  onClick={() => resumeGame(gameId, name, t)}
                  className={PRIMARY}
                >
                  <Play size={14} strokeWidth={2.4} />
                  {t("Resume")}
                </button>
                <button
                  type="button"
                  onClick={() => completeGame(gameId, name, t)}
                  className={SECONDARY}
                >
                  <CircleCheckBig size={14} strokeWidth={2.4} />
                  {t("Mark completed")}
                </button>
              </>
            )}
            {status === "completed" && (
              <>
                <button
                  type="button"
                  onClick={() => rankGame(data, gameId, name, t)}
                  className={ranked ? SECONDARY : PRIMARY}
                >
                  <Trophy size={14} strokeWidth={2.4} />
                  {ranked ? t("Ranked {tier}", { tier: ranked }) : t("Rank it")}
                </button>
                <button
                  type="button"
                  onClick={() => replayGame(gameId, name, t)}
                  className={SECONDARY}
                >
                  <RotateCcw size={14} strokeWidth={2.4} />
                  {t("Play again")}
                </button>
              </>
            )}
            {status === "dropped" && (
              <button type="button" onClick={() => resumeGame(gameId, name, t)} className={PRIMARY}>
                <Play size={14} strokeWidth={2.4} />
                {t("Resume")}
              </button>
            )}
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={panelId}
              onClick={onToggle}
              className={SECONDARY}
            >
              <NotebookPen size={14} strokeWidth={2.2} />
              {t("Notes & progress")}
              <ChevronDown
                size={14}
                strokeWidth={2.4}
                className={`transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
              />
            </button>
            <MoreButton
              label={t("More options for {name}", { name })}
              onOpen={(button) => onMenu(button, items())}
              className="ms-auto"
            />
          </div>
        </div>
      </div>

      {expanded && (
        <div
          id={panelId}
          className="grid gap-5 border-t border-edge-soft pt-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]"
        >
          <NotesEditor profileId={profileId} record={record} autoFocus={focusNotes} />
          <div className="flex flex-col gap-4">
            <ProgressControl record={record} />
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12.5px]">
              {dates.started && (
                <>
                  <dt className="text-ink-subtle">{t("Started")}</dt>
                  <dd className="text-ink-muted">{formatDay(dates.started, language)}</dd>
                </>
              )}
              {dates.completed && (
                <>
                  <dt className="text-ink-subtle">{t("Completed")}</dt>
                  <dd className="text-ink-muted">{formatDay(dates.completed, language)}</dd>
                </>
              )}
              {dates.lastCompleted && (
                <>
                  <dt className="text-ink-subtle">{t("Last completed")}</dt>
                  <dd className="text-ink-muted">{formatDay(dates.lastCompleted, language)}</dd>
                </>
              )}
            </dl>
          </div>
        </div>
      )}
    </article>
  );
}
