import { ArrowRight, Clapperboard, Gamepad2, type LucideIcon } from "lucide-react";
import { useRef, type ComponentType } from "react";
import { useT } from "@/lib/i18n";
import type { LibrarySection } from "@/lib/library-frames";
import { useScrollMemory, useView } from "@/lib/view";
import { LIBRARY_ART } from "./library-chooser/art";
import { GameScene, MovieScene } from "./library-chooser/scenes";

type Choice = {
  section: LibrarySection;
  kicker: string;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  scene: ComponentType;
};

const CHOICES: Choice[] = [
  {
    section: "movies",
    kicker: "Movies & shows",
    title: "Movie Library",
    subtitle: "Watchlist, progress and rankings.",
    icon: Clapperboard,
    scene: MovieScene,
  },
  {
    section: "games",
    kicker: "Games",
    title: "Game Library",
    subtitle: "Play queue, progress and rankings.",
    icon: Gamepad2,
    scene: GameScene,
  },
];

function LibraryCard({ choice, index }: { choice: Choice; index: number }) {
  const t = useT();
  const { openLibrarySection } = useView();
  const { icon: Icon, scene: Scene } = choice;
  const art = LIBRARY_ART[choice.section];
  return (
    <div className="animate-step-in" style={{ animationDelay: `${index * 70}ms` }}>
      <button
        type="button"
        onClick={() => openLibrarySection(choice.section)}
        data-no-card-ring
        data-tv-initial-focus={index === 0 ? "" : undefined}
        className="group relative isolate block w-full overflow-hidden rounded-[20px] bg-surface text-start shadow-[0_18px_50px_-24px_rgba(0,0,0,0.75)] ring-1 ring-white/[0.08] transition-[box-shadow,transform] duration-500 ease-out outline-none hover:shadow-[0_36px_80px_-28px_rgba(0,0,0,0.9)] hover:ring-white/20 focus-visible:ring-2 focus-visible:ring-accent md:h-[clamp(320px,calc(100vh-290px),760px)] motion-safe:hover:-translate-y-1 motion-safe:focus-visible:-translate-y-1"
      >
        {/* Stacked cards keep their shape with padding rather than aspect-ratio:
            see the note on ASPECT_PAD in poster.tsx. Side by side, they fill the window. */}
        <div aria-hidden className="md:hidden" style={{ paddingTop: "62.5%" }} />
        <div className="absolute inset-0 transition-transform duration-900 ease-out motion-safe:group-hover:scale-[1.035] motion-safe:group-focus-visible:scale-[1.035]">
          {art ? (
            <img
              src={art}
              alt=""
              draggable={false}
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            <Scene />
          )}
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/25 via-40% to-transparent" />
        <div className="absolute inset-0 bg-black/0 transition-colors duration-500 group-hover:bg-white/[0.03]" />

        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-5 p-6 lg:p-8">
          <span className="flex min-w-0 flex-col gap-2">
            <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.24em] text-white/70">
              <Icon size={14} strokeWidth={2.2} />
              {t(choice.kicker)}
            </span>
            <span className="font-display text-[clamp(28px,3vw,44px)] font-medium leading-[1.05] text-white">
              {t(choice.title)}
            </span>
            <span className="line-clamp-2 max-w-[42ch] text-[14px] leading-snug text-white/70">
              {t(choice.subtitle)}
            </span>
          </span>
          <span
            aria-hidden
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10 text-white ring-1 ring-white/15 backdrop-blur-sm transition-[background-color,color,transform] duration-300 group-hover:bg-white group-hover:text-black group-focus-visible:bg-white group-focus-visible:text-black motion-safe:group-hover:translate-x-0.5"
          >
            <ArrowRight size={18} strokeWidth={2.2} className="dir-icon" />
          </span>
        </div>
      </button>
    </div>
  );
}

/** What My Library opens while Games is on. Nothing on this screen depends on RAWG. */
export function LibraryChooser({ active }: { active: boolean }) {
  const t = useT();
  const scrollRef = useRef<HTMLElement>(null);
  useScrollMemory("library-hub", scrollRef, active);

  return (
    <main
      ref={scrollRef}
      className="flex-1 overflow-y-auto px-5 pt-24 pb-14 sm:px-8 lg:px-12 lg:pt-28"
    >
      <div data-tauri-drag-region className="mx-auto flex max-w-[1500px] flex-col gap-8">
        <header className="flex flex-col gap-1.5">
          <span className="text-[11px] font-bold uppercase tracking-[0.28em] text-ink-subtle">
            {t("My library")}
          </span>
          <h1 className="font-display text-[44px] font-medium leading-[1.05] text-ink">
            {t("Choose a library.")}
          </h1>
        </header>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:gap-7">
          {CHOICES.map((choice, index) => (
            <LibraryCard key={choice.section} choice={choice} index={index} />
          ))}
        </div>
      </div>
    </main>
  );
}
