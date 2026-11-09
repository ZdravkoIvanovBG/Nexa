import { useCallback, useEffect, useMemo, useState } from "react";
import { providerFeatures } from "@/lib/game-discovery/provider";
import { useActiveGameProvider } from "@/lib/game-discovery/use-active-provider";
import { playingView, wishlistNextUp } from "@/lib/game-library/rules";
import { useGameLibrary, useNoteSafety } from "@/lib/game-library/store";
import type { NoteDraft } from "@/lib/game-library/note-drafts";
import type { GameLibraryData, GameRecord, GameStatus } from "@/lib/game-library/types";
import { useProfiles } from "@/lib/profiles";
import { useT } from "@/lib/i18n";
import { useActionMenu, type MenuItem } from "./action-menu";
import { PlayingEmpty } from "./empty-states";
import { startRecord } from "./play-actions";
import { PlayingCard } from "./playing-card";
import { onPlayingRequest, requestTab, takePlayingRequest } from "./tab";
import { onAnnounce } from "./wishlist-actions";

type PlayingFilter = "active" | "completed" | "dropped";

// This device's own view of the tab, so it isn't synced.
const FILTER_KEY = "harbor.gamelibrary.playing.filter";

const HIGHLIGHT_MS = 2200;

function readFilter(): PlayingFilter {
  try {
    const saved = localStorage.getItem(FILTER_KEY);
    if (saved === "completed" || saved === "dropped") return saved;
  } catch {}
  return "active";
}

function filterOf(status: GameStatus | null): PlayingFilter | null {
  if (status === "playing" || status === "paused") return "active";
  if (status === "completed" || status === "dropped") return status;
  return null;
}

export function PlayingTab() {
  const t = useT();
  const { data, ready } = useGameLibrary();
  const { activeId } = useProfiles();
  const [message, setMessage] = useState("");
  useEffect(() => onAnnounce(setMessage), []);

  return (
    <section aria-label={t("Currently Playing")} className="flex flex-col gap-5">
      <p aria-live="polite" className="sr-only">
        {message}
      </p>
      {!ready || !activeId ? (
        <PlayingSkeleton />
      ) : (
        // Keyed by profile: nothing typed in one profile's card can carry over
        // into another's, and an unsaved note is flushed to the profile it
        // belongs to as the old cards unmount.
        <PlayingContent key={activeId} profileId={activeId} data={data} />
      )}
    </section>
  );
}

