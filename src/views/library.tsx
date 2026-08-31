import { Bookmark, PlayCircle, Trophy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import traktLogo from "@/assets/trakt.svg";
import simklLogo from "@/assets/simkl.png";
import letterboxdLogo from "@/assets/addon-logos/letterboxd.png";
import { useSimkl } from "@/lib/simkl/provider";
import { useTrakt } from "@/lib/trakt/provider";
import { useScrollMemory } from "@/lib/view";
import { useT } from "@/lib/i18n";
import { useLetterboxd } from "@/lib/stremboxd/provider";
import { TabBtn, type Tab } from "./library/shared";
import { SimklTab } from "./library/simkl-tab";
import { TraktTab } from "./library/trakt-tab";
import { WatchlistTab } from "./library/watchlist-tab";
import { WatchingTab } from "./library/watching-tab";
import { TierListTab } from "./library/tier-list-tab";
import { LetterboxdTab } from "./library/letterboxd-tab";
import { pushActivityHint } from "@/lib/discord/activity-hint";

const LIBRARY_TAB_KEY = "harbor.library.tab";

function readSavedTab(): Tab {
  try {
    const v = localStorage.getItem(LIBRARY_TAB_KEY);
    if (
      v === "watchlist" ||
      v === "watching" ||
      v === "tiers" ||
      v === "trakt" ||
      v === "simkl" ||
      v === "letterboxd"
    )
      return v;
  } catch {}
  return "watchlist";
}

export function LibraryView({ active }: { active: boolean }) {
  const [tab, setTab] = useState<Tab>(readSavedTab);
  const { isConnected: traktConnected } = useTrakt();
  const { isConnected: simklConnected } = useSimkl();
  const lb = useLetterboxd();
  const scrollRef = useRef<HTMLElement>(null);
  useScrollMemory("library", scrollRef, active);

  useEffect(() => {
    try {
      localStorage.setItem(LIBRARY_TAB_KEY, tab);
    } catch {}
  }, [tab]);

  useEffect(() => {
    if (tab === "trakt" && !traktConnected) setTab("watchlist");
  }, [tab, traktConnected]);

  useEffect(() => {
    if (tab === "simkl" && !simklConnected) setTab("watchlist");
  }, [tab, simklConnected]);

  useEffect(() => {
    if (tab === "letterboxd" && !lb.isActive) setTab("watchlist");
  }, [tab, lb.isActive]);

  useEffect(() => {
    if (!active) return;
    const label =
      tab === "watchlist"
        ? "Browsing their watchlist"
        : tab === "watching"
          ? "Browsing what they're watching"
          : tab === "tiers"
            ? "Ranking their tier list"
            : tab === "trakt"
              ? "Browsing their Trakt library"
              : tab === "simkl"
                ? "Browsing their Simkl library"
                : tab === "letterboxd"
                  ? "Browsing their Letterboxd library"
                  : "Browsing their Stremio library";
    return pushActivityHint({ details: label, state: "Library" });
  }, [active, tab]);

  return (
    <main
      ref={scrollRef}
      className="flex-1 overflow-y-auto px-5 pt-24 pb-14 sm:px-8 lg:px-12 lg:pt-28"
    >
      <div data-tauri-drag-region className="flex flex-col gap-7">
        <Header
          tab={tab}
          onTab={setTab}
          traktConnected={traktConnected}
          simklConnected={simklConnected}
          lbConnected={lb.isActive}
        />
        {tab === "watchlist" && <WatchlistTab />}
        {tab === "watching" && <WatchingTab />}
        {tab === "tiers" && <TierListTab />}
        {tab === "trakt" && traktConnected && <TraktTab />}
        {tab === "simkl" && simklConnected && <SimklTab />}
        {tab === "letterboxd" && lb.isActive && <LetterboxdTab />}
      </div>
    </main>
  );
}

function Header({
  tab,
  onTab,
  traktConnected,
  simklConnected,
  lbConnected,
}: {
  tab: Tab;
  onTab: (t: Tab) => void;
  traktConnected: boolean;
  simklConnected: boolean;
  lbConnected: boolean;
}) {
  const t = useT();
  return (
    <header className="flex flex-col gap-5">
      <div className="flex items-end justify-between gap-6">
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-bold uppercase tracking-[0.28em] text-ink-subtle">
            {t("My library")}
          </span>
          <h1 className="font-display text-[44px] font-medium leading-[1.05] text-ink">
            {t("Your collection.")}
          </h1>
          <p className="text-[14px] leading-snug text-ink-muted">
            {t(
              "Watchlist is what you've saved for later. Currently Watching tracks where you are in a series. Tier List is how you rank what you've finished.",
            )}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1 border-b border-edge-soft">
        <TabBtn active={tab === "watchlist"} onClick={() => onTab("watchlist")}>
          <Bookmark size={14} strokeWidth={2.2} />
          {t("Watchlist")}
        </TabBtn>
        <TabBtn active={tab === "watching"} onClick={() => onTab("watching")}>
          <PlayCircle size={14} strokeWidth={2.2} />
          {t("Currently Watching")}
        </TabBtn>
        <TabBtn active={tab === "tiers"} onClick={() => onTab("tiers")}>
          <Trophy size={14} strokeWidth={2.2} />
          {t("Tier List")}
        </TabBtn>
        {traktConnected && (
          <TabBtn active={tab === "trakt"} onClick={() => onTab("trakt")}>
            <img src={traktLogo} alt="" className="h-3.5 w-3.5 object-contain" />
            Trakt
          </TabBtn>
        )}
        {simklConnected && (
          <TabBtn active={tab === "simkl"} onClick={() => onTab("simkl")}>
            <img src={simklLogo} alt="" className="h-3.5 w-3.5 object-contain" />
            Simkl
          </TabBtn>
        )}
        {lbConnected && (
          <TabBtn active={tab === "letterboxd"} onClick={() => onTab("letterboxd")}>
            <img src={letterboxdLogo} alt="" className="h-3.5 w-3.5 rounded-[3px] object-contain" />
            Letterboxd
          </TabBtn>
        )}
      </div>
    </header>
  );
}
