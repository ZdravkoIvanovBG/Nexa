import { RefreshCw, Trophy } from "lucide-react";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { useSettings } from "@/lib/settings";
import * as api from "@/lib/games/api";
import type { Achievement } from "@/lib/games/types";
import { AchievementBadge } from "./achievement-badge";

export function AchievementsShelf({ gameId }: { gameId: string }) {
  const t = useT();
  const { settings } = useSettings();
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasKey = settings.steamApiKey.trim().length > 0 && settings.steamId64.trim().length > 0;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .gamesAchievementsList(gameId)
      .then((list) => {
        if (alive) setAchievements(list);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [gameId]);

  const refresh = async () => {
    if (!hasKey) return;
    setRefreshing(true);
    setError(null);
    try {
      const list = await api.gamesAchievementsFetch(
        gameId,
        settings.steamApiKey,
        settings.steamId64,
      );
      setAchievements(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) return null;
  if (achievements.length === 0 && !hasKey) return null;

  const unlockedCount = achievements.filter((a) => a.unlocked).length;
  const pct = achievements.length > 0 ? Math.round((unlockedCount / achievements.length) * 100) : 0;

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-edge-soft bg-elevated/40 p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Trophy size={16} className="text-ink-muted" strokeWidth={1.8} />
          <h2 className="text-[15px] font-semibold text-ink">{t("Achievements")}</h2>
          {achievements.length > 0 && (
            <span className="text-[12.5px] text-ink-subtle">
              {unlockedCount} / {achievements.length} ({pct}%)
            </span>
          )}
        </div>
        {hasKey && (
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing}
            className="flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium text-ink-muted transition-colors hover:text-ink disabled:opacity-50"
          >
            <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
            {t("Refresh")}
          </button>
        )}
      </div>

      {achievements.length > 0 && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-canvas">
          <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
        </div>
      )}

      {error && <p className="text-[12px] text-red-400">{error}</p>}

      {achievements.length === 0 ? (
        <p className="text-[13px] text-ink-muted">
          {t(
            "Add your Steam Web API key and SteamID64 in Settings, then refresh to load achievements.",
          )}
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-6">
          {achievements.map((a) => (
            <AchievementBadge key={a.id} achievement={a} />
          ))}
        </div>
      )}
    </section>
  );
}
