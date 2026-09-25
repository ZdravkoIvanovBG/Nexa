import { X } from "lucide-react";
import { useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Poster, usePosterChain } from "@/components/poster";
import { type Meta } from "@/lib/cinemeta";
import { removeFromWatched, type Tier, type WatchedEntry } from "@/lib/library-tracking";
import { useSettings } from "@/lib/settings";
import { useView } from "@/lib/view";
import { useT } from "@/lib/i18n";
import { hydrateLibraryMeta } from "./hydrate-meta";

export function TierTile({
  entry,
  tier,
  index,
  registerTile,
  onPointerDownTile,
}: {
  entry: WatchedEntry;
  tier: Tier;
  index: number;
  registerTile: (id: string, el: HTMLDivElement | null) => void;
  onPointerDownTile: (e: ReactPointerEvent, entry: WatchedEntry) => void;
}) {
  const t = useT();
  const { settings } = useSettings();
  const { openMeta } = useView();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [fetched, setFetched] = useState<{ id: string; meta: Meta } | null>(null);
  // Movies marked watched from a path that only stored their id (the eye
  // button, the context menu, an older build) arrive with no poster or name.
  useEffect(() => {
    if (entry.poster && entry.name) return;
    let cancelled = false;
    hydrateLibraryMeta(entry.id, entry.type, settings.tmdbKey ?? null)
      .then((full) => {
        if (!cancelled && full) setFetched({ id: entry.id, meta: full });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [entry.id, entry.type, entry.poster, entry.name, settings.tmdbKey]);
  // Keyed by id so a recycled tile never shows the previous entry's art.
  const hydrated = fetched?.id === entry.id ? fetched.meta : null;
  const posterUrl = entry.poster ?? hydrated?.poster;
  const poster = usePosterChain(settings.rpdbKey, entry.id, posterUrl, entry.type);
  const name = entry.name || hydrated?.name || entry.id;

  const open = () => openMeta({ id: entry.id, type: entry.type, name, poster: posterUrl } as Meta);

  return (
    <div
      ref={(el) => registerTile(entry.id, el)}
      data-tier-tile={entry.id}
      data-tier-row={tier}
      data-tier-index={index}
      onPointerDown={(e) => onPointerDownTile(e, entry)}
      // opacity/cursor/box-shadow while dragging are applied directly via
      // this ref by the drag controller in tier-list-tab.tsx, not props --
      // that keeps the live drag off React state entirely.
      style={{ transition: "box-shadow 120ms ease, opacity 120ms ease" }}
      className="group relative w-[64px] cursor-grab touch-none select-none rounded-[var(--poster-radius,12px)]"
    >
      <button
        type="button"
        onClick={open}
        title={name}
        aria-label={name}
        className="w-full overflow-hidden rounded-[var(--poster-radius,12px)] bg-elevated shadow-[0_2px_8px_-2px_rgba(0,0,0,0.4)]"
      >
        <Poster
          src={poster.src}
          seed={entry.id}
          className="aspect-[2/3] w-full"
          onError={poster.onError}
        />
      </button>
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onMouseLeave={() => setConfirmRemove(false)}
        onClick={(e) => {
          e.stopPropagation();
          if (confirmRemove) {
            removeFromWatched(entry.id);
            setConfirmRemove(false);
          } else {
            setConfirmRemove(true);
          }
        }}
        aria-label={confirmRemove ? t("Confirm remove from library") : t("Remove from Watched")}
        className={`absolute end-1 top-1 flex h-6 items-center justify-center gap-1 rounded-full text-white shadow-[0_2px_8px_rgba(0,0,0,0.4)] transition-all duration-200 ${
          confirmRemove
            ? "bg-danger px-2 text-[10px] font-semibold"
            : "w-6 bg-canvas/70 opacity-0 backdrop-blur-sm hover:bg-canvas/90 focus-visible:opacity-100 group-hover:opacity-100"
        }`}
      >
        <X size={12} strokeWidth={2.4} />
        {confirmRemove && t("Remove")}
      </button>
      <p className="mt-1 truncate text-center text-[10.5px] leading-tight text-ink-muted">{name}</p>
    </div>
  );
}
