import { ArrowLeft, ChevronDown, History, Info, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadInstalled, reorderInstalled, type InstalledAddon } from "@/lib/addon-store";
import {
  applyOrderToItems,
  loadBackups,
  moveItem,
  pushBackup,
  saveDisplayOrder,
  sequencesEqual,
  type AddonOrderBackup,
} from "@/lib/addons-store/reorder";
import { pushOverlayPin } from "@/lib/overlay-pin";
import { useSearch } from "@/lib/search-context";
import { useT } from "@/lib/i18n";
import { BackupsPanel } from "./backups-card";
import { OrganizeList, SectionCard, SkeletonRows } from "./section-card";
import { entriesOf, urlsOf, type Notice } from "./utils";
import { useDragList } from "./use-drag-list";

type Phase = { kind: "loading" } | { kind: "ready" } | { kind: "saving" };

export function OrganizeAddonsPage({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (scope: "local") => void;
}) {
  const t = useT();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [notice, setNotice] = useState<Notice | null>(null);
  const [baseline, setBaseline] = useState<InstalledAddon[]>([]);
  const [working, setWorking] = useState<InstalledAddon[]>([]);
  const [backupsKey, setBackupsKey] = useState(0);
  const [backupsOpen, setBackupsOpen] = useState(false);
  const backupsWrapRef = useRef<HTMLDivElement>(null);
  const backupCount = useMemo(() => loadBackups().length, [backupsKey]);

  const load = useCallback(() => {
    setPhase({ kind: "loading" });
    setNotice(null);
    const device = loadInstalled();
    setBaseline(device);
    setWorking(device);
    setPhase({ kind: "ready" });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => pushOverlayPin(), []);

  const drag = useDragList(working.length, (from, to) => setWorking((l) => moveItem(l, from, to)));

  const search = useSearch();
  const escBlockRef = useRef(false);
  const backupsOpenRef = useRef(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    escBlockRef.current = search.open || phase.kind === "saving" || drag.dragIndex != null;
    backupsOpenRef.current = backupsOpen;
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (backupsOpenRef.current) {
        e.preventDefault();
        setBackupsOpen(false);
        return;
      }
      if (escBlockRef.current) return;
      e.preventDefault();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  useEffect(() => {
    if (!backupsOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!backupsWrapRef.current?.contains(e.target as Node)) setBackupsOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [backupsOpen]);

  const dirty = !sequencesEqual(urlsOf(working), urlsOf(baseline));
  const saving = phase.kind === "saving";

  const handleSave = () => {
    if (!dirty || phase.kind !== "ready") return;
    setNotice(null);
    const urls = urlsOf(working);
    try {
      saveDisplayOrder(urls);
      reorderInstalled(urls);
      onSaved("local");
    } catch (e) {
      console.warn("[addons] reorder save failed", e);
      setPhase({ kind: "ready" });
      setNotice({
        tone: "danger",
        text: t("Couldn't save the new order. Nothing was changed."),
        retry: true,
      });
    }
  };

  const handleBackupNow = () => {
    if (working.length === 0) return;
    pushBackup(working);
    setBackupsKey((k) => k + 1);
    setNotice({
      tone: "info",
      text: t("Backed up. The current order is saved in the Backups panel."),
    });
  };

  const handleRestore = (backup: AddonOrderBackup) => {
    setWorking(applyOrderToItems(baseline, backup.urls));
    setBackupsOpen(false);
    setNotice({
      tone: "info",
      text: t(
        "Backup loaded into the editor. Addons added since stay at the end. Nothing changes until you press Save.",
      ),
    });
  };

  const showBackups = true;

  return (
    <div className="fixed inset-0 z-[140] flex flex-col bg-canvas animate-in fade-in duration-150">
      <header
        data-tauri-drag-region
        className="relative z-50 shrink-0 border-b border-edge-soft bg-canvas/85 backdrop-blur-xl"
      >
        <div className="mx-auto flex w-full max-w-[1160px] items-center gap-4 px-6 py-5 sm:px-10">
          <button
            onClick={onClose}
            disabled={saving}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-elevated text-ink-muted ring-1 ring-edge-soft transition-colors hover:bg-raised hover:text-ink disabled:opacity-40"
            aria-label={t("Back to addons")}
            title={t("Back to addons")}
          >
            <ArrowLeft size={18} strokeWidth={2.2} className="dir-icon" />
          </button>
          <div className="flex min-w-0 flex-1 flex-col">
            <h1 className="truncate font-display text-[26px] font-medium tracking-tight text-ink sm:text-[30px]">
              {t("Organize addons")}
            </h1>
            <p className="hidden truncate text-[13px] text-ink-muted sm:block">
              {t(
                "The order decides who answers first when you press Play. Drag, use the arrows, or jump anything straight to the top.",
              )}
            </p>
          </div>
          {showBackups && (
            <div ref={backupsWrapRef} className="relative shrink-0">
              <button
                onClick={() => setBackupsOpen((v) => !v)}
                className={`flex h-11 items-center gap-2 rounded-full px-4 text-[13.5px] font-semibold ring-1 transition-colors ${
                  backupsOpen
                    ? "bg-raised text-ink ring-edge"
                    : "bg-elevated text-ink-muted ring-edge-soft hover:bg-raised hover:text-ink"
                }`}
              >
                <History size={15} strokeWidth={2.2} />
                {t("Backups")}
                {backupCount > 0 && (
                  <span className="rounded-full bg-accent/15 px-2 text-[11px] font-bold text-accent">
                    {backupCount}
                  </span>
                )}
                <ChevronDown
                  size={14}
                  strokeWidth={2.4}
                  className={`transition-transform duration-200 ${backupsOpen ? "rotate-180" : ""}`}
                />
              </button>
              {backupsOpen && (
                <div className="absolute end-0 top-[calc(100%+12px)] z-20 max-h-[64vh] w-[min(92vw,420px)] overflow-y-auto rounded-2xl border border-edge bg-elevated shadow-[0_28px_72px_-20px_rgba(0,0,0,0.7)] animate-popover-in">
                  <BackupsPanel
                    refreshKey={backupsKey}
                    busy={saving}
                    canBackup={working.length > 0 && phase.kind === "ready"}
                    onBackupNow={handleBackupNow}
                    onRestore={handleRestore}
                  />
                </div>
              )}
            </div>
          )}
          {
            <div className="flex shrink-0 items-center gap-2.5">
              <button
                onClick={onClose}
                disabled={saving}
                className="flex h-11 items-center rounded-full bg-elevated px-5 text-[13.5px] font-semibold text-ink-muted ring-1 ring-edge-soft transition-colors hover:bg-raised hover:text-ink disabled:opacity-40"
              >
                {t("Cancel")}
              </button>
              <button
                onClick={handleSave}
                disabled={!dirty || phase.kind !== "ready"}
                className={`flex h-11 items-center gap-2 rounded-full bg-ink px-6 text-[14px] font-semibold text-canvas transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 ${
                  dirty && !saving ? "ring-2 ring-accent/50" : ""
                }`}
              >
                {saving ? (
                  <>
                    <Loader2 size={15} className="animate-spin" />
                    {t("Saving…")}
                  </>
                ) : (
                  t("Save order")
                )}
              </button>
            </div>
          }
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1160px] px-6 py-8 sm:px-10">
          {
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
              <div className="flex min-w-0 flex-col gap-6">
                {notice && (
                  <div
                    className={`flex flex-col gap-3 rounded-2xl px-5 py-4 text-[13.5px] ring-1 ${
                      notice.tone === "danger"
                        ? "bg-danger/15 text-danger ring-danger/30"
                        : "bg-elevated/70 text-ink-muted ring-edge"
                    }`}
                  >
                    <p className="leading-relaxed">{notice.text}</p>
                    {(notice.retry || notice.reload) && (
                      <div className="flex items-center gap-2.5">
                        {notice.retry && (
                          <button
                            onClick={handleSave}
                            className="rounded-full bg-raised px-4 py-1.5 text-[12.5px] font-semibold text-ink-muted transition-colors hover:bg-elevated hover:text-ink"
                          >
                            {t("Retry")}
                          </button>
                        )}
                        {notice.reload && (
                          <button
                            onClick={load}
                            className="rounded-full bg-raised px-4 py-1.5 text-[12.5px] font-semibold text-ink-muted transition-colors hover:bg-elevated hover:text-ink"
                          >
                            {t("Reload list")}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
                <SectionCard
                  title={t("Your addons")}
                  sub={t("The order decides who answers first when you press Play.")}
                  count={working.length}
                >
                  {phase.kind === "loading" ? (
                    <SkeletonRows />
                  ) : working.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-edge-soft bg-canvas/30 px-5 py-4 text-[13.5px] text-ink-subtle">
                      {t("No addons installed yet.")}
                    </p>
                  ) : (
                    <OrganizeList
                      entries={entriesOf(working)}
                      drag={drag}
                      busy={saving}
                      onMove={(i, delta) => setWorking((l) => moveItem(l, i, i + delta))}
                      onMoveTop={(i) => setWorking((l) => moveItem(l, i, 0))}
                    />
                  )}
                </SectionCard>
              </div>

              <div className="flex flex-col gap-6 lg:sticky lg:top-6 lg:self-start">
                <section className="rounded-2xl border border-edge-soft bg-elevated/40 p-5">
                  <div className="mb-2 flex items-center gap-2">
                    <Info size={15} strokeWidth={2.2} className="text-ink-muted" />
                    <h2 className="font-display text-[18px] font-medium tracking-tight text-ink">
                      {t("Good to know")}
                    </h2>
                  </div>
                  <ul className="flex flex-col gap-2.5 text-[13px] leading-relaxed text-ink-muted">
                    <li>{t("Number 1 gets asked first for streams when you press Play.")}</li>
                    <li>
                      {t("The order also decides which addon's rows win on your Home screen.")}
                    </li>
                    <li>
                      {t("Nothing changes until you press Save. Leaving this page discards edits.")}
                    </li>
                    <li>
                      {t(
                        "The Backups button at the top keeps your last five orders. One click restores any of them.",
                      )}
                    </li>
                  </ul>
                </section>
              </div>
            </div>
          }
        </div>
        <div className="h-10" />
      </div>
    </div>
  );
}
