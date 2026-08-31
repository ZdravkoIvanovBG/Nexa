import { Minus, Plus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Poster, usePosterChain } from "@/components/poster";
import { type Meta } from "@/lib/cinemeta";
import {
  markWatched,
  removeFromWatching,
  setProgress,
  type WatchingEntry,
} from "@/lib/library-tracking";
import { useSettings } from "@/lib/settings";
import { useView } from "@/lib/view";
import { useT } from "@/lib/i18n";
import { hydrateLibraryMeta } from "./hydrate-meta";

function Stepper({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
  min: number;
  max?: number;
}) {
  const atMin = value <= min;
  const atMax = max != null && value >= max;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-bold uppercase tracking-[0.28em] text-ink-subtle">
        {label}
      </span>
      <div className="flex h-9 w-fit items-center rounded-full border border-edge bg-canvas/60">
        <button
          type="button"
          disabled={atMin}
          onClick={() => onChange(value - 1)}
          aria-label={`${label} −`}
          className="flex h-9 w-9 items-center justify-center rounded-full text-ink-muted transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Minus size={14} strokeWidth={2.4} />
        </button>
        <span className="min-w-[2ch] px-1 text-center font-mono text-[14px] tabular-nums text-ink">
          {value}
        </span>
        <button
          type="button"
          disabled={atMax}
          onClick={() => onChange(value + 1)}
          aria-label={`${label} +`}
          className="flex h-9 w-9 items-center justify-center rounded-full text-ink-muted transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus size={14} strokeWidth={2.4} />
        </button>
      </div>
    </div>
  );
}

export function WatchingCard({ entry }: { entry: WatchingEntry }) {
  const t = useT();
  const { openMeta } = useView();
  const { settings } = useSettings();
  const cardRef = useRef<HTMLDivElement>(null);
  const [hydrated, setHydrated] = useState<Meta | null>(null);
  const [posterFailed, setPosterFailed] = useState(false);
  const posterFailedOnceRef = useRef(false);

  useEffect(() => {
    posterFailedOnceRef.current = false;
    setPosterFailed(false);
  }, [entry.id]);

  const onPosterError = useCallback(() => {
    if (posterFailedOnceRef.current) return;
    posterFailedOnceRef.current = true;
    setPosterFailed(true);
  }, []);

  useEffect(() => {
    if (entry.poster && entry.name && !posterFailed) {
      setHydrated(null);
      return;
    }
    const el = cardRef.current;
    if (!el) return;
    let cancelled = false;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        io.disconnect();
        hydrateLibraryMeta(entry.id, entry.type, settings.tmdbKey ?? null)
          .then((full) => {
            if (!cancelled && full) setHydrated(full);
          })
          .catch(() => {});
      },
      { rootMargin: "300px 0px" },
    );
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [entry.id, entry.type, entry.poster, entry.name, settings.tmdbKey, posterFailed]);

  const name = hydrated?.name || entry.name || entry.id;
  const poster = usePosterChain(
    settings.rpdbKey,
    entry.id,
    hydrated?.poster ?? entry.poster,
    entry.type,
  );

  const open = () =>
    openMeta({
      id: entry.id,
      type: entry.type,
      name,
      poster: hydrated?.poster ?? entry.poster,
    } as Meta);

  const facts = [
    entry.yearLabel || hydrated?.releaseInfo,
    entry.totalSeasons ? t("{n} seasons", { n: entry.totalSeasons }) : null,
    entry.status ? t(entry.status) : null,
  ].filter(Boolean);

  return (
    <div
      ref={cardRef}
      className="flex gap-4 rounded-2xl border border-edge-soft bg-surface p-4 transition-colors hover:bg-elevated"
    >
      <button
        type="button"
        onClick={open}
        aria-label={name}
        className="w-[88px] shrink-0 overflow-hidden rounded-xl bg-elevated shadow-[0_2px_8px_-2px_rgba(0,0,0,0.4)] transition-transform duration-200 hover:scale-[1.03]"
      >
        <Poster
          src={poster.src}
          seed={entry.id}
          className="aspect-[2/3] w-full"
          onError={() => {
            poster.onError();
            onPosterError();
          }}
        />
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <button type="button" onClick={open} className="text-start">
            <h3 className="truncate font-display text-[17px] font-medium text-ink transition-colors hover:text-accent">
              {name}
            </h3>
          </button>
          {facts.length > 0 && (
            <p className="truncate text-[12px] text-ink-muted">{facts.join(" · ")}</p>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <Stepper
            label={t("Season")}
            value={entry.season}
            min={1}
            max={entry.totalSeasons}
            onChange={(n) => setProgress(entry.id, n, entry.episode)}
          />
          <Stepper
            label={t("Episode")}
            value={entry.episode}
            min={1}
            onChange={(n) => setProgress(entry.id, entry.season, n)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() =>
              markWatched({
                id: entry.id,
                type: entry.type,
                name: entry.name || name,
                poster: entry.poster ?? hydrated?.poster,
              })
            }
            className="flex h-9 items-center rounded-full border border-accent/55 bg-accent/15 px-4 text-[13px] font-semibold text-accent transition-colors hover:bg-accent/22"
          >
            {t("Mark as Finished")}
          </button>
          <button
            type="button"
            onClick={() => removeFromWatching(entry.id)}
            className="flex h-9 items-center gap-1.5 rounded-full border border-edge px-4 text-[13px] font-semibold text-ink-muted transition-colors hover:border-ink-subtle hover:text-ink"
          >
            <X size={14} strokeWidth={2.4} />
            {t("Remove")}
          </button>
        </div>
      </div>
    </div>
  );
}
