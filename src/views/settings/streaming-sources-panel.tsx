import { SERVICES } from "@/lib/providers/streaming";
import { useSettings, type StreamingService } from "@/lib/settings";
import { Section, ToggleRow } from "./shared";
import { ManualAddonCard, ServiceCard } from "./streaming-panel";
import { StreamFilterPreview } from "./stream-filter-preview";
import {
  PickerLayoutPreview,
  StreamDescriptionPreview,
  TorrentNamePreview,
} from "./picker-previews";
import { AdSkipShowcase } from "./ad-skip-showcase";
import { useT } from "@/lib/i18n";

export function StreamingSourcesPanel() {
  const t = useT();
  const { settings, update, toggleStreaming } = useSettings();
  return (
    <>
      <Section
        title={t("Stream safety filter")}
        subtitle={t(
          "How aggressively Harbor rejects shady or mismatched streams before showing them in the picker.",
        )}
      >
        <StreamFilterPicker
          value={settings.streamFilterLevel}
          onChange={(v) => update({ streamFilterLevel: v })}
        />
        <StreamFilterPreview level={settings.streamFilterLevel} />
      </Section>

      <Section
        title={t("Picker layout")}
        subtitle={t(
          "Condensed shows a top pick, quality tiles, and a drawer. Stremio is a flat list grouped by addon, no scoring.",
        )}
      >
        <PickerLayoutPicker
          value={settings.pickerLayout}
          onChange={(v) => update({ pickerLayout: v })}
        />
        <PickerLayoutPreview value={settings.pickerLayout} />
      </Section>

      <Section
        title={t("Refresh button")}
        subtitle={t(
          "Where the Refresh button sits in the picker header. Default keeps it on the right, across from Back.",
        )}
      >
        <ToggleRow
          label={t("Move Refresh next to Back")}
          sub={t("Group Refresh on the left beside Back instead of the far right of the header.")}
          value={settings.pickerRefreshNextToBack}
          onChange={(v) => update({ pickerRefreshNextToBack: v })}
        />
      </Section>

      <Section
        title={t("Torrent name")}
        subtitle={t(
          "Show each source's full release filename on the condensed layout. The Stremio layout already shows it.",
        )}
      >
        <ToggleRow
          label={t("Show torrent name")}
          sub={t(
            "Display the raw release filename under each source in the condensed picker. Off keeps rows compact.",
          )}
          value={settings.pickerShowFilename}
          onChange={(v) => update({ pickerShowFilename: v })}
        />
        <TorrentNamePreview on={settings.pickerShowFilename} />
      </Section>

      <Section
        title={t("Stream descriptions")}
        subtitle={t(
          "How much of each source's description the Stremio picker layout shows. Full keeps everything the addon sends, which matters for AIOStreams and other custom formats.",
        )}
      >
        <ToggleRow
          label={t("Show full descriptions")}
          sub={t(
            "Show the addon's complete description instead of trimming it to a few lines. Turn off for shorter, tidier rows.",
          )}
          value={settings.fullStreamDescription}
          onChange={(v) => update({ fullStreamDescription: v })}
        />
        <StreamDescriptionPreview full={settings.fullStreamDescription} />
      </Section>

      <Section
        title={t("Injected ad skip (experimental)")}
        subtitle={t(
          "Some cam and new-release rips have ads spliced into the video itself. When the community has marked one, a Skip button appears. You can also report ads you spot for review. Off by default.",
        )}
      >
        <AdSkipShowcase />
        <ToggleRow
          label={t("Enable injected ad skip")}
          sub={t(
            "Show a Skip button when a known injected ad plays, and a small report button on new releases so you can mark ads for review.",
          )}
          value={settings.adSkipEnabled}
          onChange={(v) => update({ adSkipEnabled: v })}
        />
        {settings.adSkipEnabled && (
          <ToggleRow
            label={t("Always show the report button")}
            sub={t("Show the report button on every torrent stream, not just likely new releases.")}
            value={settings.adReportAlwaysShow}
            onChange={(v) => update({ adReportAlwaysShow: v })}
          />
        )}
        {settings.adSkipEnabled && (
          <ToggleRow
            label={t("Skip injected ads automatically")}
            sub={t("Jump past a known injected ad on its own instead of showing the Skip button.")}
            value={settings.autoSkipAd}
            onChange={(v) => update({ autoSkipAd: v })}
          />
        )}
      </Section>

      <Section
        title={t("Result order")}
        subtitle={t(
          "Harbor ranking puts the best-scoring sources first. Addon order follows your addon priority (organize it in Addons, Installed tab, Reorder) and keeps each addon's results in the order it returned them, like the Stremio and Vidi apps.",
        )}
      >
        <StreamSortPicker value={settings.streamSort} onChange={(v) => update({ streamSort: v })} />
        <p className="mt-3 rounded-xl border border-edge-soft bg-canvas/40 px-4 py-3 text-[12.5px] leading-relaxed text-ink-muted">
          {t(
            "Using AIOStreams or another aggregator addon? Its own sorting and filtering happen inside the addon before Harbor ever sees the results, then Harbor applies the stream filter and result order above on top. If results look thinner than expected, keep one side permissive: either relax the addon's internal filters or set Harbor's stream filter to Balanced or Off.",
          )}
        </p>
      </Section>

      <Section
        title={t("Usenet")}
        subtitle={t(
          "Faster and quieter than torrents if you already pay for Usenet. Configure on the addon page, paste the manifest URL it returns.",
        )}
      >
        <ManualAddonCard
          title="Easynews+"
          blurb={t(
            "Searches and streams directly off Easynews. No debrid needed. Just your Easynews login.",
          )}
          configureUrl="https://b89262c192b0-stremio-easynews-addon.baby-beamup.club/configure"
        />
      </Section>

      <Section
        title={t("Streaming catalogs")}
        subtitle={t("Top titles per service. Toggle off the ones you don't pay for.")}
      >
        <div className="grid grid-cols-3 gap-2.5">
          {(Object.keys(SERVICES) as StreamingService[]).map((svc) => (
            <ServiceCard
              key={svc}
              service={svc}
              active={settings.streaming[svc]}
              onToggle={() => toggleStreaming(svc)}
            />
          ))}
        </div>
        {!settings.tmdbKey && (
          <p className="mt-3 text-[13px] text-ink-subtle">
            {t("Save a TMDB key in API Keys to turn on streaming catalogs.")}
          </p>
        )}
      </Section>
    </>
  );
}

