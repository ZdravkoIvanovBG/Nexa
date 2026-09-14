import { ChevronRight, HelpCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import allDebridLogo from "@/assets/addon-logos/alldebrid.webp";
import debridLinkLogo from "@/assets/addon-logos/debridlink.png";
import premiumizeLogo from "@/assets/addon-logos/premiumize.png";
import realDebridLogo from "@/assets/addon-logos/realdebrid.png";
import torboxLogo from "@/assets/addon-logos/torbox.png";
import fanartLogo from "@/assets/addon-logos/fanarttv.svg";
import mdblistLogo from "@/assets/addon-logos/mdblist.png";
import omdbLogo from "@/assets/addon-logos/omdb.png";
import rpdbLogo from "@/assets/addon-logos/rpdb.png";
import auddLogo from "@/assets/addon-logos/auddio.webp";
import tmdbLogo from "@/assets/addon-logos/tmdb.png";
import tvdbLogo from "@/assets/addon-logos/tvdb.svg";
import type { Addon } from "@/lib/addons";
import { installedAddonsResolved } from "@/lib/addon-store";
import { useSettings } from "@/lib/settings";
import {
  fetchAioStatusHealth,
  type AioStatusSnapshot,
  type ServiceHealth,
} from "@/lib/streams/aiostatus";
import { HoverTooltip } from "@/components/hover-tooltip";
import { useT } from "@/lib/i18n";
import { ExtLink, KeyField, Section, ToggleRow } from "./shared";
import { AioStatusModal } from "./aiostatus-modal";
import { TmdbGuideModal } from "./tmdb-tutorial-modal";
import { TvdbGuideModal } from "./tvdb-tutorial-modal";

export type LibraryKey = "tmdb" | "omdb" | "rpdb" | "fanart" | "tvdb";
export type DebridKey = "rd" | "tb" | "ad" | "pm" | "dl";

export function ApiKeysPanel({
  tmdbDraft,
  omdbDraft,
  rpdbDraft,
  fanartDraft,
  tvdbDraft,
  setTmdbDraft,
  setOmdbDraft,
  setRpdbDraft,
  setFanartDraft,
  setTvdbDraft,
  rdDraft,
  tbDraft,
  adDraft,
  pmDraft,
  dlDraft,
  setRdDraft,
  setTbDraft,
  setAdDraft,
  setPmDraft,
  setDlDraft,
  savedKey,
  saveKey,
}: {
  tmdbDraft: string;
  omdbDraft: string;
  rpdbDraft: string;
  fanartDraft: string;
  tvdbDraft: string;
  setTmdbDraft: (v: string) => void;
  setOmdbDraft: (v: string) => void;
  setRpdbDraft: (v: string) => void;
  setFanartDraft: (v: string) => void;
  setTvdbDraft: (v: string) => void;
  rdDraft: string;
  tbDraft: string;
  adDraft: string;
  pmDraft: string;
  dlDraft: string;
  setRdDraft: (v: string) => void;
  setTbDraft: (v: string) => void;
  setAdDraft: (v: string) => void;
  setPmDraft: (v: string) => void;
  setDlDraft: (v: string) => void;
  savedKey: LibraryKey | DebridKey | null;
  saveKey: (which: LibraryKey | DebridKey, value: string) => void;
}) {
  const t = useT();
  const { settings, update } = useSettings();
  const aioHealth = useAioStatusHealth();

  const [mdblistDraft, setMdblistDraft] = useState(settings.mdblistKey);
  const [posterSrvDraft, setPosterSrvDraft] = useState(settings.posterBaseUrl);
  const [auddDraft, setAuddDraft] = useState(settings.auddKey);
  const [extraSaved, setExtraSaved] = useState<"mdblist" | "postersrv" | "audd" | null>(null);
  const [tmdbGuide, setTmdbGuide] = useState(false);
  const [tvdbGuide, setTvdbGuide] = useState(false);
  const extraTimerRef = useRef<number | null>(null);
  const flashExtra = (k: "mdblist" | "postersrv" | "audd") => {
    setExtraSaved(k);
    if (extraTimerRef.current) window.clearTimeout(extraTimerRef.current);
    extraTimerRef.current = window.setTimeout(() => setExtraSaved(null), 1800);
  };

  return (
    <>
      <TmdbGuideModal open={tmdbGuide} onClose={() => setTmdbGuide(false)} />
      <TvdbGuideModal open={tvdbGuide} onClose={() => setTvdbGuide(false)} />

      <Section
        title={t("Debrid services")}
        subtitle={t(
          "Real-Debrid, TorBox, AllDebrid, Premiumize, Debrid-Link. Cached streams play direct. Keys stay local.",
        )}
      >
        {aioHealth && <AioStatusBanner snapshot={aioHealth} />}
        <KeyField
          label={t("Real-Debrid API token")}
          placeholder={t("API token")}
          value={rdDraft}
          onChange={setRdDraft}
          onSave={() => saveKey("rd", rdDraft)}
          saved={savedKey === "rd"}
          iconSrc={realDebridLogo}
          help={
            <>
              Get yours at{" "}
              <ExtLink href="https://real-debrid.com/apitoken">real-debrid.com/apitoken</ExtLink>.
              Used to check cache and unrestrict links. Nexa never adds or removes torrents on its
              own.
            </>
          }
          headerExtra={
            aioHealth?.health.has("rd") ? (
              <HealthBadge health={aioHealth.health.get("rd")} logo={aioHealth.addonLogo} />
            ) : undefined
          }
        />
        <KeyField
          label={t("TorBox API key")}
          placeholder={t("API key")}
          value={tbDraft}
          onChange={setTbDraft}
          onSave={() => saveKey("tb", tbDraft)}
          saved={savedKey === "tb"}
          iconSrc={torboxLogo}
          help={
            <>
              Get yours at <ExtLink href="https://torbox.app/settings">torbox.app/settings</ExtLink>
              . Same read-only usage as Real-Debrid. Also lets you queue uncached torrents from the
              play picker.
            </>
          }
          headerExtra={
            aioHealth?.health.has("tb") ? (
              <HealthBadge health={aioHealth.health.get("tb")} logo={aioHealth.addonLogo} />
            ) : undefined
          }
        />
        <KeyField
          label={t("AllDebrid API key")}
          placeholder={t("API key")}
          value={adDraft}
          onChange={setAdDraft}
          onSave={() => saveKey("ad", adDraft)}
          saved={savedKey === "ad"}
          iconSrc={allDebridLogo}
          help={
            <>
              Get yours at{" "}
              <ExtLink href="https://alldebrid.com/apikeys/">alldebrid.com/apikeys</ExtLink>.
              AllDebrid deprecated their cache-check endpoint, so streams may show as unknown until
              you actually hit Play.
            </>
          }
          headerExtra={
            aioHealth?.health.has("ad") ? (
              <HealthBadge health={aioHealth.health.get("ad")} logo={aioHealth.addonLogo} />
            ) : undefined
          }
        />
        <KeyField
          label={t("Premiumize API key")}
          placeholder={t("API key")}
          value={pmDraft}
          onChange={setPmDraft}
          onSave={() => saveKey("pm", pmDraft)}
          saved={savedKey === "pm"}
          iconSrc={premiumizeLogo}
          help={
            <>
              Get yours at{" "}
              <ExtLink href="https://www.premiumize.me/account">premiumize.me/account</ExtLink>.
              Uses the directdl endpoint, which skips queueing for anything already cached.
            </>
          }
          headerExtra={
            aioHealth?.health.has("pm") ? (
              <HealthBadge health={aioHealth.health.get("pm")} logo={aioHealth.addonLogo} />
            ) : undefined
          }
        />
        <KeyField
          label={t("Debrid-Link API key")}
          placeholder={t("API key")}
          value={dlDraft}
          onChange={setDlDraft}
          onSave={() => saveKey("dl", dlDraft)}
          saved={savedKey === "dl"}
          iconSrc={debridLinkLogo}
          help={
            <>
              Get yours at{" "}
              <ExtLink href="https://debrid-link.com/webapp/apikey">
                debrid-link.com/webapp/apikey
              </ExtLink>
              . EU-hosted, fast cache check. Same read-only usage as the others.
            </>
          }
          headerExtra={
            aioHealth?.health.has("dl") ? (
              <HealthBadge health={aioHealth.health.get("dl")} logo={aioHealth.addonLogo} />
            ) : undefined
          }
        />
      </Section>

      <Section
        title={t("Metadata & ratings")}
        subtitle={t(
          "A free TMDB key is highly recommended. It unlocks the full Nexa experience. The rest are optional, and Cinemeta works out of the box without any.",
        )}
      >
        <KeyField
          label={t("TMDB · catalogs and rails")}
          badge={t("Recommended")}
          placeholder={t("v3 API key")}
          value={tmdbDraft}
          onChange={setTmdbDraft}
          onSave={() => saveKey("tmdb", tmdbDraft)}
          saved={savedKey === "tmdb"}
          iconSrc={tmdbLogo}
          headerExtra={
            <HoverTooltip
              side="top"
              align="center"
              label={t(
                "TMDB asks for an app URL when you create the key. Put any URL at all, like https://nexa.app. The only thing you need back is the API key.",
              )}
            >
              <button
                type="button"
                onClick={() => setTmdbGuide(true)}
                className="flex items-center gap-1 rounded-full px-2 py-1 text-[11.5px] font-semibold text-accent transition-colors hover:bg-accent/10"
              >
                <HelpCircle size={13} strokeWidth={2.4} />
                {t("How to get this")}
              </button>
            </HoverTooltip>
          }
          help={
            <>
              Highly recommended. This is what gives you the full Nexa experience: Popular,
              Trending, In Theaters, and per-service rails. Free at{" "}
              <ExtLink href="https://www.themoviedb.org/settings/api">
                themoviedb.org/settings/api
              </ExtLink>
              . Use the v3 key, not the read access token.
            </>
          }
        />
        <ToggleRow
          label={t("Use free IMDb data without a TMDB key")}
          sub={t(
            "With no TMDB key, the About panel pulls cast, crew, and title info from a free IMDb source. TMDB is still used whenever a key is set.",
          )}
          value={settings.imdbApiFallback}
          onChange={(v) => update({ imdbApiFallback: v })}
        />
        <KeyField
          label={t("OMDb · Rotten Tomatoes scores")}
          placeholder={t("8-character key")}
          value={omdbDraft}
          onChange={setOmdbDraft}
          onSave={() => saveKey("omdb", omdbDraft)}
          saved={savedKey === "omdb"}
          iconSrc={omdbLogo}
          help={
            <>
              Free at{" "}
              <ExtLink href="https://www.omdbapi.com/apikey.aspx">omdbapi.com/apikey.aspx</ExtLink>.
              They email an activation link the first time. Click it, then come back and save.
            </>
          }
        />
        <KeyField
          label={t("RPDB · scores baked into posters")}
          placeholder={t("rpdb key")}
          value={rpdbDraft}
          onChange={setRpdbDraft}
          onSave={() => saveKey("rpdb", rpdbDraft)}
          saved={savedKey === "rpdb"}
          iconSrc={rpdbLogo}
          help={
            <>
              Paid plan at <ExtLink href="https://ratingposterdb.com">ratingposterdb.com</ExtLink>.
              Once saved, every poster gets re-rendered with IMDb, Rotten Tomatoes, and Metacritic
              stamped on it.
            </>
          }
        />
        <KeyField
          label={t("MDBList · Letterboxd and Trakt scores")}
          placeholder={t("mdblist api key")}
          value={mdblistDraft}
          onChange={setMdblistDraft}
          onSave={() => {
            update({ mdblistKey: mdblistDraft.trim() });
            flashExtra("mdblist");
          }}
          saved={extraSaved === "mdblist"}
          iconSrc={mdblistLogo}
          help={
            <>
              Free key at <ExtLink href="https://mdblist.com/preferences/">mdblist.com</ExtLink>.
              Adds Letterboxd and Trakt community ratings to detail pages, covering what OMDb
              misses.
            </>
          }
        />
        <KeyField
          label={t("AudD · in-player song ID")}
          placeholder={t("AudD API token")}
          value={auddDraft}
          onChange={setAuddDraft}
          onSave={() => {
            update({ auddKey: auddDraft.trim() });
            flashExtra("audd");
          }}
          saved={extraSaved === "audd"}
          iconSrc={auddLogo}
          iconBg="#EE1066"
          help={
            <>
              Powers the Identify-song button in the player. Get a token at{" "}
              <ExtLink href="https://dashboard.audd.io/">dashboard.audd.io</ExtLink>.
            </>
          }
        />
        <KeyField
          label={t("Custom poster service")}
          placeholder={t("RPDB key above, https://btttr.cc, or a {imdbId} template")}
          value={posterSrvDraft}
          onChange={setPosterSrvDraft}
          onSave={() => {
            update({ posterBaseUrl: posterSrvDraft.trim() });
            flashExtra("postersrv");
          }}
          saved={extraSaved === "postersrv"}
          iconSrc={rpdbLogo}
          help={
            <>
              Leave empty to use your RPDB key above. Or paste <strong>Better Posters</strong> (
              <code>https://btttr.cc</code>), a bare RPDB-compatible server (your RPDB key is still
              sent), or a full URL template using <code>{"{imdbId}"}</code>,{" "}
              <code>{"{tmdbId}"}</code>, <code>{"{type}"}</code>, or <code>{"{id}"}</code>.
              PostersPlus needs the template form, e.g.{" "}
              <code>
                {"postersplus.elfhosted.com/poster?tmdb_id={tmdbId}&imdb_id={imdbId}&type={type}"}
              </code>
              .
            </>
          }
        />
        <KeyField
          label={t("Fanart.tv · logos and backdrops")}
          placeholder={t("personal key")}
          value={fanartDraft}
          onChange={setFanartDraft}
          onSave={() => saveKey("fanart", fanartDraft)}
          saved={savedKey === "fanart"}
          iconSrc={fanartLogo}
          help={
            <>
              Fills in where TMDB comes up empty (anime, older catalog). Free at{" "}
              <ExtLink href="https://fanart.tv/get-an-api-key/">fanart.tv/get-an-api-key</ExtLink>.
              Use the "personal" key, not the project one.
            </>
          }
        />
        <KeyField
          label={t("TheTVDB · episode data")}
          placeholder={t("subscriber API key")}
          value={tvdbDraft}
          onChange={setTvdbDraft}
          onSave={() => saveKey("tvdb", tvdbDraft)}
          saved={savedKey === "tvdb"}
          iconSrc={tvdbLogo}
          headerExtra={
            <HoverTooltip
              side="top"
              align="center"
              label={t(
                "The free tier is $0 for personal use. Just pick the first option, no payment needed.",
              )}
            >
              <button
                type="button"
                onClick={() => setTvdbGuide(true)}
                className="flex items-center gap-1 rounded-full px-2 py-1 text-[11.5px] font-semibold text-accent transition-colors hover:bg-accent/10"
              >
                <HelpCircle size={13} strokeWidth={2.4} />
                {t("How to get this")}
              </button>
            </HoverTooltip>
          }
          help={
            <>
              Episode titles, alternate names, network info, and the arc/DVD/absolute orderings.
              Layered on TMDB so the better source wins per field. Free for personal use at{" "}
              <ExtLink href="https://thetvdb.com/api-information">
                thetvdb.com/api-information
              </ExtLink>
              {'. Choose the "Less than $50k per year" tier.'}
            </>
          }
        />
      </Section>
    </>
  );
}

function useAioStatusHealth(): AioStatusSnapshot | null {
  const [snapshot, setSnapshot] = useState<AioStatusSnapshot | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    let cancelled = false;
    void (async () => {
      const list = await installedAddonsResolved().catch(() => [] as Addon[]);
      if (cancelled || list.length === 0) return;
      const snap = await fetchAioStatusHealth(list, ac.signal);
      if (!cancelled) setSnapshot(snap);
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, []);
  return snapshot;
}

function AioStatusBanner({ snapshot }: { snapshot: AioStatusSnapshot }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const total = snapshot.services.length;
  if (total === 0) return null;
  const expiringSoon = snapshot.services.filter(
    (s) => s.status === "expiring" || s.status === "expired",
  );
  const hasWarning = expiringSoon.length > 0;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`mb-2 flex w-full items-center gap-2.5 rounded-xl border px-3.5 py-2 text-start text-[12px] transition-colors ${
          hasWarning
            ? "border-amber-300/40 bg-amber-400/10 text-amber-100 hover:bg-amber-400/15"
            : "border-edge-soft bg-canvas/40 text-ink-muted hover:bg-canvas/60"
        }`}
      >
        <span className="shrink-0 font-semibold tracking-wide">{snapshot.addonName}</span>
        <span className="text-ink-subtle">·</span>
        <span className="min-w-0 flex-1 truncate">
          {hasWarning
            ? expiringSoon.length === 1
              ? t("{n} service needs attention", { n: expiringSoon.length })
              : t("{n} services need attention", { n: expiringSoon.length })
            : total === 1
              ? t("Health for {n} service", { n: total })
              : t("Health for {n} services", { n: total })}
        </span>
        <span className="flex shrink-0 items-center gap-0.5 font-semibold text-ink-subtle">
          {t("View all")}
          <ChevronRight size={13} strokeWidth={2.4} />
        </span>
      </button>
      {open && <AioStatusModal snapshot={snapshot} onClose={() => setOpen(false)} />}
    </>
  );
}