function PlayingContent({ profileId, data }: { profileId: string; data: GameLibraryData }) {
  const t = useT();
  const view = useMemo(() => playingView(data), [data]);
  const safety = useNoteSafety();
  const menu = useActionMenu();
  const shape = providerFeatures(useActiveGameProvider()).cards;
  // A "View in Currently Playing" made before the tab opened.
  const [requested] = useState(takePlayingRequest);
  const [filter, setFilter] = useState<PlayingFilter>(
    () => (requested && filterOf(data.records[requested]?.status ?? null)) || readFilter(),
  );
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [focusNotes, setFocusNotes] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(requested);

  useEffect(() => {
    try {
      localStorage.setItem(FILTER_KEY, filter);
    } catch {}
  }, [filter]);

  // "View in Currently Playing" while the tab is open: show the game's group.
  const reveal = useCallback(
    (gameId: string) => {
      const target = filterOf(data.records[gameId]?.status ?? null);
      if (!target) return;
      setFilter(target);
      setHighlight(gameId);
    },
    [data],
  );
  useEffect(() => onPlayingRequest(reveal), [reveal]);

  // Brings the requested card into view, then lets the highlight fade.
  useEffect(() => {
    if (!highlight) return;
    const scroll = window.setTimeout(() => {
      document
        .querySelector(`[data-playing-card="${CSS.escape(highlight)}"]`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 0);
    const fade = window.setTimeout(() => setHighlight(null), HIGHLIGHT_MS);
    return () => {
      window.clearTimeout(scroll);
      window.clearTimeout(fade);
    };
  }, [highlight]);

  const toggle = (gameId: string, notes = false) => {
    setFocusNotes(notes ? gameId : null);
    setExpanded((current) => {
      const next = new Set(current);
      if (notes || !next.has(gameId)) next.add(gameId);
      else next.delete(gameId);
      return next;
    });
  };

  const onMenu = (target: HTMLElement | React.MouseEvent, items: MenuItem[]) => {
    if (target instanceof HTMLElement) menu.openFromButton(target, items);
    else menu.openAtPointer(target, items);
  };

  const counts = {
    active: view.playing.length + view.paused.length,
    completed: view.completed.length,
    dropped: view.dropped.length,
  };
  const total = counts.active + counts.completed + counts.dropped;
  const nextUp = wishlistNextUp(data);
  const start = nextUp ? () => startRecord(nextUp.gameId, nextUp.name, t) : null;

  if (total === 0) {
    return (
      <PlayingEmpty
        nextUp={nextUp?.name ?? null}
        onStartNext={start}
        onOpenWishlist={() => requestTab("wishlist")}
      />
    );
  }

  const card = (record: GameRecord) => (
    <PlayingCard
      key={record.gameId}
      data={data}
      record={record}
      profileId={profileId}
      shape={shape}
      expanded={expanded.has(record.gameId)}
      focusNotes={focusNotes === record.gameId}
      highlighted={highlight === record.gameId}
      draft={offeredDraft(safety.drafts[record.gameId], record)}
      onToggle={() => toggle(record.gameId)}
      onOpenNotes={() => toggle(record.gameId, true)}
      onMenu={onMenu}
    />
  );

  const filters: { value: PlayingFilter; label: string }[] = [
    { value: "active", label: t("Active") },
    { value: "completed", label: t("Completed") },
    { value: "dropped", label: t("Dropped") },
  ];

  return (
    <>
      <div
        role="group"
        aria-label={t("Show games")}
        className="inline-flex w-fit flex-wrap items-center gap-1 rounded-full bg-elevated/50 p-1"
      >
        {filters.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            className={`flex h-8 items-center gap-2 rounded-full px-3.5 text-[13px] font-medium transition-colors ${
              filter === value ? "bg-ink text-canvas" : "text-ink-muted hover:text-ink"
            }`}
          >
            {label}
            <span
              className={`tabular-nums text-[12px] ${filter === value ? "text-canvas/70" : "text-ink-subtle"}`}
            >
              {counts[value]}
            </span>
          </button>
        ))}
      </div>

      {filter === "active" &&
        (counts.active === 0 ? (
          <FilterEmpty
            title={t("Nothing in progress")}
            body={
              nextUp
                ? t("Next on your Wishlist: {name}.", { name: nextUp.name })
                : t("Start a game from your Wishlist or from its page in Games.")
            }
            action={
              start && nextUp
                ? { label: t("Start {name}", { name: nextUp.name }), run: start }
                : null
            }
          />
        ) : (
          <>
            {view.playing.length > 0 && (
              <Group label={t("Playing")} count={view.playing.length}>
                {view.playing.map(card)}
              </Group>
            )}
            {view.paused.length > 0 && (
              <Group label={t("Paused")} count={view.paused.length}>
                {view.paused.map(card)}
              </Group>
            )}
          </>
        ))}

      {filter === "completed" &&
        (counts.completed === 0 ? (
          <FilterEmpty
            title={t("No completed games yet")}
            body={t("Games you mark as completed are kept here, with your notes and dates.")}
          />
        ) : (
          <Group label={null} count={counts.completed}>
            {view.completed.map(card)}
          </Group>
        ))}

      {filter === "dropped" &&
        (counts.dropped === 0 ? (
          <FilterEmpty
            title={t("No dropped games")}
            body={t(
              "Games you set aside wait here, notes and progress intact, in case you return.",
            )}
          />
        ) : (
          <Group label={null} count={counts.dropped}>
            {view.dropped.map(card)}
          </Group>
        ))}

      {menu.element}
    </>
  );
}

/** Only a version the user still has to decide on: not text matching the note. */
function offeredDraft(draft: NoteDraft | undefined, record: GameRecord): NoteDraft | null {
  return draft && draft.text !== record.notes ? draft : null;
}

function Group({
  label,
  count,
  children,
}: {
  label: string | null;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      {label && (
        <h2 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-ink-subtle">
          {label}
          <span className="tabular-nums tracking-normal text-ink-subtle/70">{count}</span>
        </h2>
      )}
      <div className="grid items-start gap-4 xl:grid-cols-2">{children}</div>
    </div>
  );
}

function FilterEmpty({
  title,
  body,
  action = null,
}: {
  title: string;
  body: string;
  action?: { label: string; run: () => void } | null;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-edge-soft bg-canvas/30 px-8 py-14 text-center">
      <h2 className="font-display text-[20px] font-medium text-ink">{title}</h2>
      <p className="max-w-sm text-[13px] leading-relaxed text-ink-muted">{body}</p>
      {action && (
        <button
          type="button"
          onClick={action.run}
          className="mt-1 flex h-10 items-center rounded-full bg-ink px-5 text-[13px] font-semibold text-canvas transition-opacity hover:opacity-90"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

function PlayingSkeleton() {
  return (
    <div aria-hidden className="grid gap-4 xl:grid-cols-2">
      {[0, 1].map((row) => (
        <div
          key={row}
          className="flex h-[150px] animate-pulse gap-4 rounded-2xl bg-surface/50 p-4 ring-1 ring-edge-soft"
          style={{ opacity: 1 - row * 0.3 }}
        >
          <span className="h-[94px] w-[168px] rounded-xl bg-white/[0.06]" />
          <span className="flex flex-1 flex-col gap-2.5 pt-1">
            <span className="h-3.5 w-1/2 rounded-full bg-white/[0.07]" />
            <span className="h-2.5 w-1/3 rounded-full bg-white/[0.05]" />
          </span>
        </div>
      ))}
    </div>
  );
}
