import { ArrowLeft } from "lucide-react";
import { PickCard } from "@/components/pick-card";
import { useT } from "@/lib/i18n";
import { sortByYearDesc } from "@/lib/meta-sort";
import { useGridPaging } from "@/lib/use-grid-paging";
import type { GridSpec } from "@/lib/view";

/** Same responsive poster grid as collection.tsx / cinemeta-fallback.tsx. */
const GRID = "grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7";

/**
 * Browse results rendered inline on Discover in place of the hero and rails.
 * Addons page in their own order, so newest-first can only hold over what has
 * actually loaded — the list is re-sorted on every append.
 */
export function CatalogResults({
  spec,
  title,
  onClear,
}: {
  spec: GridSpec;
  title: string;
  onClear: () => void;
}) {
  const t = useT();
  const { metas, done, sentinelRef } = useGridPaging(spec, {
    transform: sortByYearDesc,
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <button
          onClick={onClear}
          aria-label={t("Back to Discover")}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-elevated text-ink-muted transition-colors hover:text-ink"
        >
          <ArrowLeft size={18} strokeWidth={2.2} />
        </button>
        <h2 className="min-w-0 truncate font-display text-[26px] font-medium leading-none tracking-tight text-ink">
          {title}
        </h2>
        <span className="shrink-0 text-[13px] text-ink-subtle">
          {metas.length} {metas.length === 1 ? t("title") : t("titles")} · {t("Newest first")}
        </span>
        <button
          onClick={onClear}
          className="ms-auto flex h-10 shrink-0 items-center rounded-full border border-edge-soft bg-elevated/40 px-4 text-[13.5px] font-semibold text-ink-muted transition-colors hover:bg-elevated hover:text-ink"
        >
          {t("Back to Discover")}
        </button>
      </div>

      <div className={GRID}>
        {metas.map((m) => (
          <PickCard key={m.id} meta={m} />
        ))}
      </div>
      {!done && <div ref={sentinelRef} className="h-24" />}
      {done && metas.length === 0 && (
        <p className="py-20 text-center text-[14px] text-ink-subtle">
          {t("Nothing in this catalog yet.")}
        </p>
      )}
    </div>
  );
}
