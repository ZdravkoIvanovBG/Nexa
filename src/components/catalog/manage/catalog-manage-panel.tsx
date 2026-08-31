import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Puzzle, Search, X } from "lucide-react";
import { useProfiles } from "@/lib/profiles";
import { listBrowseCatalogs } from "@/lib/catalog-browse";
import { queryKeys } from "@/lib/query";
import { useT } from "@/lib/i18n";
import { useSettings } from "@/lib/settings";
import { useView } from "@/lib/view";
import { CatalogManageList } from "./manage-list";
import { AddonFilterSelect } from "./addon-filter-select";
import { useCatalogList } from "./use-catalog-list";

/** Stable empty fallback so memo deps do not churn every render. */
const NO_KEYS: string[] = [];

const TYPE_LABELS: Record<string, string> = {
  movie: "Movies",
  series: "Series",
  anime: "Anime",
  tv: "TV",
  channel: "Channels",
};

/**
 * Pin/hide/reorder surface for addon catalogs. Pinned catalogs sort to the top
 * of Discover's catalog picker and hidden ones drop out of it entirely.
 */
export function CatalogManagePanel({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { activeId: profileId } = useProfiles();
  const { setView } = useView();
  const { settings, update } = useSettings();
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [addonFilter, setAddonFilter] = useState("all");

  const { data: catalogs = [], isPending: loading } = useQuery({
    queryKey: queryKeys.catalog.list(profileId),
    queryFn: () => listBrowseCatalogs(),
    staleTime: 5 * 60_000,
  });

  const pinned = settings.catalogsPinned ?? NO_KEYS;
  const hidden = settings.catalogsHidden ?? NO_KEYS;
  const { types, addons, filtered, pinnedCats, pinnedSet, hiddenSet } = useCatalogList(
    catalogs,
    { query, typeFilter, addonFilter },
    pinned,
    hidden,
  );

  const togglePin = (key: string) =>
    update({
      catalogsPinned: pinned.includes(key) ? pinned.filter((k) => k !== key) : [...pinned, key],
    });
  const toggleHide = (key: string) =>
    update({
      catalogsHidden: hidden.includes(key) ? hidden.filter((k) => k !== key) : [...hidden, key],
    });
  const movePin = (key: string, dir: -1 | 1) => {
    const arr = [...pinned];
    const i = arr.indexOf(key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    update({ catalogsPinned: arr });
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-display text-[24px] font-medium tracking-tight text-ink">
          {t("Manage catalogs")}
        </h2>
        <button
          onClick={onClose}
          className="flex h-10 shrink-0 items-center gap-2 rounded-full border border-edge-soft bg-elevated/40 px-4 text-[13.5px] font-semibold text-ink-muted transition-colors hover:bg-elevated hover:text-ink"
        >
          <X size={15} />
          {t("Done")}
        </button>
      </div>

      {catalogs.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative h-11 w-full max-w-[360px] min-w-0">
            <Search
              size={16}
              className="absolute start-3.5 top-1/2 -translate-y-1/2 text-ink-subtle"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("Search catalogs")}
              spellCheck={false}
              className="h-full w-full rounded-full border border-edge-soft bg-elevated/40 ps-10 pe-9 text-[14px] text-ink outline-none transition-colors placeholder:text-ink-subtle focus:border-edge"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                aria-label={t("Clear")}
                className="absolute end-2.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-ink-subtle transition-colors hover:bg-canvas/60 hover:text-ink"
              >
                <X size={15} />
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip
              label={t("All")}
              active={typeFilter === "all"}
              onClick={() => setTypeFilter("all")}
            />
            {types.map((ty) => (
              <Chip
                key={ty}
                label={t(TYPE_LABELS[ty] ?? ty)}
                active={typeFilter === ty}
                onClick={() => setTypeFilter(ty)}
              />
            ))}
          </div>
          {addons.length > 1 && (
            <AddonFilterSelect addons={addons} value={addonFilter} onChange={setAddonFilter} />
          )}
        </div>
      )}

      {loading && catalogs.length === 0 ? (
        <RowSkeletons />
      ) : catalogs.length === 0 ? (
        <EmptyState onOpenAddons={() => setView("addons")} />
      ) : filtered.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-edge-soft bg-canvas/30 px-6 py-12 text-center text-[13.5px] text-ink-muted">
          {t("No catalogs match your search.")}
        </p>
      ) : (
        <CatalogManageList
          filtered={filtered}
          pinnedCats={pinnedCats}
          pinnedSet={pinnedSet}
          hiddenSet={hiddenSet}
          onTogglePin={togglePin}
          onToggleHide={toggleHide}
          onMovePin={movePin}
        />
      )}
    </div>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`h-9 rounded-full px-3.5 text-[13px] font-semibold transition-colors ${
        active
          ? "bg-ink text-canvas"
          : "bg-elevated/40 text-ink-muted hover:bg-elevated hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}

function RowSkeletons() {
  return (
    <div className="flex flex-col gap-1.5">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="h-[58px] animate-pulse rounded-xl bg-elevated/35" />
      ))}
    </div>
  );
}

function EmptyState({ onOpenAddons }: { onOpenAddons: () => void }) {
  const t = useT();
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-edge-soft bg-canvas/30 px-8 py-16 text-center">
      <Puzzle size={30} strokeWidth={1.6} className="text-ink-subtle" />
      <div className="flex flex-col gap-1">
        <h3 className="text-[17px] font-semibold text-ink">{t("No catalogs yet")}</h3>
        <p className="max-w-md text-[13px] leading-relaxed text-ink-muted">
          {t("Install a Stremio addon and its catalogs show up here, ready to browse.")}
        </p>
      </div>
      <button
        onClick={onOpenAddons}
        className="flex h-10 items-center gap-2 rounded-full bg-ink px-5 text-[13.5px] font-semibold text-canvas transition-opacity hover:opacity-90"
      >
        {t("Browse addons")}
      </button>
    </div>
  );
}
