import { Trophy } from "lucide-react";
import type { Achievement } from "@/lib/games/types";

export function AchievementBadge({ achievement }: { achievement: Achievement }) {
  const icon = achievement.unlocked ? achievement.iconUrl : achievement.iconGrayUrl;
  return (
    <div
      className={`flex flex-col items-center gap-1.5 rounded-xl p-2.5 text-center ring-1 transition-opacity ${
        achievement.unlocked
          ? "bg-elevated ring-edge-soft"
          : "bg-canvas/40 opacity-55 ring-edge-soft/60"
      }`}
      title={achievement.description ?? achievement.displayName}
    >
      {icon ? (
        <img src={icon} alt="" className="h-12 w-12 rounded-md object-cover" />
      ) : (
        <div className="flex h-12 w-12 items-center justify-center rounded-md bg-canvas text-ink-subtle">
          <Trophy size={18} strokeWidth={1.6} />
        </div>
      )}
      <span className="line-clamp-2 text-[10.5px] font-medium leading-tight text-ink">
        {achievement.displayName}
      </span>
      {achievement.globalPercent != null && (
        <span className="text-[9.5px] text-ink-subtle">
          {achievement.globalPercent.toFixed(1)}%
        </span>
      )}
    </div>
  );
}
