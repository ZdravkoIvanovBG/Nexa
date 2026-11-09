import { Check, History } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  discardGameNoteDraft,
  draftGameNotes,
  restoreGameNoteDraft,
  saveGameNotes,
  useNoteSafety,
} from "@/lib/game-library/store";
import { MAX_NOTES_LENGTH, type GameRecord } from "@/lib/game-library/types";
import { useT, useUiLanguage } from "@/lib/i18n";

// One personal note per game. It saves itself: half a second after typing
// stops, at least every few seconds while typing goes on, when the field loses
// focus, and when the card closes or the window is hidden. Until then the text
// is kept as a draft on this device, in the profile it was typed in, so closing
// Nexa or switching profile mid-sentence loses nothing. Text that a newer
// version replaced is offered back here, never put back on its own.

const AUTOSAVE_MS = 500;
const MAX_WAIT_MS = 3000;

function formatWhen(at: number, language: string): string {
  return new Date(at).toLocaleString(language, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function NotesEditor({
  profileId,
  record,
  autoFocus = false,
}: {
  /** The profile the text is typed in. The card is keyed by profile, so this never changes. */
  profileId: string;
  record: GameRecord;
  autoFocus?: boolean;
}) {
  const t = useT();
  const language = useUiLanguage();
  const safety = useNoteSafety();
  const gameId = record.gameId;
  const [text, setText] = useState(record.notes);
  const [saved, setSaved] = useState(false);
  const textRef = useRef(record.notes);
  const dirtyRef = useRef(false);
  // The note's stamp when this editor last matched the library. A save checks
  // it to keep, rather than silently replace, a version that arrived meanwhile.
  const baseRef = useRef(record.notesAt);
  const [openedAt] = useState(() => Date.now());
  const timer = useRef<number | null>(null);
  const typingSince = useRef<number | null>(null);

  // Follows the library while nothing is being typed: another device's edit,
  // or a kept version the user chose.
  useEffect(() => {
    if (dirtyRef.current) return;
    textRef.current = record.notes;
    setText(record.notes);
    baseRef.current = record.notesAt;
  }, [record.notes, record.notesAt]);

  const save = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    typingSince.current = null;
    if (!dirtyRef.current) return;
    // Refused once the profile has changed: the draft stays with that profile.
    if (!saveGameNotes(profileId, gameId, textRef.current, baseRef.current)) return;
    dirtyRef.current = false;
    setSaved(true);
  }, [profileId, gameId]);

  // `save` only changes with the profile or game, which a mounted editor never does.
  useEffect(() => {
    window.addEventListener("pagehide", save);
    window.addEventListener("beforeunload", save);
    return () => {
      window.removeEventListener("pagehide", save);
      window.removeEventListener("beforeunload", save);
      save();
    };
  }, [save]);

  const draft = safety.drafts[gameId] ?? null;
  // A draft this editor is writing as the user types isn't something to offer.
  const offered =
    draft && draft.text !== record.notes && (draft.reason === "replaced" || draft.at < openedAt)
      ? draft
      : null;

  // An unsaved draft that matches the note has nothing left to offer.
  useEffect(() => {
    if (draft && draft.reason === "unsaved" && draft.at < openedAt && draft.text === record.notes) {
      discardGameNoteDraft(profileId, gameId);
    }
  }, [draft, record.notes, profileId, gameId, openedAt]);

  const onChange = (value: string) => {
    const next = value.slice(0, MAX_NOTES_LENGTH);
    textRef.current = next;
    setText(next);
    setSaved(false);
    dirtyRef.current = true;
    // Never over a version still waiting for the user's decision.
    if (!offered) draftGameNotes(profileId, gameId, next);
    const now = Date.now();
    typingSince.current ??= now;
    const wait = Math.max(0, Math.min(AUTOSAVE_MS, MAX_WAIT_MS - (now - typingSince.current)));
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(save, wait);
  };

  const takeOffered = () => {
    save();
    if (dirtyRef.current) return;
    restoreGameNoteDraft(profileId, gameId);
  };

  const fieldId = `game-notes-${gameId}`;
  const remaining = MAX_NOTES_LENGTH - text.length;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <label
          htmlFor={fieldId}
          className="text-[11px] font-bold uppercase tracking-[0.16em] text-ink-subtle"
        >
          {t("Notes")}
        </label>
        <span aria-live="polite" className="flex items-center gap-1 text-[11.5px] text-ink-subtle">
          {remaining <= 400 && (
            <span className="tabular-nums">{t("{n} characters left", { n: remaining })}</span>
          )}
          {saved && remaining > 400 && (
            <>
              <Check size={12} strokeWidth={2.6} />
              {t("Saved")}
            </>
          )}
        </span>
      </div>

      {offered && (
        <div className="flex flex-col gap-2 rounded-xl bg-amber-400/[0.07] px-3.5 py-3 text-[12.5px] ring-1 ring-amber-400/20">
          <p className="flex items-center gap-1.5 font-semibold text-ink">
            <History size={13} strokeWidth={2.3} className="shrink-0 text-amber-300" />
            {offered.reason === "unsaved"
              ? t("Text from {when} wasn't saved", { when: formatWhen(offered.at, language) })
              : t("A different version from {when} was replaced", {
                  when: formatWhen(offered.at, language),
                })}
          </p>
          <p className="line-clamp-4 whitespace-pre-wrap break-words text-ink-muted">
            {offered.text}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={takeOffered}
              className="h-7 rounded-full bg-amber-300/15 px-3 font-semibold text-amber-200 transition-colors hover:bg-amber-300/25"
            >
              {t("Use this version")}
            </button>
            <button
              type="button"
              onClick={() => discardGameNoteDraft(profileId, gameId)}
              className="h-7 rounded-full px-3 font-medium text-ink-muted transition-colors hover:text-ink"
            >
              {t("Discard it")}
            </button>
          </div>
          <p className="text-[11.5px] text-ink-subtle">
            {t("Using it keeps your current note here, so you can switch back.")}
          </p>
        </div>
      )}

      <textarea
        id={fieldId}
        value={text}
        maxLength={MAX_NOTES_LENGTH}
        rows={4}
        autoFocus={autoFocus}
        placeholder={t("Where you are, what to do next, anything to remember…")}
        onChange={(e) => onChange(e.target.value)}
        onBlur={save}
        className="min-h-[104px] w-full resize-y rounded-xl bg-canvas/40 px-3.5 py-3 text-[13.5px] leading-relaxed text-ink ring-1 ring-edge-soft transition-shadow placeholder:text-ink-subtle/70 focus:outline-none focus:ring-accent/50"
      />
    </div>
  );
}
