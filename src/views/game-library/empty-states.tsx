import { useT } from "@/lib/i18n";
import type { ReactNode } from "react";

// What each tab will hold, shown until it does. The illustrations only sketch
// the shape of the feature: nothing here is interactive, because nothing can be
// done from these tabs yet.

const GHOST = "bg-white/[0.07]";

function Thumb({ className = "" }: { className?: string }) {
  return (
    <span
      className={`relative shrink-0 overflow-hidden rounded-md bg-gradient-to-br from-white/[0.14] to-white/[0.03] ${className}`}
    />
  );
}

function WishlistSketch() {
  return (
    <div className="flex w-full flex-col gap-2.5">
      {[0, 1, 2].map((row) => (
        <div
          key={row}
          className="flex items-center gap-3 rounded-xl bg-white/[0.03] p-2.5 ring-1 ring-white/[0.05]"
          style={{ opacity: 1 - row * 0.26 }}
        >
          <span className="w-5 text-center font-display text-[17px] tabular-nums text-ink-subtle">
            {row + 1}
          </span>
          <Thumb className="h-11 w-[78px]" />
          <span className="flex min-w-0 flex-1 flex-col gap-2">
            <span
              className={`h-2.5 rounded-full ${GHOST}`}
              style={{ width: `${72 - row * 14}%` }}
            />
            <span className={`h-2 w-[38%] rounded-full ${GHOST}`} />
          </span>
        </div>
      ))}
    </div>
  );
}

function PlayingSketch() {
  return (
    <div className="flex w-full flex-col gap-3">
      {[
        { fill: 62, opacity: 1 },
        { fill: 28, opacity: 0.66 },
      ].map(({ fill, opacity }) => (
        <div
          key={fill}
          className="flex items-center gap-3.5 rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/[0.05]"
          style={{ opacity }}
        >
          <Thumb className="h-[62px] w-[110px]" />
          <span className="flex min-w-0 flex-1 flex-col gap-2.5">
            <span className={`h-2.5 w-[64%] rounded-full ${GHOST}`} />
            <span className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
              <span
                className="block h-full rounded-full bg-accent/70"
                style={{ width: `${fill}%` }}
              />
            </span>
            <span className={`h-2 w-[46%] rounded-full ${GHOST}`} />
          </span>
        </div>
      ))}
    </div>
  );
}

const TIER_SKETCH = [
  { tier: "S", color: "bg-rose-500/80", tiles: 3 },
  { tier: "A", color: "bg-amber-500/80", tiles: 2 },
  { tier: "B", color: "bg-yellow-400/80", tiles: 1 },
];

function TierSketch() {
  return (
    <div className="flex w-full flex-col gap-2">
      {TIER_SKETCH.map(({ tier, color, tiles }, row) => (
        <div
          key={tier}
          className="flex overflow-hidden rounded-lg ring-1 ring-white/[0.05]"
          style={{ opacity: 1 - row * 0.2 }}
        >
          <span
            className={`flex w-11 shrink-0 items-center justify-center font-display text-[17px] text-white ${color}`}
          >
            {tier}
          </span>
          <span className="flex min-h-[54px] flex-1 items-center gap-2 bg-white/[0.03] p-2">
            {Array.from({ length: tiles }, (_, i) => (
              <Thumb key={i} className="h-[38px] w-[68px]" />
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ sketch, title, body }: { sketch: ReactNode; title: string; body: string }) {
  const t = useT();
  return (
    <section className="animate-fade-in grid items-center gap-10 rounded-[20px] bg-surface/50 p-8 ring-1 ring-edge-soft md:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-16 lg:p-12">
      <div className="flex max-w-md flex-col items-start gap-3">
        <span className="rounded-full bg-accent/15 px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-accent">
          {t("Coming soon")}
        </span>
        <h2 className="font-display text-[28px] font-medium leading-[1.15] text-ink">{t(title)}</h2>
        <p className="text-[14px] leading-relaxed text-ink-muted">{t(body)}</p>
      </div>
      <div aria-hidden className="pointer-events-none">
        {sketch}
      </div>
    </section>
  );
}

export function WishlistEmpty() {
  return (
    <EmptyState
      sketch={<WishlistSketch />}
      title="Your play queue will live here"
      body="Line up single games and whole franchises in the order you want to play them, then rearrange them whenever your plans change."
    />
  );
}

export function PlayingEmpty() {
  return (
    <EmptyState
      sketch={<PlayingSketch />}
      title="Pick up right where you left off"
      body="Keep track of what you're playing, how far you've got, and the notes you'd want before your next session."
    />
  );
}

export function TierListEmpty() {
  return (
    <EmptyState
      sketch={<TierSketch />}
      title="Rank the games you've finished"
      body="Completed games will wait here until you decide where they belong, from S all the way down to F."
    />
  );
}
