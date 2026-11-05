import { Layers } from "lucide-react";
import { useState } from "react";
import { Poster } from "@/components/poster";
import { igdbFranchiseArtwork } from "@/lib/game-discovery/franchises-igdb";
import { coverImage, gameImage, gameImageKind } from "@/lib/game-discovery/game-image";
import type { CollectionMember } from "@/lib/game-library/rules";
import type { QueueEntry } from "@/lib/game-library/types";
import type { RawgImageWidth } from "@/lib/providers/rawg/image";
import { LandscapeFill, PortraitFill } from "../game-discovery/game-card";

// Saved art is only a URL, so it can fail offline or once the provider moves
// it. Poster falls back to a gradient seeded by the game, and the name is drawn
// on it, so a game is never shown without anything to recognise it by.
//
// A view draws all of its cards in one shape, the one Discovery uses for the
// active provider: landscape for RAWG, 3:4 covers for IGDB. Saved art of the
// other shape (an IGDB cover in a landscape card, RAWG art in a cover card) is
// shown whole on a blurred copy of itself, never cropped or stretched.

export type GameArtShape = "landscape" | "cover";

export function GameArt({
  image,
  seed,
  name,
  width = 420,
  shape = "landscape",
  className = "",
  posterClassName = "",
  showName = false,
}: {
  image: string | null;
  seed: string;
  name: string;
  width?: RawgImageWidth;
  shape?: GameArtShape;
  /** Sizes the art. Poster is always full width, so sizing goes on a wrapper. */
  className?: string;
  posterClassName?: string;
  /** Prints the name on the art when there is none, for cards without a caption. */
  showName?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const kind = gameImageKind(image);
  const fits = kind === shape;
  const [src, ...fallbacks] = !fits
    ? []
    : shape === "cover"
      ? coverImage(image)
      : gameImage(image, width);
  return (
    <div className={className}>
      <Poster
        src={src}
        fallbacks={fallbacks}
        seed={seed}
        ratio={shape}
        lazy
        onError={() => setFailed(true)}
        className={`ring-1 ring-white/[0.06] ${posterClassName}`}
      >
        {image && kind === "cover" && shape === "landscape" && <PortraitFill src={image} />}
        {image && kind === "landscape" && shape === "cover" && (
          <LandscapeFill src={gameImage(image, 420)[0] ?? image} />
        )}
        {(!image || failed) && showName && (
          <span className="absolute inset-0 flex items-end p-3 text-[13px] font-medium leading-snug text-ink/85">
            {name}
          </span>
        )}
      </Poster>
    </div>
  );
}

/**
 * A collection's art in the view's shape, from what is saved (no request).
 * Landscape: the franchise art saved with it, else its first game's. Cover: the
 * cover of the franchise's artwork game when it is a member, so reordering
 * doesn't change it, else the first member's cover, else the landscape art.
 */
export function collectionImage(
  entry: QueueEntry,
  members: readonly CollectionMember[],
  shape: GameArtShape,
): string | null {
  const fallback = entry.image ?? members[0]?.record.image ?? null;
  if (shape === "landscape") return fallback;
  const artwork = entry.franchiseId ? igdbFranchiseArtwork(entry.franchiseId) : null;
  const covers = members.filter((m) => gameImageKind(m.record.image) === "cover");
  const lead = covers.find((m) => m.record.gameId === `igdb:${artwork}`) ?? covers[0];
  return lead?.record.image ?? fallback;
}

/** A collection's art with two cards fanned out behind it. */
export function CollectionArt({
  image,
  seed,
  name,
  width = 420,
  shape = "landscape",
  className = "",
  showName = false,
}: {
  image: string | null;
  seed: string;
  name: string;
  width?: RawgImageWidth;
  shape?: GameArtShape;
  className?: string;
  showName?: boolean;
}) {
  return (
    <div className={`relative ${className}`}>
      <span
        aria-hidden
        className="absolute inset-x-[9%] -top-[7%] h-full rounded-[var(--poster-radius,12px)] bg-white/[0.07] ring-1 ring-white/[0.05]"
      />
      <span
        aria-hidden
        className="absolute inset-x-[4.5%] -top-[3.5%] h-full rounded-[var(--poster-radius,12px)] bg-white/[0.11] ring-1 ring-white/[0.06]"
      />
      <div className="relative">
        <GameArt
          image={image}
          seed={seed}
          name={name}
          width={width}
          shape={shape}
          showName={showName}
        />
        <span className="absolute bottom-1.5 end-1.5 flex h-5 w-5 items-center justify-center rounded-md bg-black/60 text-white/90 backdrop-blur-sm">
          <Layers size={11} strokeWidth={2.4} />
        </span>
      </div>
    </div>
  );
}
