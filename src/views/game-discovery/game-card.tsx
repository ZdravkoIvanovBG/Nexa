import { Poster } from "@/components/poster";
import type { GameSummary } from "@/lib/game-discovery/types";
import { rawgImage } from "@/lib/providers/rawg/image";
import { useT } from "@/lib/i18n";
import { useView } from "@/lib/view";
import { metacriticTone, platformLabels, releaseYear } from "./format";

export function MetacriticBadge({ score, size = "sm" }: { score: number; size?: "sm" | "md" }) {
  const t = useT();
  return (
    <span
      title={t("Metacritic score")}
      className={`inline-flex items-center rounded-md font-semibold tabular-nums ring-1 ${metacriticTone(score)} ${
        size === "md" ? "h-7 px-2 text-[13px]" : "h-[18px] px-1.5 text-[11px]"
      }`}
    >
      {score}
    </span>
  );
}

/** Landscape game card: RAWG art is 16:9 key art, never cropped to a portrait poster. */
export function GameCard({ game }: { game: GameSummary }) {
  const { openGame } = useView();
  const [src, ...fallbacks] = rawgImage(game.image, 640);
  const year = releaseYear(game);
  const platforms = platformLabels(game.platformFamilies);
  return (
    <button
      onClick={() => openGame(game)}
      data-media-card
      className="group relative z-0 flex w-full min-w-0 flex-col gap-2.5 text-start"
    >
      <div className="relative w-full transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0.24,1)] will-change-transform group-hover:[transform:translate3d(0,-0.5rem,0)] group-focus-visible:[transform:translate3d(0,-0.5rem,0)]">
        <Poster
          src={src}
          fallbacks={fallbacks}
          seed={game.id.replace(":", "-")}
          ratio="landscape"
          lazy
          className="harbor-card-ring rounded-[var(--poster-radius,12px)] shadow-[0_2px_8px_-2px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.06)] transition-[box-shadow] duration-300 group-hover:shadow-[0_24px_48px_-14px_rgba(0,0,0,0.65),inset_0_1px_0_rgba(255,255,255,0.08)]"
        >
          {!game.image && (
            <span className="absolute inset-0 flex items-end p-3 text-[13px] font-medium leading-snug text-ink/85">
              {game.name}
            </span>
          )}
        </Poster>
      </div>
      <div className="flex min-w-0 flex-col gap-1 px-0.5">
        <span className="line-clamp-1 text-[13.5px] font-medium leading-snug text-ink">
          {game.name}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-ink-subtle">
          {year && <span className="shrink-0 tabular-nums">{year}</span>}
          {year && platforms.length > 0 && (
            <span aria-hidden className="h-1 w-1 shrink-0 rounded-full bg-ink-subtle/60" />
          )}
          {platforms.length > 0 && <span className="truncate">{platforms.join(" · ")}</span>}
          {game.metacritic !== null && (
            <span className="ms-auto shrink-0">
              <MetacriticBadge score={game.metacritic} />
            </span>
          )}
        </span>
      </div>
    </button>
  );
}

export function GameCardSkeleton() {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="aspect-[16/9] w-full animate-pulse rounded-[var(--poster-radius,12px)] bg-elevated/40" />
      <div className="h-3.5 w-3/4 animate-pulse rounded bg-elevated/40" />
      <div className="h-3 w-1/2 animate-pulse rounded bg-elevated/30" />
    </div>
  );
}
