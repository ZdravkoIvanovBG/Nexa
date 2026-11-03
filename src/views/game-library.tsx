import { Gamepad2, ListOrdered, TriangleAlert, Trophy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { pushActivityHint } from "@/lib/discord/activity-hint";
import { requestGameLibrarySync } from "@/lib/game-library/cloud/sync";
import { useGameLibraryUnsaved } from "@/lib/game-library/store";
import { useT } from "@/lib/i18n";
import { useScrollMemory, useView } from "@/lib/view";
import { RawgAttribution } from "./game-discovery/rawg-attribution";
import { PlayingEmpty, TierListEmpty } from "./game-library/empty-states";
import { onTabRequest, readSavedTab, saveTab, type GameLibraryTab } from "./game-library/tab";
import { WishlistTab } from "./game-library/wishlist-tab";
import { TabBtn } from "./library/shared";

const ACTIVITY: Record<GameLibraryTab, string> = {
  wishlist: "Planning what to play next",
  playing: "Checking their current games",
  tiers: "Ranking their games",
};

/**
 * The Game Library. Unlike the Discovery pages this isn't wrapped in GamesFrame,
 * which hides its content until a RAWG key checks out: this page belongs to the
 * user, so it opens whatever state RAWG is in, and it sends RAWG no requests.
 * Saved art loads from RAWG's image host like any other picture, and falls
 * back to a plain plate when it can't.
 */
export function GameLibraryView({
  active,
  backFloatsOverPage,
}: {
  active: boolean;
  backFloatsOverPage: boolean;
}) {
  const t = useT();
  const { setView } = useView();
  const [tab, setTab] = useState<GameLibraryTab>(readSavedTab);
  const scrollRef = useRef<HTMLElement>(null);
  useScrollMemory("game-library", scrollRef, active);

  useEffect(() => saveTab(tab), [tab]);
  useEffect(() => onTabRequest(setTab), []);

  // Picks up edits from other devices. Throttled, and never a timer.
  useEffect(() => {
    if (!active) return;
    requestGameLibrarySync();
    window.addEventListener("focus", requestGameLibrarySync);
    return () => window.removeEventListener("focus", requestGameLibrarySync);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    return pushActivityHint({ details: ACTIVITY[tab], state: "Game Library" });
  }, [active, tab]);

  return (
    <main
      ref={scrollRef}
      className={`flex flex-1 flex-col overflow-y-auto px-5 pb-10 sm:px-8 lg:px-12 ${
        backFloatsOverPage ? "pt-40" : "pt-24 lg:pt-28"
      }`}
    >
      <div data-tauri-drag-region className="flex flex-1 flex-col gap-7">
        <header className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <nav
              aria-label={t("Breadcrumb")}
              className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.28em] text-ink-subtle"
            >
              <button
                type="button"
                onClick={() => setView("library")}
                className="uppercase tracking-[0.28em] transition-colors hover:text-ink"
              >
                {t("My library")}
              </button>
              <span aria-hidden className="opacity-50">
                /
              </span>
              <span aria-current="page" className="text-ink-muted">
                {t("Game Library")}
              </span>
            </nav>
            <h1 className="font-display text-[44px] font-medium leading-[1.05] text-ink">
              {t("Your gaming journey.")}
            </h1>
            <p className="text-[14px] leading-snug text-ink-muted">
              {t("Plan what to play, track your adventures, and rank your favorites.")}
            </p>
          </div>
          <div className="flex items-center gap-1 border-b border-edge-soft">
            <TabBtn active={tab === "wishlist"} onClick={() => setTab("wishlist")}>
              <ListOrdered size={14} strokeWidth={2.2} />
              {t("Wishlist")}
            </TabBtn>
            <TabBtn active={tab === "playing"} onClick={() => setTab("playing")}>
              <Gamepad2 size={14} strokeWidth={2.2} />
              {t("Currently Playing")}
            </TabBtn>
            <TabBtn active={tab === "tiers"} onClick={() => setTab("tiers")}>
              <Trophy size={14} strokeWidth={2.2} />
              {t("Tier List")}
            </TabBtn>
          </div>
        </header>
        <UnsavedWarning />
        {tab === "wishlist" && <WishlistTab active={active} />}
        {tab === "playing" && <PlayingEmpty />}
        {tab === "tiers" && <TierListEmpty />}
        <footer className="mt-auto pt-6">
          <RawgAttribution />
        </footer>
      </div>
    </main>
  );
}

/** Shown while the disk refuses to save the library, so nothing is lost silently. */
function UnsavedWarning() {
  const t = useT();
  const unsaved = useGameLibraryUnsaved();
  if (!unsaved) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-2xl bg-amber-400/[0.08] px-4 py-3.5 text-[13px] leading-relaxed text-ink ring-1 ring-amber-400/25"
    >
      <TriangleAlert size={17} strokeWidth={2.2} className="mt-0.5 shrink-0 text-amber-300" />
      <p>
        <span className="font-semibold">
          {t("Your latest Game Library changes aren't saved on this device.")}
        </span>{" "}
        {t(
          "This device's storage is full. While you're signed in and online they still upload to your account, but anything that hasn't uploaded is lost when Nexa closes. Free up space, then make any change to save again.",
        )}
      </p>
    </div>
  );
}
