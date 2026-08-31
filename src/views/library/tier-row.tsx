import type { PointerEvent as ReactPointerEvent } from "react";
import { type Tier, type WatchedEntry } from "@/lib/library-tracking";
import { TierTile } from "./tier-tile";

const TIER_STYLE: Record<Tier, string> = {
  S: "bg-rose-500 text-white",
  A: "bg-amber-500 text-white",
  B: "bg-yellow-400 text-neutral-900",
  C: "bg-emerald-500 text-white",
  D: "bg-sky-500 text-white",
  F: "bg-purple-500 text-white",
  unranked: "bg-elevated text-ink-muted",
};

export function TierRow({
  tier,
  label,
  entries,
  registerTile,
  onTilePointerDown,
}: {
  tier: Tier;
  label: string;
  entries: WatchedEntry[];
  registerTile: (id: string, el: HTMLDivElement | null) => void;
  onTilePointerDown: (e: ReactPointerEvent, entry: WatchedEntry) => void;
}) {
  return (
    <div className="flex overflow-hidden rounded-xl border border-edge-soft">
      <div
        className={`flex w-[76px] shrink-0 items-center justify-center px-2 text-center font-display font-medium ${
          tier === "unranked" ? "text-[12px] leading-tight" : "text-[26px]"
        } ${TIER_STYLE[tier]}`}
      >
        {label}
      </div>
      <div
        data-tier-drop={tier}
        data-tier-count={entries.length}
        // The drop-target ring is applied directly to this node by the drag
        // controller in tier-list-tab.tsx, not via a React-state prop.
        style={{ transition: "box-shadow 120ms ease" }}
        className="flex min-h-[104px] flex-1 flex-wrap content-start gap-2 bg-canvas/30 p-2"
      >
        {entries.map((entry, index) => (
          <TierTile
            key={entry.id}
            entry={entry}
            tier={tier}
            index={index}
            registerTile={registerTile}
            onPointerDownTile={onTilePointerDown}
          />
        ))}
      </div>
    </div>
  );
}
