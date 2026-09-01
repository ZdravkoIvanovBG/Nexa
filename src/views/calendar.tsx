import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  applyCalendarFilter,
  groupByDate,
  todayLocalISO,
  type CalendarFilter,
  type CalendarItem,
} from "@/lib/calendar";
import { CalendarSkeleton } from "./calendar/calendar-skeleton";
import { useCalendarData } from "./calendar/use-calendar-data";
import { useSettings } from "@/lib/settings";
import { useTrakt } from "@/lib/trakt/provider";
import { useScrollMemory, useView } from "@/lib/view";
import { useT } from "@/lib/i18n";
import { DayModal } from "./calendar/day-modal";
import { EmptyState, ErrorState } from "./calendar/empty-states";
import { MonthGrid } from "./calendar/month-grid";
import {
  buildMonthCells,
  calendarEpisodeHint,
  calendarToMeta,
  FILTERS,
  MONTH_NAMES,
} from "./calendar/utils";

export function CalendarView() {
  const t = useT();
  const { settings, update } = useSettings();
  const { openMeta } = useView();
  const today = useMemo(() => new Date(), []);
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [filter, setFilter] = useState<CalendarFilter>("all");
  const scrollRef = useRef<HTMLDivElement>(null);
  useScrollMemory("calendar", scrollRef);
  const [dayModal, setDayModal] = useState<string | null>(null);

  const { isConnected: traktConnected } = useTrakt();

  const { items, loading, error } = useCalendarData({
    traktConnected,
    settings,
    year,
    month,
  });

  const filtered = useMemo(() => applyCalendarFilter(items, filter), [items, filter]);

  const grouped = useMemo(() => groupByDate(filtered), [filtered]);
  const cells = useMemo(
    () => buildMonthCells(year, month, settings.weekStartsMonday),
    [year, month, settings.weekStartsMonday],
  );

  const openItem = useCallback(
    (item: CalendarItem) => {
      openMeta(calendarToMeta(item), { episodeHint: calendarEpisodeHint(item) ?? undefined });
    },
    [openMeta],
  );

  const goPrev = () => {
    if (month === 0) {
      setMonth(11);
      setYear((y) => y - 1);
    } else {
      setMonth((m) => m - 1);
    }
  };
  const goNext = () => {
    if (month === 11) {
      setMonth(0);
      setYear((y) => y + 1);
    } else {
      setMonth((m) => m + 1);
    }
  };
  const goToday = () => {
    setYear(today.getFullYear());
    setMonth(today.getMonth());
  };

  const todayISO = todayLocalISO();
  const dayModalItems = dayModal ? (grouped.get(dayModal) ?? []) : [];

  let body: React.ReactNode;
  if (error) {
    body = <ErrorState message={error} />;
  } else if (loading && filtered.length === 0) {
    body = <CalendarSkeleton />;
  } else if (filtered.length === 0) {
    body = <EmptyState filter={filter} />;
  } else {
    body = (
      <MonthGrid
        cells={cells}
        grouped={grouped}
        todayISO={todayISO}
        weekStartsMonday={settings.weekStartsMonday}
        onOpenItem={openItem}
        onOpenDay={(iso) => setDayModal(iso)}
      />
    );
  }

  return (
    <main className="flex h-full flex-col overflow-hidden">
      <header className="shrink-0 border-b border-edge-soft px-12 pb-5 pt-24">
        <div className="flex items-end justify-between gap-6">
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-bold uppercase tracking-[0.32em] text-ink-subtle">
              {t("Releases")}
            </span>
            <h1 className="font-display text-[44px] font-medium leading-none tracking-tight text-ink">
              {t("Calendar")}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={goPrev}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-edge-soft text-ink-muted transition-colors hover:border-edge hover:text-ink"
              aria-label={t("Previous month")}
            >
              <ChevronLeft size={16} strokeWidth={2.2} className="dir-icon" />
            </button>
            <button
              onClick={goToday}
              className="h-10 rounded-full border border-edge-soft px-4 text-[13px] font-semibold text-ink-muted transition-colors hover:border-edge hover:text-ink"
            >
              {t("Today")}
            </button>
            <div className="flex h-10 min-w-[150px] items-center justify-center gap-2 rounded-full border border-edge-soft px-5 text-[14px] font-semibold text-ink">
              <CalendarIcon size={14} strokeWidth={2} className="text-ink-subtle" />
              {t(MONTH_NAMES[month])} {year}
            </div>
            <button
              onClick={goNext}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-edge-soft text-ink-muted transition-colors hover:border-edge hover:text-ink"
              aria-label={t("Next month")}
            >
              <ChevronRight size={16} strokeWidth={2.2} className="dir-icon" />
            </button>
          </div>
        </div>
        <nav className="mt-6 flex flex-wrap items-center gap-3">
          <button
            onClick={() => update({ weekStartsMonday: !settings.weekStartsMonday })}
            className={`rounded-full px-4 py-1.5 text-[12.5px] font-semibold transition-colors ${
              settings.weekStartsMonday
                ? "bg-ink text-canvas"
                : "border border-edge-soft text-ink-muted hover:border-edge hover:text-ink"
            }`}
          >
            {t("Start week on Monday")}
          </button>
          <span className="mx-1 h-5 w-px bg-edge-soft" />
          <div className="flex flex-wrap items-center gap-2">
            {FILTERS.map((f) => {
              const active = filter === f.id;
              const count = f.id === "all" ? items.length : applyCalendarFilter(items, f.id).length;
              return (
                <button
                  key={f.id}
                  onClick={() => setFilter(f.id)}
                  className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors ${
                    active
                      ? "bg-ink text-canvas"
                      : "border border-edge-soft text-ink-muted hover:border-edge hover:text-ink"
                  }`}
                >
                  {t(f.label)}
                  <span
                    className={`text-[11px] tabular-nums ${
                      active ? "text-canvas/65" : "text-ink-subtle"
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </nav>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-12 py-8">
        {body}
      </div>

      {dayModal && dayModalItems.length > 0 && (
        <DayModal
          dateISO={dayModal}
          items={dayModalItems}
          onClose={() => setDayModal(null)}
          onOpenItem={(it) => {
            setDayModal(null);
            openItem(it);
          }}
        />
      )}
    </main>
  );
}
