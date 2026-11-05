import { KeyRound, MonitorSmartphone, RefreshCw, ShieldAlert, WifiOff } from "lucide-react";
import type { ReactNode } from "react";
import type { GamesErrorKind } from "@/lib/game-discovery/errors";
import type { GameProvider } from "@/lib/game-discovery/game-id";
import type { GamesConfigState } from "@/lib/game-discovery/gates";
import { useT } from "@/lib/i18n";
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

/** Shown instead of content when the active provider can't serve requests yet. */
export function GamesConfigState({ state }: { state: GamesConfigState }) {
  const t = useT();
  const { openSettings } = useView();
  const open = (
    <ActionButton onClick={() => openSettings("games")}>
      <KeyRound size={15} strokeWidth={1.9} />
      {t("Open Settings → Games")}
    </ActionButton>
  );
  if (state === "igdb_checking") {
    // A local credential-store read: nothing to explain yet.
    return <div aria-busy className="h-[320px] animate-pulse rounded-2xl bg-elevated/30" />;
  }
  if (state === "igdb_missing") {
    return (
      <StateCard
        icon={<KeyRound size={18} strokeWidth={1.9} />}
        title={t("Connect IGDB")}
        body={t(
          "Games uses IGDB for game data. Add your Twitch developer Client ID and Client Secret in Settings to start browsing.",
        )}
        action={open}
      />
    );
  }
  if (state === "igdb_unverified") {
    return (
      <StateCard
        icon={<KeyRound size={18} strokeWidth={1.9} />}
        title={t("Verify your IGDB credentials")}
        body={t(
          "Your IGDB credentials haven't been verified on this device yet. Verify them in Settings to continue.",
        )}
        action={open}
      />
    );
  }
  if (state === "igdb_rejected") {
    return (
      <StateCard
        icon={<ShieldAlert size={18} strokeWidth={1.9} />}
        title={t("IGDB credentials rejected")}
        body={t("Twitch rejected your IGDB credentials. Check or replace them in Settings.")}
        action={open}
      />
    );
  }
  if (state === "igdb_unsupported") {
    return (
      <StateCard
        icon={<MonitorSmartphone size={18} strokeWidth={1.9} />}
        title={t("IGDB needs the desktop app")}
        body={t(
          "IGDB credentials are kept in your device's secure credential store, which is available in the Nexa desktop app on Windows and macOS.",
        )}
      />
    );
  }
  if (state === "igdb_unavailable") {
    return (
      <StateCard
        icon={<ShieldAlert size={18} strokeWidth={1.9} />}
        title={t("Credential store unavailable")}
        body={t(
          "Nexa couldn't open this device's credential store to read your IGDB credentials. Check again in Settings.",
        )}
        action={open}
      />
    );
  }
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
  provider,
  kind,
  onRetry,
}: {
  provider: GameProvider;
  kind: GamesErrorKind | null;
  onRetry?: () => void;
}) {
  const t = useT();
  const retry = onRetry ? (
    <ActionButton onClick={onRetry}>
      <RefreshCw size={15} strokeWidth={1.9} />
      {t("Try again")}
    </ActionButton>
  ) : undefined;
  if (provider === "igdb") {
    if (kind === "network") {
      return (
        <StateCard
          icon={<WifiOff size={18} strokeWidth={1.9} />}
          title={t("Can't reach IGDB")}
          body={t("Check your internet connection and try again.")}
          action={retry}
        />
      );
    }
    if (kind === "rate_limited") {
      return (
        <StateCard
          icon={<ShieldAlert size={18} strokeWidth={1.9} />}
          title={t("IGDB request limit reached")}
          body={t("IGDB is limiting requests for a moment. Try again in a few seconds.")}
          action={retry}
        />
      );
    }
    if (kind === "credentials") {
      return (
        <StateCard
          icon={<ShieldAlert size={18} strokeWidth={1.9} />}
          title={t("IGDB credentials rejected")}
          body={t("Twitch rejected your IGDB credentials. Check or replace them in Settings.")}
          action={retry}
        />
      );
    }
    return (
      <StateCard
        icon={<ShieldAlert size={18} strokeWidth={1.9} />}
        title={t("IGDB is unavailable")}
        body={t("IGDB didn't respond as expected. Try again in a moment.")}
        action={retry}
      />
    );
  }
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
