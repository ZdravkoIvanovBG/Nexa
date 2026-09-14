import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { DebridKey, LibraryKey } from "./settings/api-keys-panel";
import { SettingsNav } from "./settings/nav";
import { SettingsJumpBar } from "./settings/jump-bar";
import type { RelayMode } from "./settings/relay-section";
import { resolveSettingsSection, SettingsActiveContext, type SectionId } from "./settings/shared";
import { BackToTop } from "@/components/back-to-top";
import { resetOmdbBudget } from "@/lib/providers/omdb";
import { useSettings } from "@/lib/settings";
import { useView } from "@/lib/view";
import { useT } from "@/lib/i18n";

const IS_WEB = typeof window !== "undefined" && !("__TAURI_INTERNALS__" in window);

const AccountStub = lazy(() =>
  import("./settings/account").then((m) => ({ default: m.AccountStub })),
);
const AdvancedPanel = lazy(() =>
  import("./settings/advanced-panel").then((m) => ({ default: m.AdvancedPanel })),
);
const BasicsPanel = lazy(() =>
  import("./settings/basics-panel").then((m) => ({ default: m.BasicsPanel })),
);
const BugReportPanel = lazy(() =>
  import("./settings/bug-report-panel").then((m) => ({ default: m.BugReportPanel })),
);
const LibraryPanel = lazy(() =>
  import("./settings/library-panel").then((m) => ({ default: m.LibraryPanel })),
);
const ApiKeysPanel = lazy(() =>
  import("./settings/api-keys-panel").then((m) => ({ default: m.ApiKeysPanel })),
);
const LanguagePanel = lazy(() =>
  import("./settings/language-panel").then((m) => ({ default: m.LanguagePanel })),
);
const HotkeysPanel = lazy(() =>
  import("./settings/hotkeys-panel").then((m) => ({ default: m.HotkeysPanel })),
);
const PlayerLayoutPanel = lazy(() =>
  import("./settings/player-layout-panel").then((m) => ({ default: m.PlayerLayoutPanel })),
);
const QualityPanel = lazy(() =>
  import("./settings/quality-panel").then((m) => ({ default: m.QualityPanel })),
);
const MpvPanel = lazy(() => import("./settings/mpv-panel").then((m) => ({ default: m.MpvPanel })));
const P2PPanel = lazy(() => import("./settings/p2p-panel").then((m) => ({ default: m.P2PPanel })));
const SmoothingPanel = lazy(() =>
  import("./settings/smoothing-panel").then((m) => ({ default: m.SmoothingPanel })),
);
const TraktPanel = lazy(() =>
  import("./settings/trakt-panel").then((m) => ({ default: m.TraktPanel })),
);
const SimklPanel = lazy(() =>
  import("./settings/simkl-panel").then((m) => ({ default: m.SimklPanel })),
);
const LetterboxdPanel = lazy(() =>
  import("./settings/letterboxd-panel").then((m) => ({ default: m.LetterboxdPanel })),
);
const RelaySection = lazy(() =>
  import("./settings/relay-section").then((m) => ({ default: m.RelaySection })),
);
const StreamingSourcesPanel = lazy(() =>
  import("./settings/streaming-sources-panel").then((m) => ({ default: m.StreamingSourcesPanel })),
);
const StreamFiltersPanel = lazy(() =>
  import("./settings/stream-filters-panel").then((m) => ({ default: m.StreamFiltersPanel })),
);
const ThemePanel = lazy(() =>
  import("./settings/theme-panel").then((m) => ({ default: m.ThemePanel })),
);

function SettingsPanelFallback() {
  return (
    <div className="h-56 animate-pulse rounded-3xl border border-edge-soft/60 bg-surface/35" />
  );
}

