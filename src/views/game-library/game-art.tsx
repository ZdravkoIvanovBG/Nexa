import { Layers } from "lucide-react";
import { useState } from "react";
import { Poster } from "@/components/poster";
import { rawgImage, type RawgImageWidth } from "@/lib/providers/rawg/image";

// Saved art is only a URL, so it can fail offline or once RAWG moves it. Poster
// falls back to a gradient seeded by the game, and the name is drawn on it, so
// a game is never shown without anything to recognise it by.

export function GameArt({
  image,
  seed,
  name,
  width = 420,
  className = "",
  posterClassName = "",
  showName = false,
}: {
  image: string | null;
  seed: string;
  name: string;
  width?: RawgImageWidth;
  /** Sizes the art. Poster is always full width, so sizing goes on a wrapper. */
  className?: string;
  posterClassName?: string;
  /** Prints the name on the art when there is none, for cards without a caption. */
  showName?: boolean;
}) {
  const [src, ...fallbacks] = rawgImage(image, width);
  const [failed, setFailed] = useState(false);
  return (
    <div className={className}>
      <Poster
        src={src}
        fallbacks={fallbacks}
        seed={seed}
        ratio="landscape"
        lazy
        onError={() => setFailed(true)}
        className={`ring-1 ring-white/[0.06] ${posterClassName}`}
      >
        {(!image || failed) && showName && (
          <span className="absolute inset-0 flex items-end p-3 text-[13px] font-medium leading-snug text-ink/85">
            {name}
          </span>
        )}
      </Poster>
    </div>
  );
}

/** A collection's art with two cards fanned out behind it. */
export function CollectionArt({
  image,
  seed,
  name,
  width = 420,
  className = "",
  showName = false,
}: {
  image: string | null;
  seed: string;
  name: string;
  width?: RawgImageWidth;
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
        <GameArt image={image} seed={seed} name={name} width={width} showName={showName} />
        <span className="absolute bottom-1.5 end-1.5 flex h-5 w-5 items-center justify-center rounded-md bg-black/60 text-white/90 backdrop-blur-sm">
          <Layers size={11} strokeWidth={2.4} />
        </span>
      </div>
    </div>
  );
}
