import { GAME_GENRE_TILES } from "@/lib/game-discovery/sections";
import { useT } from "@/lib/i18n";
import { useView } from "@/lib/view";

/** Static genre tiles: no request until the Browse view they open loads. */
export function GameGenreTiles() {
  const t = useT();
  const { openGameBrowse } = useView();
  return (
    <section className="flex flex-col gap-4">
      <h3 className="text-[17px] font-medium tracking-tight text-ink">{t("Browse by genre")}</h3>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {GAME_GENRE_TILES.map((tile) => (
          <button
            key={tile.title}
            onClick={() =>
              openGameBrowse({ title: tile.title, kicker: t("Genre"), filter: tile.filter })
            }
            className="group relative aspect-[5/2] w-full cursor-pointer overflow-hidden rounded-2xl border border-edge-soft text-start transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0.24,1)] hover:-translate-y-1"
            style={{
              background: `linear-gradient(135deg, oklch(0.46 0.14 ${tile.hue}), oklch(0.2 0.07 ${tile.hue}))`,
            }}
          >
            <div
              aria-hidden
              className="absolute inset-0 bg-[radial-gradient(circle_at_85%_15%,rgba(255,255,255,0.18),transparent_55%)]"
            />
            <div className="absolute inset-x-4 bottom-3.5 flex items-end justify-between">
              <span className="font-display text-[22px] font-medium leading-tight tracking-tight text-white drop-shadow-[0_2px_18px_rgba(0,0,0,0.4)]">
                {t(tile.title)}
              </span>
              <span
                aria-hidden
                className="dir-icon text-[16px] text-white/80 transition-transform duration-200 group-hover:translate-x-1 rtl:group-hover:-translate-x-1"
              >
                →
              </span>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
