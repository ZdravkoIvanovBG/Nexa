import { ArrowLeft, Clock, FolderOpen, Gamepad2, ImagePlus, Play, Square } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { layoutHasGlobalBack } from "@/lib/theme";
import { useView } from "@/lib/view";
import { useGames } from "@/lib/games/provider";
import { gameAssetSrc } from "@/lib/games/asset-src";
import { formatPlaytime, lastPlayedRelative } from "@/lib/games/format";
import { gamesForceStop } from "@/lib/games/api";

const ArtworkPickerModal = lazy(() =>
  import("./artwork-picker-modal").then((m) => ({ default: m.ArtworkPickerModal })),
);
const AchievementsShelf = lazy(() =>
  import("./achievements-shelf").then((m) => ({ default: m.AchievementsShelf })),
);

export function GameDetailView({ gameId }: { gameId: string }) {
  const t = useT();
  const { goBack } = useView();
  const { games, activeSessions, launch, removeGame } = useGames();
  const [artworkOpen, setArtworkOpen] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [brokenHero, setBrokenHero] = useState<string | null>(null);

  const game = games.find((g) => g.id === gameId);
  const activeSession = [...activeSessions.values()].find((s) => s.gameId === gameId);

  useEffect(() => {
    setError(null);
  }, [gameId]);

  if (!game) {
    return (
      <main className="absolute inset-0 z-30 flex items-center justify-center bg-canvas">
        <p className="text-[13px] text-ink-subtle">{t("Game not found.")}</p>
      </main>
    );
  }

  // Same as the library card: a launcher's remote artwork url may not resolve,
  // so fall back to the placeholder instead of a broken image.
  const heroSrc = gameAssetSrc(game.heroPath ?? game.coverPath);
  const hero = heroSrc && heroSrc !== brokenHero ? heroSrc : undefined;

  const onLaunch = async () => {
    setLaunching(true);
    setError(null);
    try {
      await launch(game.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLaunching(false);
    }
  };

  const onStop = async () => {
    if (!activeSession) return;
    try {
      await gamesForceStop(activeSession.sessionId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <main className="absolute inset-0 z-30 overflow-y-auto bg-canvas">
      <section className="relative h-[46vh] min-h-[320px] w-full overflow-hidden">
        {hero ? (
          <img
            src={hero}
            alt=""
            draggable={false}
            onError={() => setBrokenHero(hero)}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-elevated to-canvas">
            <Gamepad2 size={64} className="text-ink-subtle/40" strokeWidth={1.2} />
          </div>
        )}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-canvas via-canvas/40 to-transparent" />
        {!layoutHasGlobalBack() && (
          <button
            onClick={goBack}
            aria-label={t("Back")}
            className="absolute start-6 top-6 flex h-10 w-10 items-center justify-center rounded-full bg-canvas/70 text-ink backdrop-blur-sm transition-colors hover:bg-canvas"
          >
            <ArrowLeft size={18} strokeWidth={2.2} />
          </button>
        )}
        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1 px-8 pb-6">
          <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-subtle">
            {game.platform}
          </span>
          <h1 className="font-display text-[clamp(30px,4vw,48px)] font-semibold leading-[1.05] text-ink drop-shadow-[0_4px_18px_rgba(0,0,0,0.5)]">
            {game.title}
          </h1>
          {game.developer && <p className="text-[13.5px] text-ink-muted">{game.developer}</p>}
        </div>
      </section>

      <div className="flex flex-col gap-8 px-8 pb-24 pt-7">
        <div className="flex flex-wrap items-center gap-3">
          {activeSession ? (
            <button
              data-tv-initial-focus
              onClick={onStop}
              className="flex h-12 items-center gap-2 rounded-full bg-elevated px-6 text-[14px] font-semibold text-ink ring-1 ring-edge-soft transition-colors hover:bg-raised"
            >
              <Square size={15} strokeWidth={2.2} />
              {t("Stop")}
            </button>
          ) : (
            <button
              data-tv-initial-focus
              onClick={onLaunch}
              disabled={launching}
              className="flex h-12 items-center gap-2 rounded-full bg-ink px-6 text-[14px] font-semibold text-canvas transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <Play size={15} strokeWidth={2.2} fill="currentColor" />
              {launching ? t("Launching…") : t("Launch")}
            </button>
          )}
          <button
            onClick={() => setArtworkOpen(true)}
            className="flex h-12 items-center gap-2 rounded-full bg-elevated px-5 text-[13.5px] font-medium text-ink-muted ring-1 ring-edge-soft transition-colors hover:text-ink"
          >
            <ImagePlus size={14} />
            {t("Change Artwork")}
          </button>
          <button
            onClick={() => void removeGame(game.id)}
            className="flex h-12 items-center gap-2 rounded-full px-5 text-[13.5px] font-medium text-ink-subtle transition-colors hover:text-red-400"
          >
            {t("Remove")}
          </button>
        </div>

        {error && <p className="text-[12.5px] text-red-400">{error}</p>}

        <div className="flex flex-wrap gap-6 rounded-2xl border border-edge-soft bg-elevated/40 p-6">
          <Stat icon={<Clock size={14} />} label={t("Playtime")}>
            {formatPlaytime(game.totalPlaytimeMinutes)}
          </Stat>
          <Stat icon={<Clock size={14} />} label={t("Last played")}>
            {game.lastPlayedAt ? lastPlayedRelative(game.lastPlayedAt) : t("Never")}
          </Stat>
          {game.installDir && (
            <Stat icon={<FolderOpen size={14} />} label={t("Install directory")}>
              <span className="max-w-[280px] truncate">{game.installDir}</span>
            </Stat>
          )}
        </div>

        {game.platform === "steam" && game.externalId && (
          <Suspense fallback={null}>
            <AchievementsShelf gameId={game.id} />
          </Suspense>
        )}
      </div>

      {artworkOpen && (
        <Suspense fallback={null}>
          <ArtworkPickerModal
            gameId={game.id}
            gameTitle={game.title}
            platform={game.platform}
            externalId={game.externalId}
            onClose={() => setArtworkOpen(false)}
          />
        </Suspense>
      )}
    </main>
  );
}

function Stat({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
        {icon}
        {label}
      </span>
      <span className="text-[15px] font-medium text-ink">{children}</span>
    </div>
  );
}
