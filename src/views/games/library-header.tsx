import { Plus } from "lucide-react";
import { FilterPill } from "@/views/library/shared";
import { useT } from "@/lib/i18n";
import type { GamePlatform, GameSort } from "@/lib/games/types";

const PLATFORMS: Array<{ key: GamePlatform | "all"; label: string }> = [
  { key: "all", label: "All" },
  { key: "steam", label: "Steam" },
  { key: "epic", label: "Epic" },
  { key: "custom", label: "Custom" },
];

const SORTS: Array<{ key: GameSort; label: string }> = [
  { key: "recent", label: "Recently Played" },
  { key: "playtime", label: "Playtime" },
  { key: "alpha", label: "Alphabetical" },
];

export function LibraryHeader({
  platform,
  onPlatform,
  sort,
  onSort,
  search,
  onSearch,
  onAddGame,
}: {
  platform: GamePlatform | "all";
  onPlatform: (p: GamePlatform | "all") => void;
  sort: GameSort;
  onSort: (s: GameSort) => void;
  search: string;
  onSearch: (q: string) => void;
  onAddGame: () => void;
}) {
  const t = useT();
  return (
    <header className="flex flex-col gap-5">
      <div className="flex items-end justify-between gap-6">
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-bold uppercase tracking-[0.28em] text-ink-subtle">
            {t("Games")}
          </span>
          <h1 className="font-display text-[44px] font-medium leading-[1.05] text-ink">
            {t("Your library.")}
          </h1>
        </div>
        <button
          type="button"
          onClick={onAddGame}
          data-tv-focusable="true"
          className="flex h-11 items-center gap-2 rounded-full bg-ink px-5 text-[13.5px] font-semibold text-canvas transition-opacity hover:opacity-90"
        >
          <Plus size={15} strokeWidth={2.4} />
          {t("Add Game")}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-full bg-elevated/40 p-0.5 ring-1 ring-edge-soft/60">
          {PLATFORMS.map((p) => (
            <FilterPill key={p.key} active={platform === p.key} onClick={() => onPlatform(p.key)}>
              {t(p.label)}
            </FilterPill>
          ))}
        </div>
        <div className="flex items-center gap-1 rounded-full bg-elevated/40 p-0.5 ring-1 ring-edge-soft/60">
          {SORTS.map((s) => (
            <FilterPill key={s.key} active={sort === s.key} onClick={() => onSort(s.key)}>
              {t(s.label)}
            </FilterPill>
          ))}
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={t("Search games…")}
          className="min-w-[220px] max-w-md flex-1 rounded-full bg-elevated/40 px-4 py-2 text-[13px] text-ink placeholder:text-ink-subtle outline-none ring-1 ring-edge-soft/60 focus:ring-edge"
        />
      </div>
    </header>
  );
}
