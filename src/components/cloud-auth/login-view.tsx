import { Eye, EyeOff, Loader2, MailCheck, WifiOff } from "lucide-react";
import { useRef, useState } from "react";
import { HarborMark } from "@/components/icons/harbor-mark";
import { useCloudSession } from "@/lib/cloud/session";
import { useT } from "@/lib/i18n";
import { useTvFocusScope } from "@/lib/keyboard-navigation";
import { supabaseConfigured } from "@/lib/supabase";
import { Segmented } from "@/views/settings/shared";

type Mode = "login" | "register";

const MIN_PASSWORD = 6;

export function LoginView() {
  const t = useT();
  const { signIn, signUp } = useCloudSession();
  const rootRef = useRef<HTMLDivElement>(null);
  useTvFocusScope(true, rootRef);

  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setConfirm("");
  };

  const registering = mode === "register";
  const ready =
    !!email.trim() &&
    password.length >= MIN_PASSWORD &&
    (!registering || confirm.length >= MIN_PASSWORD);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (registering && password !== confirm) {
      setError(t("Those passwords do not match."));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (registering) {
        const { needsConfirmation } = await signUp(email, password);
        if (needsConfirmation) {
          setSentTo(email.trim());
          setBusy(false);
          return;
        }
      } else {
        await signIn(email, password);
      }
      // On success the session provider flips status and this view unmounts.
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Something went wrong. Try again."));
      setBusy(false);
    }
  };

  if (!supabaseConfigured) return <MissingConfig />;
  if (sentTo) return <ConfirmSent email={sentTo} onBack={() => setSentTo(null)} />;

  return (
    <div
      ref={rootRef}
      data-tauri-drag-region
      data-tv-focus-scope
      className="animate-fade-in fixed inset-0 z-[240] flex flex-col items-center justify-center overflow-y-auto bg-canvas px-6 py-12"
    >
      <div className="flex flex-col items-center gap-2.5">
        <HarborMark className="h-14 w-14 text-ink" />
        <h1 className="font-display text-[34px] font-medium leading-tight tracking-tight text-ink">
          {t("Welcome to Nexa")}
        </h1>
        <p className="max-w-sm text-center text-[13.5px] leading-relaxed text-ink-muted">
          {t("Sign in to keep your watchlist, progress, and rankings on every device.")}
        </p>
      </div>

      <div className="mt-7">
        <Segmented<Mode>
          value={mode}
          onChange={switchMode}
          options={[
            { value: "login", label: "Sign in" },
            { value: "register", label: "Create account" },
          ]}
        />
      </div>

      <form
        onSubmit={submit}
        className="animate-modal-in mt-5 flex w-[min(92vw,400px)] flex-col gap-4 rounded-2xl border border-edge-soft bg-elevated p-7 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)]"
      >
        <Field
          label={t("Email")}
          type="email"
          value={email}
          onChange={setEmail}
          disabled={busy}
          autoFocus
          autoComplete="email"
        />
        <Field
          label={t("Password")}
          type="password"
          value={password}
          onChange={setPassword}
          disabled={busy}
          autoComplete={registering ? "new-password" : "current-password"}
        />
        {registering && (
          <Field
            label={t("Confirm password")}
            type="password"
            value={confirm}
            onChange={setConfirm}
            disabled={busy}
            autoComplete="new-password"
          />
        )}

        {registering && (
          <p className="text-[11.5px] leading-snug text-ink-subtle">
            {t("Use at least {n} characters.", { n: MIN_PASSWORD })}
          </p>
        )}

        {error && (
          <p className="rounded-lg bg-danger/15 px-3 py-2 text-[12.5px] text-danger">{error}</p>
        )}

        <button
          type="submit"
          disabled={busy || !ready}
          className="flex h-11 items-center justify-center gap-2 rounded-xl bg-ink text-[14px] font-semibold text-canvas transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? (
            <>
              <Loader2 size={15} className="animate-spin" />
              {registering ? t("Creating account...") : t("Signing in...")}
            </>
          ) : registering ? (
            t("Create account")
          ) : (
            t("Sign in")
          )}
        </button>
      </form>
    </div>
  );
}

function GateShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-tauri-drag-region
      data-tv-focus-scope
      className="animate-fade-in fixed inset-0 z-[240] flex flex-col items-center justify-center gap-5 bg-canvas px-8 text-center"
    >
      {children}
    </div>
  );
}

function ConfirmSent({ email, onBack }: { email: string; onBack: () => void }) {
  const t = useT();
  return (
    <GateShell>
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-elevated/60 text-ink-subtle ring-1 ring-edge-soft/60">
        <MailCheck size={24} strokeWidth={1.6} />
      </span>
      <h1 className="font-display text-[26px] font-medium tracking-tight text-ink">
        {t("Check your inbox")}
      </h1>
      <p className="max-w-sm text-[13.5px] leading-relaxed text-ink-muted">
        {t("We sent a confirmation link to {email}. Open it, then sign in here.", { email })}
      </p>
      <button
        type="button"
        autoFocus
        onClick={onBack}
        className="h-11 rounded-xl border border-edge bg-elevated px-6 text-[13.5px] font-semibold text-ink transition-colors hover:bg-raised"
      >
        {t("Back to sign in")}
      </button>
    </GateShell>
  );
}

function MissingConfig() {
  const t = useT();
  return (
    <GateShell>
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-elevated/60 text-ink-subtle ring-1 ring-edge-soft/60">
        <WifiOff size={24} strokeWidth={1.6} />
      </span>
      <h1 className="font-display text-[26px] font-medium tracking-tight text-ink">
        {t("Cloud sync is not configured")}
      </h1>
      <p className="max-w-md text-[13.5px] leading-relaxed text-ink-muted">
        {t(
          "This build has no Supabase credentials. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env, then restart.",
        )}
      </p>
    </GateShell>
  );
}

function Field({
  label,
  type,
  value,
  onChange,
  autoFocus,
  disabled,
  autoComplete,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  disabled?: boolean;
  autoComplete?: string;
}) {
  const t = useT();
  const [show, setShow] = useState(false);
  const isPassword = type === "password";
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-subtle">
        {label}
      </span>
      <div className="relative">
        <input
          type={isPassword && show ? "text" : type}
          value={value}
          autoFocus={autoFocus}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          autoComplete={autoComplete}
          className={`h-11 w-full rounded-xl border border-edge bg-canvas px-3.5 text-[14px] text-ink outline-none transition-colors focus:border-ink disabled:opacity-50 ${
            isPassword ? "pe-11" : ""
          }`}
        />
        {isPassword && (
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setShow((v) => !v)}
            disabled={disabled}
            aria-label={show ? t("Hide password") : t("Show password")}
            title={show ? t("Hide password") : t("Show password")}
            className="absolute inset-y-0 end-0 flex w-11 items-center justify-center text-ink-subtle transition-colors hover:text-ink disabled:opacity-50"
          >
            {show ? <EyeOff size={17} strokeWidth={2} /> : <Eye size={17} strokeWidth={2} />}
          </button>
        )}
      </div>
    </label>
  );
}