const SECTION_META: Record<SectionId, { label: string; sub: string }> = {
  basics: {
    label: "Get started",
    sub: "The handful of settings most people set once. Sign in, choose how Play behaves, and pick your look.",
  },
  account: {
    label: "Account",
    sub: "Your Nexa account. Library, watch progress, and addons sync from here.",
  },
  library: {
    label: "Library & metadata",
    sub: "Ratings, score badges, and how Home, spoilers, and episode cards look. Add TMDB, OMDb, and other keys in the API Keys tab.",
  },
  apiKeys: {
    label: "API Keys",
    sub: "Debrid tokens and metadata & ratings keys, all in one place. Keys stay local to this device.",
  },
  tracking: {
    label: "Tracking",
    sub: "Trakt, Simkl, and Letterboxd — scrobbling, watchlists, and ratings from the tracking services you use.",
  },
  streaming: {
    label: "Streaming sources",
    sub: "How Nexa finds and resolves playable streams. Debrid keys live in the API Keys tab.",
  },
  network: {
    label: "Network & Relay",
    sub: IS_WEB
      ? "Nexa Relay routes Watch Together through Nexa's hosted relay. Plus the built-in P2P engine, streaming servers, and your saved stream filters."
      : "A Cloudflare Worker on your own account hosts your Watch Together rooms. Plus the built-in P2P engine, streaming servers, and your saved stream filters.",
  },
  language: {
    label: "Languages",
    sub: "Which audio and subtitle languages rank first in stream lists.",
  },
  player: {
    label: "Player & quality",
    sub: "Pick the playback engine and aspect, shape the audio, and set how episodes skip and advance.",
  },
  mpv: {
    label: "Video tuning",
    sub: "Match the picture quality to your computer, smooth out weak connections, and fine-tune the mpv engine with plain-language controls.",
  },
  smoothing: {
    label: "Smooth motion",
    sub: "Nexa's built-in frame interpolation and where SVP fits in.",
  },
  playerLayout: {
    label: "Player layout",
    sub: "Pick a theme, then rearrange every button in the player chrome. Hide what you never use, promote what you do.",
  },
  hotkeys: {
    label: "Hotkeys",
    sub: "Every shortcut Nexa responds to. Click a binding to rebind it.",
  },
  theme: {
    label: "Theme & appearance",
    sub: "Color presets, custom backgrounds, and the font pair Nexa renders in.",
  },
  bug: {
    label: "Report a bug",
    sub: "Send a bug report straight to the Nexa team. Screenshots and screen recordings welcome.",
  },
  advanced: {
    label: "Advanced",
    sub: "Diagnostics, manual overrides, things most users never need.",
  },
};

type SavedKey = LibraryKey | DebridKey;