function HealthBadge({ health, logo }: { health: ServiceHealth | undefined; logo: string | null }) {
  const t = useT();
  if (!health) return null;
  const palette =
    health.status === "expired"
      ? "text-rose-200"
      : health.status === "expiring"
        ? "text-amber-200"
        : health.status === "active"
          ? "text-emerald-200"
          : "text-ink-subtle";
  const dot =
    health.status === "expired"
      ? "bg-rose-300"
      : health.status === "expiring"
        ? "bg-amber-300"
        : health.status === "active"
          ? "bg-emerald-300"
          : "bg-ink-subtle";
  const label = (() => {
    if (health.status === "expired") return t("Expired");
    if (health.daysLeft != null && health.status === "expiring")
      return t("{n}d left", { n: health.daysLeft });
    if (health.daysLeft != null) return t("{n}d left", { n: health.daysLeft });
    if (health.status === "active") return t("Active");
    return health.rawLine.slice(0, 40);
  })();
  return (
    <span className="flex items-center gap-2 text-[11px] font-medium">
      <span className={`flex items-center gap-1.5 ${palette}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        <span>{label}</span>
        {health.quotaUsedPercent != null && (
          <span className="text-ink-subtle">· {health.quotaUsedPercent}%</span>
        )}
      </span>
      <span className="flex items-center gap-1.5 text-ink-muted">
        {logo && (
          <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-full bg-canvas ring-1 ring-edge-soft">
            <img
              src={logo}
              alt=""
              className="h-full w-full object-cover"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
              draggable={false}
            />
          </span>
        )}
        <span>AIOStatus</span>
      </span>
    </span>
  );
}
