import { KeyRound, RefreshCw, ShieldAlert, WifiOff } from "lucide-react";
import type { ReactNode } from "react";
import type { RawgConfigState } from "@/lib/game-discovery/gates";
import { useT } from "@/lib/i18n";
import type { RawgErrorKind } from "@/lib/providers/rawg";
import { useView } from "@/lib/view";

function StateCard({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-edge px-6 py-16 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-elevated text-ink-muted ring-1 ring-edge-soft">
        {icon}
      </span>
      <h2 className="text-[17px] font-medium tracking-tight text-ink">{title}</h2>
      <p className="max-w-md text-[14px] leading-relaxed text-ink-muted">{body}</p>
      {action}
    </div>
  );
}

function ActionButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="mt-2 flex h-10 items-center gap-2 rounded-full border border-edge bg-canvas/50 px-5 text-[13.5px] font-medium text-ink transition-colors hover:bg-elevated"
    >
      {children}
    </button>
  );
}

/** Shown instead of content when RAWG requests aren't allowed (no key, unverified, rejected). */
export function GamesConfigState({ state }: { state: Exclude<RawgConfigState, "ready"> }) {
  const t = useT();
  const { openSettings } = useView();
  const open = (
    <ActionButton onClick={() => openSettings("games")}>
      <KeyRound size={15} strokeWidth={1.9} />
      {t("Open Settings → Games")}
    </ActionButton>
  );
  if (state === "missing_key") {
    return (
      <StateCard
        icon={<KeyRound size={18} strokeWidth={1.9} />}
        title={t("Connect RAWG")}
        body={t(
          "Games uses RAWG for game data. Add your free RAWG API key in Settings to start browsing.",
        )}
        action={open}
      />
    );
  }
  if (state === "unverified") {
    return (
      <StateCard
        icon={<KeyRound size={18} strokeWidth={1.9} />}
        title={t("Verify your RAWG key")}
        body={t(
          "Your RAWG API key changed or hasn't been verified yet. Verify it in Settings to continue.",
        )}
        action={open}
      />
    );
  }
  return (
    <StateCard
      icon={<ShieldAlert size={18} strokeWidth={1.9} />}
      title={t("RAWG key rejected")}
      body={t("RAWG rejected your API key. Check or replace it in Settings.")}
      action={open}
    />
  );
}

/** Page-level failure when nothing could be loaded. */
export function GamesErrorState({
  kind,
  onRetry,
}: {
  kind: RawgErrorKind | null;
  onRetry?: () => void;
}) {
  const t = useT();
  const retry = onRetry ? (
    <ActionButton onClick={onRetry}>
      <RefreshCw size={15} strokeWidth={1.9} />
      {t("Try again")}
    </ActionButton>
  ) : undefined;
  if (kind === "network") {
    return (
      <StateCard
        icon={<WifiOff size={18} strokeWidth={1.9} />}
        title={t("Can't reach RAWG")}
        body={t("Check your internet connection and try again.")}
        action={retry}
      />
    );
  }
  if (kind === "rate_limited") {
    return (
      <StateCard
        icon={<ShieldAlert size={18} strokeWidth={1.9} />}
        title={t("RAWG request limit reached")}
        body={t(
          "Your RAWG key has used its request allowance for now. The free plan allows 20,000 requests a month.",
        )}
        action={retry}
      />
    );
  }
  return (
    <StateCard
      icon={<ShieldAlert size={18} strokeWidth={1.9} />}
      title={t("RAWG is unavailable")}
      body={t("RAWG didn't respond as expected. Try again in a moment.")}
      action={retry}
    />
  );
}

export function GamesNotice({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center justify-center rounded-2xl border border-dashed border-edge px-6 py-16 text-center text-[14.5px] text-ink-muted">
      {children}
    </div>
  );
}
