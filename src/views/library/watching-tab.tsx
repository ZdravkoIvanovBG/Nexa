import { PlayCircle } from "lucide-react";
import { useWatching } from "@/lib/library-tracking";
import { useT } from "@/lib/i18n";
import { WatchingCard } from "./watching-card";

export function WatchingTab() {
  const t = useT();
  const entries = useWatching();

  if (entries.length === 0) return <EmptyWatching />;

  return (
    <section className="flex flex-col gap-5">
      <span className="text-[12px] tabular-nums text-ink-muted">
        {t("{n} in progress", { n: entries.length })}
      </span>
      <div className="grid gap-4 xl:grid-cols-2">
        {entries.map((entry) => (
          <WatchingCard key={entry.id} entry={entry} />
        ))}
      </div>
    </section>
  );
}

function EmptyWatching() {
  const t = useT();
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-edge-soft bg-canvas/30 px-8 py-20 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-elevated/60 text-ink-subtle ring-1 ring-edge-soft/60">
        <PlayCircle size={24} strokeWidth={1.6} />
      </span>
      <div className="flex flex-col gap-1.5">
        <h2 className="font-display text-[20px] font-medium text-ink">
          {t("Nothing in progress")}
        </h2>
        <p className="max-w-sm text-[13px] leading-relaxed text-ink-muted">
          {t(
            "Open a show and hit the eye button on its detail page to start tracking where you are.",
          )}
        </p>
      </div>
    </div>
  );
}