function StreamFilterPicker({
  value,
  onChange,
}: {
  value: "strict" | "balanced" | "off";
  onChange: (v: "strict" | "balanced" | "off") => void;
}) {
  const t = useT();
  const options: Array<{ id: "strict" | "balanced" | "off"; label: string; sub: string }> = [
    {
      id: "strict",
      label: t("Strict"),
      sub: t(
        "Default. Rejects size outliers, suspicious extensions, year/episode mismatches, season packs (for episode requests), trailers, and likely cams.",
      ),
    },
    {
      id: "balanced",
      label: t("Balanced"),
      sub: t(
        "Keeps the malware/year/episode-mismatch checks but allows season packs and oversized files. Same as hitting Search wider in the picker.",
      ),
    },
    {
      id: "off",
      label: t("Off"),
      sub: t(
        "No filtering. Every stream every addon returns shows up, including obvious junk. You'll be on your own.",
      ),
    },
  ];
  return (
    <div className="flex flex-col gap-2.5">
      {options.map((opt) => {
        const selected = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className={`flex items-start gap-3.5 rounded-2xl border px-5 py-4 text-start transition-colors ${
              selected
                ? "border-ink bg-elevated"
                : "border-edge-soft bg-canvas/40 hover:border-edge hover:bg-canvas/60"
            }`}
          >
            <span
              className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                selected ? "border-ink" : "border-edge"
              }`}
            >
              {selected && <span className="h-2.5 w-2.5 rounded-full bg-ink" />}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-[15px] font-semibold text-ink">{opt.label}</span>
              <span className="text-[12.5px] leading-snug text-ink-muted">{opt.sub}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function PickerLayoutPicker({
  value,
  onChange,
}: {
  value: "condensed" | "stremio";
  onChange: (v: "condensed" | "stremio") => void;
}) {
  const t = useT();
  const options: Array<{ id: "condensed" | "stremio"; label: string; sub: string }> = [
    {
      id: "condensed",
      label: t("Condensed"),
      sub: t(
        "Default. Top pick at the top, quality tiles, and an All-Sources drawer. Harbor scores and ranks results.",
      ),
    },
    {
      id: "stremio",
      label: "Stremio",
      sub: t(
        "Flat list of sources grouped by addon, with a filter dropdown. No re-ranking. Closest match to the Stremio app's stream picker.",
      ),
    },
  ];
  return (
    <div className="flex flex-col gap-2.5">
      {options.map((opt) => {
        const selected = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className={`flex items-start gap-3.5 rounded-2xl border px-5 py-4 text-start transition-colors ${
              selected
                ? "border-ink bg-elevated"
                : "border-edge-soft bg-canvas/40 hover:border-edge hover:bg-canvas/60"
            }`}
          >
            <span
              className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                selected ? "border-ink" : "border-edge"
              }`}
            >
              {selected && <span className="h-2.5 w-2.5 rounded-full bg-ink" />}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-[15px] font-semibold text-ink">{opt.label}</span>
              <span className="text-[12.5px] leading-snug text-ink-muted">{opt.sub}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function StreamSortPicker({
  value,
  onChange,
}: {
  value: "harbor" | "addon";
  onChange: (v: "harbor" | "addon") => void;
}) {
  const t = useT();
  const options: Array<{ id: "harbor" | "addon"; label: string; sub: string }> = [
    {
      id: "harbor",
      label: t("Harbor ranking"),
      sub: t("Default. Harbor parses and scores every source and surfaces the best quality first."),
    },
    {
      id: "addon",
      label: t("Addon order"),
      sub: t(
        "Show each addon's results in the order it returned them, grouped by your addon list. Matches the Stremio and Vidi apps.",
      ),
    },
  ];
  return (
    <div className="flex flex-col gap-2.5">
      {options.map((opt) => {
        const selected = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className={`flex items-start gap-3.5 rounded-2xl border px-5 py-4 text-start transition-colors ${
              selected
                ? "border-ink bg-elevated"
                : "border-edge-soft bg-canvas/40 hover:border-edge hover:bg-canvas/60"
            }`}
          >
            <span
              className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                selected ? "border-ink" : "border-edge"
              }`}
            >
              {selected && <span className="h-2.5 w-2.5 rounded-full bg-ink" />}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-[15px] font-semibold text-ink">{opt.label}</span>
              <span className="text-[12.5px] leading-snug text-ink-muted">{opt.sub}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
