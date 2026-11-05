import { KeyRound, Loader2, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { igdbNative, igdbNativeAvailable, igdbStatus } from "@/lib/game-discovery/igdb-native";
import { useActiveGameProvider } from "@/lib/game-discovery/use-games-gate";
import { useT } from "@/lib/i18n";
import {
  toNativeError,
  type IgdbNativeErrorKind,
  type IgdbNativeStatus,
} from "@/lib/providers/igdb/native";
import { ExtLink, Section } from "../shared";

// IGDB credentials (Stage 3). They live in the OS credential store through the
// Rust IGDB module, never in Settings, localStorage, cloud sync or backups.
// The secret is held only in this component's state while the user types it,
// and cleared once it's been sent. Every status this section reads or gets back
// is shared with the Games gate (igdbStatus), so Games opens, closes and drops
// its cache as soon as credentials are verified, replaced or removed.

type Busy = "loading" | "saving" | "verifying" | "removing" | null;
type Badge = { label: string; tone: "ok" | "warn" | "bad" | "muted" };

const BUTTON =
  "flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-edge px-3 text-[12.5px] text-ink-muted transition-colors hover:bg-elevated hover:text-ink disabled:opacity-60";

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

function CredentialInput({
  id,
  label,
  value,
  onChange,
  onEnter,
  placeholder,
  secret,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  onEnter: () => void;
  placeholder: string;
  secret?: boolean;
  disabled?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={id}
        className="text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-subtle"
      >
        {label}
      </label>
      <div
        className={`flex h-12 items-center gap-3 rounded-2xl border bg-elevated px-4 transition-all ${
          focused ? "border-ink shadow-[0_0_0_3px_rgba(255,255,255,0.04)]" : "border-edge"
        }`}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-canvas text-ink-subtle ring-1 ring-edge-soft">
          <KeyRound size={14} />
        </span>
        <input
          id={id}
          // No name and no surrounding <form>: nothing for a password manager
          // or WebView autofill to capture or offer to save.
          type={secret ? "password" : "text"}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onEnter();
            }
          }}
          placeholder={placeholder}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete={secret ? "new-password" : "off"}
          data-1p-ignore
          data-lpignore="true"
          className="h-full flex-1 bg-transparent text-[14.5px] tracking-wide text-ink placeholder:text-ink-subtle/55 outline-none disabled:opacity-60"
        />
      </div>
    </div>
  );
}

