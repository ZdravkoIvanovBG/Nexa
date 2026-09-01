import { ContinueCard } from "@/components/continue-card";
import { Row } from "@/components/row";
import { useT } from "@/lib/i18n";
import type { LibraryItem } from "@/lib/library-item";
import { isLibraryItemWatched } from "@/lib/trakt/library-key";

type Props = {
  items: LibraryItem[];
  watchedSet?: Set<string>;
  onDismiss: (item: LibraryItem) => void;
};

export function CWSection({ items, watchedSet, onDismiss }: Props) {
  const t = useT();

  if (items.length > 0) {
    return (
      <Row title={t("Continue Watching")} min={260} shape="landscape" scrollKey="home:cw">
        {items.map((item) => (
          <ContinueCard
            key={item._id}
            item={item}
            watched={watchedSet ? isLibraryItemWatched(item, watchedSet) : false}
            onDismiss={onDismiss}
          />
        ))}
      </Row>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-[17px] font-medium tracking-tight text-ink">{t("Continue Watching")}</h3>
      <div className="flex items-center justify-center rounded-2xl border border-dashed border-edge px-6 py-14 text-center">
        <p className="text-[15.5px] leading-relaxed text-ink-muted">
          {t("Nothing in progress yet. Press Play on something.")}
        </p>
      </div>
    </div>
  );
}
