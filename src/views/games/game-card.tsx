import { Gamepad2, PlayCircle } from "lucide-react";
import { useState } from "react";
import { gameAssetSrc } from "@/lib/games/asset-src";
import { formatPlaytime } from "@/lib/games/format";
import type { GameEntry } from "@/lib/games/types";

export function GameCard({
  game,
  playing,
  onOpen,
}: {
  game: GameEntry;
  playing: boolean;
  onOpen: () => void;
}) {
  // Launcher covers are remote URLs guessed from an app id, so a handful of
  // titles have no image at that path — fall back to the placeholder rather
  // than a broken image. Keying on the url self-heals once artwork changes.
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);
  const src = gameAssetSrc(game.coverPath);
  const cover = src && src !== brokenSrc ? src : undefined;
  return (
    <button
      type="button"
      data-media-card
      onClick={onOpen}
      className="group relative z-0 flex w-full min-w-0 flex-col gap-2.5 text-start"
    >
      <div className="relative w-full transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0.24,1)] will-change-transform group-hover:[transform:translate3d(0,-0.5rem,0)]">
        <div className="harbor-card-ring relative aspect-[2/3] w-full overflow-hidden rounded-[var(--poster-radius,12px)] bg-elevated shadow-[0_2px_8px_-2px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.06)] transition-[box-shadow] duration-300 group-hover:shadow-[0_24px_48px_-14px_rgba(0,0,0,0.65),inset_0_1px_0_rgba(255,255,255,0.08)]">
          {cover ? (
            <img
              src={cover}
              alt=""
              draggable={false}
              onError={() => setBrokenSrc(cover)}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-elevated to-canvas">
              <Gamepad2 size={36} className="text-ink-subtle/50" strokeWidth={1.4} />
            </div>
          )}
          {playing && (
            <span className="absolute inset-x-0 top-0 flex items-center gap-1 bg-accent/90 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-canvas">
              <PlayCircle size={11} /> Playing
            </span>
          )}
          <span className="absolute bottom-1.5 start-1.5 rounded-md bg-canvas/85 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-ink-muted backdrop-blur-sm">
            {game.platform}
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-0.5 px-0.5">
        <span className="truncate text-[13px] font-medium leading-tight text-ink">
          {game.title}
        </span>
        <span className="text-[11px] text-ink-subtle">
          {formatPlaytime(game.totalPlaytimeMinutes)}
        </span>
      </div>
    </button>
  );
}