export function IgdbSection() {
  const t = useT();
  const igdbActive = useActiveGameProvider() === "igdb";
  const [status, setStatusLocal] = useState<IgdbNativeStatus | null>(null);
  // Local state plus the shared store. `changed` marks a credential change
  // (saved, replaced, removed), which starts a fresh Games cache.
  const setStatus = useCallback((next: IgdbNativeStatus, changed = false) => {
    setStatusLocal(next);
    igdbStatus.publish(next, { credentialsChanged: changed });
  }, []);
  const [busy, setBusy] = useState<Busy>("loading");
  const [replacing, setReplacing] = useState(false);
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<IgdbNativeErrorKind | null>(null);
  const [notice, setNotice] = useState<"saved" | "verified" | "removed" | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await igdbNative.status();
      if (mounted.current) setStatus(next);
    } catch (e) {
      if (mounted.current) setError(toNativeError(e).kind);
    }
  }, [setStatus]);

  // Reads the OS credential store once on open; makes no network request.
  useEffect(() => {
    let live = true;
    igdbNative
      .status()
      .then(
        (next) => {
          if (live) setStatus(next);
        },
        (e) => {
          if (live) setError(toNativeError(e).kind);
        },
      )
      .finally(() => {
        if (live) setBusy(null);
      });
    return () => {
      live = false;
    };
  }, [setStatus]);

  useEffect(() => {
    if (!confirmRemove) return;
    const timer = window.setTimeout(() => setConfirmRemove(false), 4000);
    return () => window.clearTimeout(timer);
  }, [confirmRemove]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const state = status?.state ?? null;
  const hasStored = state === "verified" || state === "configured" || state === "invalid";
  const supported = igdbNativeAvailable && status?.storage !== "unsupported";
  const storeDown = status?.storage === "unavailable";
  const showForm = supported && !storeDown && status !== null && (!hasStored || replacing);

  const closeForm = () => {
    setReplacing(false);
    setClientId("");
    setSecret("");
    setError(null);
  };

  const submit = async () => {
    const id = clientId.trim();
    const value = secret.trim();
    if (!id || !value || busy) return;
    setBusy("saving");
    setError(null);
    setNotice(null);
    try {
      const next = await igdbNative.setCredentials(id, value);
      if (!mounted.current) return;
      setStatus(next, true);
      setReplacing(false);
      setClientId("");
      setSecret("");
      setNotice("saved");
    } catch (e) {
      if (!mounted.current) return;
      const kind = toNativeError(e).kind;
      setError(kind);
      // A wrong secret has to be re-entered anyway; drop it now.
      if (kind === "invalid_credentials" || kind === "invalid_input") setSecret("");
      void refresh();
    } finally {
      if (mounted.current) setBusy(null);
    }
  };

  const verify = async () => {
    if (busy) return;
    setBusy("verifying");
    setError(null);
    setNotice(null);
    try {
      const next = await igdbNative.verify();
      if (!mounted.current) return;
      setStatus(next);
      if (next.state === "verified") setNotice("verified");
    } catch (e) {
      if (mounted.current) setError(toNativeError(e).kind);
    } finally {
      if (mounted.current) setBusy(null);
    }
  };

  const remove = async () => {
    if (busy) return;
    if (!confirmRemove) {
      setConfirmRemove(true);
      return;
    }
    setConfirmRemove(false);
    setBusy("removing");
    setError(null);
    setNotice(null);
    try {
      const next = await igdbNative.clear();
      if (!mounted.current) return;
      setStatus(next, true);
      closeForm();
      setNotice("removed");
    } catch (e) {
      if (!mounted.current) return;
      setError(toNativeError(e).kind);
      void refresh();
    } finally {
      if (mounted.current) setBusy(null);
    }
  };

  const badge: Badge | null = (() => {
    if (busy === "loading") return { label: t("Checking…"), tone: "muted" };
    if (busy === "saving" || busy === "verifying") return { label: t("Verifying…"), tone: "muted" };
    if (!supported) return { label: t("Not available"), tone: "muted" };
    if (storeDown) return { label: t("Storage unavailable"), tone: "warn" };
    if (state === "verified") return { label: t("Verified"), tone: "ok" };
    if (state === "configured") return { label: t("Not verified"), tone: "muted" };
    if (state === "invalid") return { label: t("Rejected"), tone: "bad" };
    if (state === "corrupted") return { label: t("Unreadable"), tone: "bad" };
    return null;
  })();

  const unchanged = hasStored ? ` ${t("Your saved credentials haven't changed.")}` : "";
  const errorText: string | null = (() => {
    switch (error) {
      case null:
        return null;
      case "invalid_credentials":
        return (
          t(
            "Twitch didn't accept this Client ID and Client Secret. Check them in the Twitch developer console, or generate a new secret, and try again.",
          ) + unchanged
        );
      case "invalid_input":
        return t(
          "That doesn't look like a Twitch Client ID and Client Secret. Copy both from your application in the Twitch developer console.",
        );
      case "network":
        return (
          t("Couldn't reach Twitch. Check your connection and try again.") +
          (hasStored ? unchanged : ` ${t("Nothing was saved.")}`)
        );
      case "rate_limited":
      case "unavailable":
      case "bad_response":
        return t("Twitch is having trouble right now. Try again in a few minutes.") + unchanged;
      case "storage_unavailable":
        return t(
          "Nexa couldn't use this device's credential store, so nothing was changed. Make sure you're signed in to your device account, then try again.",
        );
      case "storage_corrupted":
        return t("The saved IGDB credentials couldn't be read. Enter them again or remove them.");
      case "missing_credentials":
        return t("No IGDB credentials are saved on this device.");
      case "busy":
        return t("Credentials are already being verified. Wait a moment and try again.");
      default:
        return t("Something went wrong. Nothing was changed.");
    }
  })();

  const stateText: string | null = (() => {
    if (error) return null;
    if (state === "invalid") {
      return t(
        "Twitch rejected the saved credentials. The secret may have been regenerated or the application removed. Replace them with the current ones from your Twitch application.",
      );
    }
    if (state === "corrupted") {
      return t("The saved IGDB credentials couldn't be read. Enter them again or remove them.");
    }
    if (storeDown) {
      return t(
        "Nexa couldn't open this device's credential store. Your credentials, if any, are untouched. Check again in a moment.",
      );
    }
    return null;
  })();

  const noticeText =
    notice === "saved"
      ? t("Verified with Twitch and saved on this device.")
      : notice === "verified"
        ? t("Twitch accepted the saved credentials.")
        : notice === "removed"
          ? t("IGDB credentials removed from this device.")
          : null;

  return (
    <Section
      title={t("IGDB")}
      subtitle={
        igdbActive
          ? t(
              "Connect your own Twitch developer application for IGDB game data. Games on this device is using IGDB (development builds only).",
            )
          : t(
              "Connect your own Twitch developer application to prepare Nexa's upcoming IGDB game data. Games still use RAWG for now: saving credentials here doesn't change what you see in Games.",
            )
      }
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
          {t("Twitch application")}
        </span>
        {badge && <StatusBadge badge={badge} />}
      </div>

      {!supported && busy !== "loading" && (
        <p className="text-[13px] leading-relaxed text-ink-muted">
          {igdbNativeAvailable
            ? t(
                "Secure credential storage isn't available in this build of Nexa yet, so IGDB credentials can't be saved here. Nexa never stores them in plain text.",
              )
            : t("IGDB credentials can be saved only in the Nexa desktop app.")}
        </p>
      )}

      {supported && hasStored && !replacing && (
        <div className="flex items-center gap-3 rounded-2xl border border-edge bg-elevated px-4 py-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-canvas text-ink-subtle ring-1 ring-edge-soft">
            <KeyRound size={14} />
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="text-[13.5px] text-ink">
              {t("Client ID")}{" "}
              <span className="font-mono tracking-wider text-ink-muted">
                ••••{status?.clientIdHint ?? ""}
              </span>
            </span>
            <span className="text-[12px] text-ink-subtle">
              {t("Client Secret saved securely on this device")}
            </span>
          </div>
        </div>
      )}

      {showForm && (
        <div className="flex flex-col gap-3">
          <CredentialInput
            id="igdb-client-id"
            label={t("Client ID")}
            placeholder={t("twitch client id")}
            value={clientId}
            onChange={setClientId}
            onEnter={() => void submit()}
            disabled={busy === "saving"}
          />
          <CredentialInput
            id="igdb-client-secret"
            label={t("Client Secret")}
            placeholder={t("twitch client secret")}
            value={secret}
            onChange={setSecret}
            onEnter={() => void submit()}
            disabled={busy === "saving"}
            secret
          />
        </div>
      )}

      {(errorText || stateText) && (
        <p
          role={errorText ? "alert" : undefined}
          className={`text-[12.5px] leading-relaxed ${errorText ? "text-danger" : "text-ink-muted"}`}
        >
          {errorText ?? stateText}
        </p>
      )}
      {noticeText && !errorText && (
        <p role="status" className="text-[12.5px] leading-relaxed text-accent">
          {noticeText}
        </p>
      )}

      {supported && (
        <div className="flex flex-wrap items-center gap-2">
          {showForm && (
            <button
              onClick={() => void submit()}
              disabled={!clientId.trim() || !secret.trim() || busy !== null}
              className={BUTTON}
            >
              {busy === "saving" ? (
                <Loader2 size={13} strokeWidth={1.9} className="animate-spin" />
              ) : (
                <ShieldCheck size={13} strokeWidth={1.9} />
              )}
              {busy === "saving" ? t("Verifying…") : t("Verify and save")}
            </button>
          )}
          {showForm && replacing && (
            <button onClick={closeForm} disabled={busy === "saving"} className={BUTTON}>
              {t("Cancel")}
            </button>
          )}
          {hasStored && !replacing && (
            <>
              <button onClick={() => void verify()} disabled={busy !== null} className={BUTTON}>
                {busy === "verifying" ? (
                  <Loader2 size={13} strokeWidth={1.9} className="animate-spin" />
                ) : (
                  <ShieldCheck size={13} strokeWidth={1.9} />
                )}
                {busy === "verifying" ? t("Verifying…") : t("Verify again")}
              </button>
              <button
                onClick={() => {
                  setReplacing(true);
                  setError(null);
                  setNotice(null);
                }}
                disabled={busy !== null}
                className={BUTTON}
              >
                <KeyRound size={13} strokeWidth={1.9} />
                {t("Replace")}
              </button>
            </>
          )}
          {storeDown && (
            <button onClick={() => void refresh()} disabled={busy !== null} className={BUTTON}>
              <RefreshCw size={13} strokeWidth={1.9} />
              {t("Check again")}
            </button>
          )}
          {(hasStored || state === "corrupted") && !replacing && (
            <button
              onClick={() => void remove()}
              disabled={busy !== null}
              className={`flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-[12.5px] transition-colors disabled:opacity-60 ${
                confirmRemove
                  ? "border-danger/60 text-danger hover:bg-danger/10"
                  : "border-edge text-ink-muted hover:bg-elevated hover:text-ink"
              }`}
            >
              {busy === "removing" ? (
                <Loader2 size={13} strokeWidth={1.9} className="animate-spin" />
              ) : (
                <Trash2 size={13} strokeWidth={1.9} />
              )}
              {confirmRemove ? t("Click again to remove") : t("Remove credentials")}
            </button>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2 text-[12.5px] leading-relaxed text-ink-muted">
        <p className="font-medium text-ink">{t("Getting your own credentials")}</p>
        <ol className="flex list-decimal flex-col gap-1 pl-5">
          <li>
            {t("Sign in to the")}{" "}
            <ExtLink href="https://dev.twitch.tv/console/apps">
              {t("Twitch developer console")}
            </ExtLink>{" "}
            {t("(two-factor authentication must be turned on for your Twitch account).")}
          </li>
          <li>
            {t(
              "Register an application: any name, OAuth Redirect URL http://localhost, category Application Integration, client type Confidential.",
            )}
          </li>
          <li>
            {t(
              "Open the application, copy its Client ID, then click New Secret and copy the Client Secret.",
            )}
          </li>
        </ol>
        <p>
          {t("More about access in the")}{" "}
          <ExtLink href="https://api-docs.igdb.com/#account-creation">
            {t("IGDB API documentation")}
          </ExtLink>
          .
        </p>
      </div>

      <p className="text-[12px] leading-relaxed text-ink-subtle">
        {t(
          "Saved only on this device, in its secure credential store (Windows Credential Manager or macOS Keychain) for your device user account. They're shared by every Nexa profile on this device, never synced to your Nexa account and never included in backups, so enter them separately on each device. Nexa sends them only to Twitch, to get IGDB access.",
        )}
      </p>
    </Section>
  );
}
