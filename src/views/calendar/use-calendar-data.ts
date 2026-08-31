import { useEffect, useState } from "react";
import type { CalendarItem } from "@/lib/calendar";
import { fetchTrackedCalendar } from "@/lib/calendar-sources";
import { subscribeTracking } from "@/lib/library-tracking";
import { subscribeWatchlist } from "@/lib/watchlist";
import type { Settings } from "@/lib/settings";
import { t } from "@/lib/i18n";

type Args = {
  authKey: string | null;
  traktConnected: boolean;
  settings: Settings;
  year: number;
  month: number;
};

/**
 * Upcoming releases scoped to the user's own library: watchlist, Currently
 * Watching and Watched. Re-runs whenever any of those stores changes.
 */
export function useCalendarData({ authKey, traktConnected, settings, year, month }: Args) {
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const bump = () => setRevision((n) => n + 1);
    const offTracking = subscribeTracking(bump);
    const offWatchlist = subscribeWatchlist(bump);
    return () => {
      offTracking();
      offWatchlist();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setLoading(true);
    fetchTrackedCalendar(year, month, {
      tmdbKey: settings.tmdbKey,
      authKey,
      includeTrakt: traktConnected,
    })
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : t("Failed to load"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authKey, traktConnected, settings.tmdbKey, year, month, revision]);

  return { items, loading, error };
}
