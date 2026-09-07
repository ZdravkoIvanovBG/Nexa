import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useState } from "react";
import { useSettings } from "@/lib/settings";
import { useT } from "@/lib/i18n";
import { useGames } from "@/lib/games/provider";
import { gamesSteamVerifyKey } from "@/lib/games/api";
import { KeyField, Section } from "./shared";

export function GamesPanel() {
  const t = useT();
  const { settings, update } = useSettings();
  const { scan, startSteamScan, startEpicScan, dismissScan } = useGames();
  const [apiKeyDraft, setApiKeyDraft] = useState(settings.steamApiKey);
  const [id64Draft, setId64Draft] = useState(settings.steamId64);
  const [sgdbKeyDraft, setSgdbKeyDraft] = useState(settings.steamgriddbApiKey);
  const [saved, setSaved] = useState<"apiKey" | "id64" | "sgdbKey" | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState<boolean | null>(null);

  const saveApiKey = () => {
    update({ steamApiKey: apiKeyDraft.trim() });
    setSaved("apiKey");
    setVerified(null);
    window.setTimeout(() => setSaved(null), 1500);
  };
  const saveId64 = () => {
    update({ steamId64: id64Draft.trim() });
    setSaved("id64");
    setVerified(null);
    window.setTimeout(() => setSaved(null), 1500);
  };
  const saveSgdbKey = () => {
    update({ steamgriddbApiKey: sgdbKeyDraft.trim() });
    setSaved("sgdbKey");
    window.setTimeout(() => setSaved(null), 1500);
  };

  const verify = async () => {
    if (!settings.steamApiKey || !settings.steamId64) return;
    setVerifying(true);
    try {
      const ok = await gamesSteamVerifyKey(settings.steamApiKey, settings.steamId64);
      setVerified(ok);
    } catch {
      setVerified(false);
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Section
        title={t("Steam achievements")}
        subtitle={t(
          "Generate a free Steam Web API key and find your SteamID64 to show achievement progress on Steam games.",
        )}
      >
        <KeyField
          label={t("Steam Web API key")}
          placeholder="A1B2C3D4E5F6..."
          value={apiKeyDraft}
          onChange={setApiKeyDraft}
          onSave={saveApiKey}
          saved={saved === "apiKey"}
          help={t("Generate one at steamcommunity.com/dev/apikey.")}
        />
        <KeyField
          label={t("SteamID64")}
          placeholder="76561198000000000"
          value={id64Draft}
          onChange={setId64Draft}
          onSave={saveId64}
          saved={saved === "id64"}
          help={t("Your 17-digit Steam account ID. Find it via a SteamID lookup site.")}
        />
        <button
          type="button"
          onClick={() => void verify()}
          disabled={verifying || !settings.steamApiKey || !settings.steamId64}
          className="flex h-10 w-fit items-center gap-2 rounded-full bg-elevated px-4 text-[13px] font-medium text-ink ring-1 ring-edge-soft transition-colors hover:bg-raised disabled:opacity-40"
        >
          {verifying ? (
            <Loader2 size={14} className="animate-spin" />
          ) : verified === true ? (
            <CheckCircle2 size={14} className="text-accent" />
          ) : verified === false ? (
            <XCircle size={14} className="text-red-400" />
          ) : null}
          {t("Verify")}
        </button>
      </Section>

      <Section
        title={t("Cover art & artwork")}
        subtitle={t(
          "Add a free SteamGridDB API key so the artwork picker can find covers, hero banners, and logos for your games. Steam's own storefront images are used automatically for Steam games, no key required.",
        )}
      >
        <KeyField
          label={t("SteamGridDB API key")}
          placeholder="a1b2c3d4e5f6..."
          value={sgdbKeyDraft}
          onChange={setSgdbKeyDraft}
          onSave={saveSgdbKey}
          saved={saved === "sgdbKey"}
          help={t("Generate one at steamgriddb.com/profile/preferences/api.")}
        />
      </Section>

      <Section
        title={t("Launcher scanning")}
        subtitle={t("Detect installed games from Steam or Epic.")}
      >
        <div className="flex flex-wrap items-center gap-2.5">
          <ScanButton label={t("Scan Steam library")} onClick={() => void startSteamScan()} />
          <ScanButton label={t("Scan Epic library")} onClick={() => void startEpicScan()} />
        </div>
        {scan && (
          <div className="flex items-center justify-between gap-3 rounded-xl bg-canvas/40 px-4 py-3 text-[13px]">
            {scan.error ? (
              <span className="text-red-400">{scan.error}</span>
            ) : scan.progress ? (
              <span className="text-ink-muted">
                {t("Scanning…")} {scan.progress.found}
                {scan.progress.total ? ` / ${scan.progress.total}` : ""} —{" "}
                {scan.progress.currentTitle}
              </span>
            ) : (
              <span className="flex items-center gap-2 text-ink-muted">
                <Loader2 size={13} className="animate-spin" />
                {t("Starting scan…")}
              </span>
            )}
            <button
              type="button"
              onClick={dismissScan}
              className="text-[12px] text-ink-subtle hover:text-ink"
            >
              {t("Dismiss")}
            </button>
          </div>
        )}
      </Section>
    </div>
  );
}

function ScanButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-10 items-center rounded-full bg-elevated px-4 text-[13px] font-medium text-ink ring-1 ring-edge-soft transition-colors hover:bg-raised"
    >
      {label}
    </button>
  );
}
