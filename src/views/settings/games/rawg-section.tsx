import { Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { canToggleGames, keyFingerprint } from "@/lib/game-discovery/gates";
import { rawgSessionStatus } from "@/lib/game-discovery/status";
import { useRawgGate } from "@/lib/game-discovery/use-rawg";
import { useT } from "@/lib/i18n";
import { rawg, type RawgKeyCheck } from "@/lib/providers/rawg";
import { useSettings } from "@/lib/settings";
import { ExtLink, KeyField, Section, ToggleRow } from "../shared";

type CheckState = "idle" | "verifying" | RawgKeyCheck;

type Badge = { label: string; tone: "ok" | "warn" | "bad" | "muted" };

function StatusBadge({ badge }: { badge: Badge }) {
  const tone =
    badge.tone === "ok"
      ? "bg-accent/15 text-accent"
      : badge.tone === "warn"
        ? "bg-amber-400/15 text-amber-300"
        : badge.tone === "bad"
          ? "bg-danger/15 text-danger"
          : "bg-elevated text-ink-subtle ring-1 ring-edge-soft";
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-[10.5px] font-medium uppercase tracking-wider ${tone}`}
    >
      {badge.label}
    </span>
  );
}

export function RawgSection() {
  const t = useT();
  const { settings, update } = useSettings();
  const gate = useRawgGate();
  const [draft, setDraft] = useState(settings.rawgApiKey);
  const [saved, setSaved] = useState(false);
  const [check, setCheck] = useState<CheckState>("idle");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const checkToken = useRef(0);
  const currentKey = useRef(settings.rawgApiKey);
  const localKey = useRef(settings.rawgApiKey);
  useEffect(() => {
    currentKey.current = settings.rawgApiKey;
  }, [settings.rawgApiKey]);

  // Follow external changes (cloud hydration, profile switch) but not our own saves.
  useEffect(() => {
    if (settings.rawgApiKey === localKey.current) return;
    localKey.current = settings.rawgApiKey;
    checkToken.current += 1;
    setDraft(settings.rawgApiKey);
    setCheck("idle");
  }, [settings.rawgApiKey]);

  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => setSaved(false), 1400);
    return () => window.clearTimeout(timer);
  }, [saved]);

  useEffect(() => {
    if (!confirmRemove) return;
    const timer = window.setTimeout(() => setConfirmRemove(false), 4000);
    return () => window.clearTimeout(timer);
  }, [confirmRemove]);

  const verify = async (key: string) => {
    const token = ++checkToken.current;
    setCheck("verifying");
    const result = await rawg.validateKey(key);
    // Ignore stale results: a newer check started or the key changed meanwhile.
    if (token !== checkToken.current || currentKey.current.trim() !== key.trim()) return;
    if (result === "valid") update({ rawgKeyVerifiedFor: keyFingerprint(key) });
    setCheck(result);
  };

  const onSave = () => {
    const next = draft.trim();
    if (next === settings.rawgApiKey) return;
    currentKey.current = next;
    localKey.current = next;
    update(next ? { rawgApiKey: next } : { rawgApiKey: "", rawgKeyVerifiedFor: "" });
    setSaved(true);
    if (next) void verify(next);
    else setCheck("idle");
  };

  const removeKey = () => {
    if (!confirmRemove) {
      setConfirmRemove(true);
      return;
    }
    checkToken.current += 1;
    currentKey.current = "";
    localKey.current = "";
    rawgSessionStatus.clearRejected(gate.fingerprint);
    update({ rawgApiKey: "", rawgKeyVerifiedFor: "" });
    setDraft("");
    setCheck("idle");
    setConfirmRemove(false);
  };

  const hasKey = settings.rawgApiKey.trim() !== "";
  const badge: Badge | null = (() => {
    if (check === "verifying") return { label: t("Verifying…"), tone: "muted" };
    if (!hasKey) return null;
    if (gate.config === "ready") return { label: t("Verified"), tone: "ok" };
    if (gate.config === "rejected") return { label: t("Rejected during use"), tone: "bad" };
    if (check === "invalid") return { label: t("Invalid key"), tone: "bad" };
    if (check === "offline") return { label: t("Couldn't reach RAWG"), tone: "warn" };
    if (check === "unavailable") return { label: t("RAWG unavailable"), tone: "warn" };
    if (check === "rate_limited") return { label: t("Rate limit reached"), tone: "warn" };
    return { label: t("Not verified"), tone: "muted" };
  })();

  const detail: string | null =
    check === "invalid"
      ? t("RAWG didn't accept this key. Check it on rawg.io and paste it again.")
      : check === "offline"
        ? t(
            "Couldn't reach RAWG. Check your connection and verify again — the key itself may be fine.",
          )
        : check === "unavailable"
          ? t("RAWG is having trouble right now. Try verifying again later.")
          : check === "rate_limited"
            ? t("RAWG's request limit was reached for this key. Try verifying again later.")
            : gate.config === "rejected" && check === "idle"
              ? t("RAWG rejected this key while browsing. Verify it again or replace it.")
              : null;

  const toggleLocked = !canToggleGames(
    {
      gamesEnabled: settings.gamesEnabled,
      rawgApiKey: settings.rawgApiKey,
      rawgKeyVerifiedFor: settings.rawgKeyVerifiedFor,
    },
    rawgSessionStatus.isRejected,
  );

  return (
    <>
      <Section
        title={t("Games discovery")}
        subtitle={t("Browse games, franchises and details from RAWG using your own free API key.")}
      >
        <KeyField
          label={t("RAWG API key")}
          placeholder={t("rawg api key")}
          value={draft}
          onChange={setDraft}
          onSave={onSave}
          saved={saved}
          headerExtra={badge ? <StatusBadge badge={badge} /> : undefined}
          help={
            <>
              {t("Get a free key at")}{" "}
              <ExtLink href="https://rawg.io/apidocs">rawg.io/apidocs</ExtLink>
              {". "}
              {t(
                "The free tier is for non-commercial use and allows 20,000 requests a month. The key is stored in your Nexa settings on this device and, when you're signed in, synced to your account. It is sent to RAWG only with RAWG requests.",
              )}
            </>
          }
        />
        {detail && <p className="text-[12.5px] leading-relaxed text-ink-muted">{detail}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => void verify(settings.rawgApiKey)}
            disabled={!hasKey || check === "verifying"}
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-edge px-3 text-[12.5px] text-ink-muted transition-colors hover:bg-elevated hover:text-ink disabled:opacity-60"
          >
            {check === "verifying" ? (
              <Loader2 size={13} strokeWidth={1.9} className="animate-spin" />
            ) : (
              <ShieldCheck size={13} strokeWidth={1.9} />
            )}
            {check === "verifying" ? t("Verifying…") : t("Verify")}
          </button>
          <button
            onClick={removeKey}
            disabled={!hasKey}
            className={`flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-[12.5px] transition-colors disabled:opacity-60 ${
              confirmRemove
                ? "border-danger/60 text-danger hover:bg-danger/10"
                : "border-edge text-ink-muted hover:bg-elevated hover:text-ink"
            }`}
          >
            <Trash2 size={13} strokeWidth={1.9} />
            {confirmRemove ? t("Click again to remove") : t("Remove key")}
          </button>
        </div>
      </Section>

      <Section title={t("Games")}>
        <ToggleRow
          label={t("Enable Games")}
          sub={t("Adds Games to the sidebar. Turning it off keeps your RAWG key.")}
          value={settings.gamesEnabled}
          onChange={(v) => update({ gamesEnabled: v })}
          lockReason={toggleLocked ? t("Verify a RAWG API key first") : undefined}
        />
        <p className="text-[12px] leading-relaxed text-ink-subtle">
          {t("Game data and images are provided by")}{" "}
          <ExtLink href="https://rawg.io/">RAWG</ExtLink>.
        </p>
      </Section>
    </>
  );
}