export function Settings() {
  const t = useT();
  const { settings, update } = useSettings();
  const [tmdbDraft, setTmdbDraft] = useState(settings.tmdbKey);
  const [omdbDraft, setOmdbDraft] = useState(settings.omdbKey);
  const [rpdbDraft, setRpdbDraft] = useState(settings.rpdbKey);
  const [fanartDraft, setFanartDraft] = useState(settings.fanartKey);
  const [tvdbDraft, setTvdbDraft] = useState(settings.tvdbKey);
  const [rdDraft, setRdDraft] = useState(settings.rdKey);
  const [tbDraft, setTbDraft] = useState(settings.tbKey);
  const [adDraft, setAdDraft] = useState(settings.adKey);
  const [pmDraft, setPmDraft] = useState(settings.pmKey);
  const [dlDraft, setDlDraft] = useState(settings.dlKey);
  const [savedKey, setSavedKey] = useState<SavedKey | null>(null);
  const { settingsSectionRequest } = useView();
  const [active, setActive] = useState<SectionId>(
    resolveSettingsSection((settingsSectionRequest.section as string | null) ?? "account")
      ?.section ?? "account",
  );
  const [relayMode, setRelayMode] = useState<RelayMode>("panel");
  const [pendingAnchor, setPendingAnchor] = useState<string | null>(null);
  const scrollRef = useRef<HTMLElement>(null);

  const handleNav = (id: SectionId, anchor?: string) => {
    setActive(id);
    setPendingAnchor(anchor ?? null);
  };

  useEffect(() => {
    if (!settingsSectionRequest.section) return;
    const resolved = resolveSettingsSection(settingsSectionRequest.section as string);
    if (!resolved) return;
    setActive(resolved.section);
    setPendingAnchor(resolved.anchor ?? null);
  }, [settingsSectionRequest]);

  useEffect(() => {
    if (active !== "network") setRelayMode("panel");
  }, [active]);

  const pendingAnchorRef = useRef<string | null>(null);
  pendingAnchorRef.current = pendingAnchor;

  useEffect(() => {
    if (pendingAnchorRef.current) return;
    scrollRef.current?.scrollTo({ top: 0 });
  }, [active]);

  useEffect(() => {
    if (!pendingAnchor) return;
    const target = pendingAnchor;
    let tries = 0;
    let timer = 0;
    const findTarget = (): HTMLElement | null => {
      const exact = document.getElementById(target);
      if (exact) return exact;
      const root = scrollRef.current;
      if (!root) return null;
      const sections = Array.from(root.querySelectorAll<HTMLElement>('section[id^="set-"]'));
      let best: HTMLElement | null = null;
      for (const s of sections) {
        if (!(s.id.startsWith(target) || target.startsWith(s.id))) continue;
        if (
          best == null ||
          Math.abs(s.id.length - target.length) < Math.abs(best.id.length - target.length)
        ) {
          best = s;
        }
      }
      return best;
    };
    const tryScroll = () => {
      const el = findTarget();
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        el.style.transition = "box-shadow 0.5s ease";
        el.style.boxShadow = "0 0 0 2px var(--color-accent)";
        window.setTimeout(() => {
          el.style.boxShadow = "0 0 0 0 transparent";
        }, 1300);
        window.setTimeout(() => {
          el.style.transition = "";
          el.style.boxShadow = "";
        }, 1900);
        setPendingAnchor(null);
        return;
      }
      if (tries++ < 30) timer = window.setTimeout(tryScroll, 50);
      else setPendingAnchor(null);
    };
    timer = window.setTimeout(tryScroll, 60);
    return () => window.clearTimeout(timer);
  }, [active, pendingAnchor]);

  const saveKey = (which: SavedKey, value: string) => {
    const trimmed = value.trim();
    if (which === "tmdb") update({ tmdbKey: trimmed });
    else if (which === "omdb") {
      update({ omdbKey: trimmed });
      resetOmdbBudget();
    } else if (which === "rpdb") {
      if (trimmed) update({ rpdbKey: trimmed, showImdbBadge: false, showRtBadge: false });
      else update({ rpdbKey: trimmed });
    } else if (which === "fanart") update({ fanartKey: trimmed });
    else if (which === "tvdb") update({ tvdbKey: trimmed });
    else if (which === "rd") update({ rdKey: trimmed });
    else if (which === "tb") update({ tbKey: trimmed });
    else if (which === "ad") update({ adKey: trimmed });
    else if (which === "pm") update({ pmKey: trimmed });
    else if (which === "dl") update({ dlKey: trimmed });
    setSavedKey(which);
    setTimeout(() => setSavedKey((s) => (s === which ? null : s)), 1400);
  };

  return (
    <SettingsActiveContext.Provider value={{ setActive }}>
      <div className="flex h-full bg-canvas">
        <SettingsNav active={active} onChange={handleNav} />
        <main ref={scrollRef} className="flex-1 overflow-y-auto pt-28 pb-16">
          <div data-tauri-drag-region className="mx-auto flex max-w-3xl flex-col gap-10 px-12">
            {!(active === "network" && relayMode !== "panel") && (
              <header className="flex flex-col gap-2">
                <h1 className="font-display text-[44px] font-medium leading-[1.05] tracking-tight text-ink">
                  {t(SECTION_META[active].label)}
                </h1>
                <p className="text-[15px] text-ink-muted">{t(SECTION_META[active].sub)}</p>
              </header>
            )}

            <Suspense fallback={<SettingsPanelFallback />}>
              {active === "basics" && <BasicsPanel />}

              {active === "account" && <AccountStub />}

              {active === "library" && <LibraryPanel />}

              {active === "apiKeys" && (
                <ApiKeysPanel
                  tmdbDraft={tmdbDraft}
                  omdbDraft={omdbDraft}
                  rpdbDraft={rpdbDraft}
                  fanartDraft={fanartDraft}
                  tvdbDraft={tvdbDraft}
                  setTmdbDraft={setTmdbDraft}
                  setOmdbDraft={setOmdbDraft}
                  setRpdbDraft={setRpdbDraft}
                  setFanartDraft={setFanartDraft}
                  setTvdbDraft={setTvdbDraft}
                  rdDraft={rdDraft}
                  tbDraft={tbDraft}
                  adDraft={adDraft}
                  pmDraft={pmDraft}
                  dlDraft={dlDraft}
                  setRdDraft={setRdDraft}
                  setTbDraft={setTbDraft}
                  setAdDraft={setAdDraft}
                  setPmDraft={setPmDraft}
                  setDlDraft={setDlDraft}
                  savedKey={savedKey}
                  saveKey={saveKey}
                />
              )}

              {active === "tracking" && (
                <>
                  <TraktPanel />
                  <SimklPanel />
                  <LetterboxdPanel />
                </>
              )}

              {active === "streaming" && <StreamingSourcesPanel />}

              {active === "network" &&
                (relayMode !== "panel" ? (
                  <RelaySection mode={relayMode} onModeChange={setRelayMode} />
                ) : (
                  <>
                    <RelaySection mode="panel" onModeChange={setRelayMode} />
                    <P2PPanel />
                    <StreamFiltersPanel />
                  </>
                ))}

              {active === "language" && <LanguagePanel />}

              {active === "player" && <QualityPanel />}

              {active === "mpv" && <MpvPanel />}

              {active === "smoothing" && <SmoothingPanel />}

              {active === "playerLayout" && <PlayerLayoutPanel />}

              {active === "hotkeys" && <HotkeysPanel />}

              {active === "theme" && <ThemePanel />}

              {active === "bug" && <BugReportPanel />}

              {active === "advanced" && <AdvancedPanel />}
            </Suspense>
          </div>
        </main>
        <BackToTop scrollRef={scrollRef} />
        <SettingsJumpBar scrollRef={scrollRef} activeSection={active} />
      </div>
    </SettingsActiveContext.Provider>
  );
}
