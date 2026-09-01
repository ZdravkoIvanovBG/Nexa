import { Check, Loader2 } from "lucide-react";
import { useState } from "react";
import { useT } from "@/lib/i18n";
import { supabase } from "@/lib/supabase";

const MIN_PASSWORD = 6;

export function ChangePasswordRow({ email }: { email: string | null }) {
  const t = useT();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [resetSent, setResetSent] = useState(false);

  const ready = password.length >= MIN_PASSWORD && password === confirm;

  const save = async () => {
    if (!ready) return;
    setBusy(true);
    setMessage(null);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setMessage({ kind: "success", text: t("Password updated.") });
      setPassword("");
      setConfirm("");
    } catch (err) {
      setMessage({
        kind: "error",
        text: err instanceof Error ? err.message : t("Couldn't update your password."),
      });
    } finally {
      setBusy(false);
    }
  };

  const sendReset = async () => {
    if (!email) return;
    setBusy(true);
    setMessage(null);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email);
      if (error) throw error;
      setResetSent(true);
    } catch (err) {
      setMessage({
        kind: "error",
        text: err instanceof Error ? err.message : t("Couldn't send the reset email."),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 border-t border-edge-soft/60 pt-4">
      <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-subtle">
        {t("Change password")}
      </span>
      <div className="flex flex-wrap gap-2.5">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t("New password")}
          autoComplete="new-password"
          className="h-10 min-w-[180px] flex-1 rounded-xl border border-edge bg-canvas px-3.5 text-[13.5px] text-ink outline-none transition-colors focus:border-ink"
        />
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder={t("Confirm password")}
          autoComplete="new-password"
          className="h-10 min-w-[180px] flex-1 rounded-xl border border-edge bg-canvas px-3.5 text-[13.5px] text-ink outline-none transition-colors focus:border-ink"
        />
        <button
          type="button"
          onClick={() => void save()}
          disabled={!ready || busy}
          className="flex h-10 items-center gap-1.5 rounded-xl bg-ink px-4 text-[12.5px] font-semibold text-canvas transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Check size={13} strokeWidth={2.6} />
          )}
          {t("Save")}
        </button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11.5px] leading-relaxed text-ink-subtle">
          {t("Use at least {n} characters.", { n: MIN_PASSWORD })}
        </p>
        <button
          type="button"
          onClick={() => void sendReset()}
          disabled={!email || busy}
          className="text-[12px] font-medium text-ink-muted underline-offset-4 transition-colors hover:text-ink hover:underline disabled:opacity-50"
        >
          {resetSent ? t("Reset email sent.") : t("Send password reset email instead")}
        </button>
      </div>
      {message && (
        <p className={`text-[12.5px] ${message.kind === "error" ? "text-danger" : "text-accent"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
