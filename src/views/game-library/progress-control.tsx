import { Check } from "lucide-react";
import { useState } from "react";
import type { GameRecord } from "@/lib/game-library/types";
import { useT } from "@/lib/i18n";
import { commitProgress, completeGame, setTracking } from "./play-actions";

// Optional, manual progress. Nothing is ever inferred from the provider. The
// value is written when the slider is let go or the number is entered, never
// on every pixel, so dragging it costs one upload. Switching tracking off
// hides it and keeps the value.

export function ProgressControl({ record }: { record: GameRecord }) {
  const t = useT();
  const stored = record.progress ?? 0;
  // Only while the slider is held or the number is being typed: otherwise the
  // library's value shows, including one that arrives from another device.
  const [dragging, setDragging] = useState<number | null>(null);
  const [typing, setTyping] = useState<string | null>(null);
  const value = dragging ?? stored;

  const commit = (next: number) => {
    setDragging(null);
    setTyping(null);
    commitProgress(record.gameId, Math.max(0, Math.min(100, Math.round(next))));
  };

  const enabled = record.progressEnabled;
  const unfinished = record.status === "playing" || record.status === "paused";

  return (
    <div className="flex flex-col gap-2.5">
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={() => setTracking(record.gameId, !enabled)}
        className={`inline-flex w-fit items-center gap-2 rounded-full px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
          enabled
            ? "bg-accent/15 text-accent ring-1 ring-accent/40"
            : "text-ink-muted ring-1 ring-edge-soft hover:bg-raised hover:text-ink"
        }`}
      >
        <span
          className={`flex h-4 w-4 items-center justify-center rounded-[5px] transition-colors ${
            enabled ? "bg-accent text-canvas" : "ring-1 ring-edge"
          }`}
        >
          {enabled && <Check size={11} strokeWidth={3} />}
        </span>
        {t("Track progress")}
      </button>

      {enabled && (
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={value}
            aria-label={t("Progress")}
            aria-valuetext={t("{n}% complete", { n: value })}
            onChange={(e) => setDragging(Number(e.target.value))}
            onPointerUp={(e) => commit(Number(e.currentTarget.value))}
            onKeyUp={(e) => commit(Number(e.currentTarget.value))}
            onBlur={(e) => commit(Number(e.currentTarget.value))}
            className="h-1 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-edge-soft accent-accent"
          />
          <label className="flex items-center gap-1 text-[13px] text-ink-muted">
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              value={typing ?? String(value)}
              aria-label={t("Progress percentage")}
              onChange={(e) => setTyping(e.target.value)}
              onBlur={() => {
                if (typing === null) return;
                const n = Number(typing);
                if (typing.trim() === "" || !Number.isFinite(n)) setTyping(null);
                else commit(n);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              className="h-8 w-14 rounded-lg bg-canvas/40 px-2 text-end text-[13px] tabular-nums text-ink ring-1 ring-edge-soft focus:outline-none focus:ring-accent/50"
            />
            %
          </label>
        </div>
      )}

      {enabled && unfinished && stored === 100 && (
        <p className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-muted">
          {t("At 100%. Finished it?")}
          <button
            type="button"
            onClick={() => completeGame(record.gameId, record.name, t)}
            className="h-7 rounded-full bg-emerald-400/12 px-3 font-semibold text-emerald-300 transition-colors hover:bg-emerald-400/20"
          >
            {t("Mark completed")}
          </button>
        </p>
      )}
    </div>
  );
}
