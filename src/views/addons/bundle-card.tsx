import { Check, Loader2, Settings2, Sparkles } from "lucide-react";
import { useState } from "react";
import { AddonLogo } from "@/components/addon-logo";
import { openInstallerViewport } from "@/components/installer-viewport";
import { manifestToConfigureUrl } from "@/lib/addon-store";
import type { Bundle } from "@/lib/addons-store/bundles";
import { installBundle, type BundleItemResult } from "@/lib/addons-store/install-bundle";
import { useT } from "@/lib/i18n";

type CardState =
  | { kind: "idle" }
  | { kind: "installing"; done: number; total: number }
  | { kind: "done"; results: BundleItemResult[] };

export function BundleCard({
  bundle,
  onInstalled,
  showToast,
}: {
  bundle: Bundle;
  onInstalled?: () => void;
  showToast: (kind: "ok" | "error", text: string) => void;
}) {
  const t = useT();
  const [state, setState] = useState<CardState>({ kind: "idle" });

  const handleInstall = async () => {
    setState({ kind: "installing", done: 0, total: bundle.items.length });
    const results = await installBundle(bundle, (done, total) =>
      setState({ kind: "installing", done, total }),
    );
    setState({ kind: "done", results });
    onInstalled?.();
    const failed = results.filter((r) => r.status === "failed");
    const installed = results.filter((r) => r.status === "installed");
    if (failed.length === 0) {
      showToast(
        "ok",
        installed.length > 0
          ? t("Installed {n} addons", { n: installed.length })
          : t("Already installed"),
      );
    } else {
      showToast(
        "error",
        t("{n} addon(s) couldn't be installed. See details below.", {
          n: failed.length,
        }),
      );
    }
  };

  return (
    <div className="flex flex-col gap-5 rounded-2xl border border-edge bg-elevated/50 p-6">
      <div className="flex flex-col gap-1.5">
        <h3 className="font-display text-[20px] font-medium text-ink">{t(bundle.title)}</h3>
        <p className="text-[13.5px] leading-relaxed text-ink-muted">{t(bundle.blurb)}</p>
      </div>

      <div className="flex flex-col gap-2">
        {bundle.items.map((item) => {
          const result =
            state.kind === "done" ? state.results.find((r) => r.item === item) : undefined;
          return (
            <div
              key={item.transportUrl}
              className="flex items-center gap-3 rounded-xl bg-canvas/40 px-3.5 py-2.5"
            >
              <AddonLogo addonId={item.id} addonName={item.name} size="sm" />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[13px] font-medium text-ink">{item.name}</span>
                <span className="truncate text-[11px] text-ink-subtle">{t(item.role)}</span>
              </div>
              {result?.status === "failed" ? (
                <span
                  title={result.message}
                  className="shrink-0 text-[11px] font-semibold text-danger"
                >
                  {t("Failed")}
                </span>
              ) : result?.status === "already" ? (
                <span className="shrink-0 text-[11px] font-semibold text-ink-subtle">
                  {t("Already installed")}
                </span>
              ) : result?.status === "installed" ? (
                <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-emerald-400">
                  <Check size={12} strokeWidth={2.6} />
                  {t("Installed")}
                </span>
              ) : state.kind === "installing" ? (
                <Loader2 size={13} className="shrink-0 animate-spin text-ink-subtle" />
              ) : null}
              {result?.status !== "failed" &&
                item.configurable &&
                (result?.status === "installed" || result?.status === "already") && (
                  <button
                    type="button"
                    onClick={() =>
                      openInstallerViewport(
                        manifestToConfigureUrl(item.transportUrl),
                        item.name,
                        null,
                      )
                    }
                    className="flex shrink-0 items-center gap-1 rounded-full bg-raised px-2.5 py-1 text-[11px] font-semibold text-ink-muted transition-colors hover:bg-elevated hover:text-ink"
                  >
                    <Settings2 size={11} strokeWidth={2.4} />
                    {t("Configure {name}", { name: item.name })}
                  </button>
                )}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => void handleInstall()}
        disabled={state.kind === "installing"}
        className="flex h-11 items-center justify-center gap-2 rounded-full bg-ink text-[13.5px] font-semibold text-canvas transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {state.kind === "installing" ? (
          <>
            <Loader2 size={14} className="animate-spin" />
            {t("Installing… ({done}/{total})", {
              done: state.done,
              total: state.total,
            })}
          </>
        ) : state.kind === "done" ? (
          <>
            <Check size={14} strokeWidth={2.6} />
            {t("Done")}
          </>
        ) : (
          <>
            <Sparkles size={14} strokeWidth={2.4} />
            {t("Install bundle")}
          </>
        )}
      </button>
    </div>
  );
}
