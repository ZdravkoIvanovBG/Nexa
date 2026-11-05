import { Layers } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FranchiseDef } from "@/lib/game-discovery/franchises";
import { useFranchiseArt } from "@/lib/game-discovery/queries";
import { gameImage } from "@/lib/game-discovery/game-image";
import type { GamesGate } from "@/lib/game-discovery/use-games-gate";
import { useT } from "@/lib/i18n";
import { useView } from "@/lib/view";

/** Franchise tile, styled like CollectionCard. Art is looked up only once the card is near view. */
export function FranchiseCard({ franchise, gate }: { franchise: FranchiseDef; gate: GamesGate }) {
  const t = useT();
  const { openGameFranchise } = useView();
  const ref = useRef<HTMLButtonElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setInView(true);
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [inView]);

  const art = useFranchiseArt(gate, franchise, inView);
  const [image] = gameImage(art.image, 640);
  const hue = [...franchise.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  const count = franchise.mainline.length;

  return (
    <button
      ref={ref}
      type="button"
      onClick={() => openGameFranchise(franchise.id)}
      className="group/card relative aspect-[16/9] w-full cursor-pointer overflow-hidden rounded-2xl border border-edge-soft text-start shadow-[0_4px_18px_-10px_rgba(0,0,0,0.5)] ring-1 ring-inset ring-white/0 transition-[border-color,transform] duration-300 hover:-translate-y-0.5 hover:border-edge hover:ring-white/15"
      style={{
        background: `linear-gradient(140deg, oklch(0.42 0.13 ${hue}), oklch(0.15 0.06 ${hue}))`,
      }}
    >
      {image && (
        <img
          src={image}
          alt=""
          loading="lazy"
          draggable={false}
          className="absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity duration-500 data-[on=true]:opacity-100"
          onLoad={(e) => e.currentTarget.setAttribute("data-on", "true")}
          onError={(e) => {
            // Undocumented resize path failed: fall back to the original once.
            if (art.image && e.currentTarget.src !== art.image) e.currentTarget.src = art.image;
          }}
        />
      )}
      <div
        aria-hidden
        className="absolute inset-0 bg-black/15 transition-colors duration-300 group-hover/card:bg-black/0"
      />
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-t from-black/88 via-black/30 to-transparent"
      />
      <span className="absolute start-3.5 top-3 inline-flex items-center gap-1.5 rounded-full bg-black/40 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-white/85 backdrop-blur-md">
        <Layers size={11} strokeWidth={2.4} />
        {t("{count} games", { count })}
      </span>
      <h3 className="absolute inset-x-4 bottom-3.5 font-display text-[21px] font-medium leading-[1.08] tracking-tight text-white drop-shadow-[0_2px_14px_rgba(0,0,0,0.7)]">
        {franchise.name}
      </h3>
    </button>
  );
}
