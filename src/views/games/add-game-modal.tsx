import { FolderOpen, Image as ImageIcon, X } from "lucide-react";
import { useState } from "react";
import { useT } from "@/lib/i18n";
import { useGames } from "@/lib/games/provider";

async function pickFile(filters?: { name: string; extensions: string[] }[]) {
  const { open } = await import("@tauri-apps/plugin-dialog");
  return open({ multiple: false, directory: false, filters });
}

async function pickDirectory() {
  const { open } = await import("@tauri-apps/plugin-dialog");
  return open({ multiple: false, directory: true });
}

export function AddGameModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { addManual } = useGames();
  const [title, setTitle] = useState("");
  const [developer, setDeveloper] = useState("");
  const [exePath, setExePath] = useState("");
  const [workingDir, setWorkingDir] = useState("");
  const [launchArgs, setLaunchArgs] = useState("");
  const [coverPath, setCoverPath] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = title.trim().length > 0 && exePath.trim().length > 0 && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await addManual({
        title: title.trim(),
        developer: developer.trim() || undefined,
        exePath: exePath.trim(),
        workingDir: workingDir.trim() || undefined,
        launchArgs: launchArgs.trim() || undefined,
        coverSourcePath: coverPath,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      data-tv-focus-scope
      className="fixed inset-0 z-[120] flex items-center justify-center overflow-hidden bg-black/60 px-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-elevated p-7 ring-1 ring-edge-soft"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-[20px] font-semibold leading-tight text-ink">{t("Add Game")}</h2>
          <button
            type="button"
            onClick={onClose}
            data-tv-modal-close
            aria-label={t("Close")}
            className="flex h-8 w-8 items-center justify-center rounded-full text-ink-subtle transition-colors hover:bg-canvas/40 hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mt-5 flex flex-col gap-3.5">
          <Field label={t("Title")}>
            <input
              data-tv-initial-focus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("Game title")}
              className="h-10 w-full rounded-lg bg-canvas px-3 text-[13.5px] text-ink outline-none ring-1 ring-edge-soft focus:ring-edge"
            />
          </Field>
          <Field label={t("Developer (optional)")}>
            <input
              value={developer}
              onChange={(e) => setDeveloper(e.target.value)}
              className="h-10 w-full rounded-lg bg-canvas px-3 text-[13.5px] text-ink outline-none ring-1 ring-edge-soft focus:ring-edge"
            />
          </Field>
          <Field label={t("Executable")}>
            <PathPicker
              value={exePath}
              placeholder={t("Choose a .exe…")}
              onPick={async () => {
                const picked = await pickFile();
                if (typeof picked === "string") setExePath(picked);
              }}
            />
          </Field>
          <Field label={t("Working directory (optional)")}>
            <PathPicker
              value={workingDir}
              placeholder={t("Defaults to the executable's folder")}
              onPick={async () => {
                const picked = await pickDirectory();
                if (typeof picked === "string") setWorkingDir(picked);
              }}
            />
          </Field>
          <Field label={t("Launch arguments (optional)")}>
            <input
              value={launchArgs}
              onChange={(e) => setLaunchArgs(e.target.value)}
              placeholder="-fullscreen -novid"
              className="h-10 w-full rounded-lg bg-canvas px-3 text-[13.5px] text-ink outline-none ring-1 ring-edge-soft focus:ring-edge"
            />
          </Field>
          <Field label={t("Cover art (optional)")}>
            <button
              type="button"
              onClick={async () => {
                const picked = await pickFile([
                  { name: "Image", extensions: ["png", "jpg", "jpeg", "webp"] },
                ]);
                if (typeof picked === "string") setCoverPath(picked);
              }}
              className="flex h-10 w-full items-center gap-2 rounded-lg bg-canvas px-3 text-[13px] text-ink-muted ring-1 ring-edge-soft transition-colors hover:text-ink"
            >
              <ImageIcon size={14} />
              <span className="truncate">{coverPath ?? t("Choose an image…")}</span>
            </button>
          </Field>
        </div>

        {error && <p className="mt-3 text-[12.5px] text-red-400">{error}</p>}

        <div className="mt-6 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 items-center justify-center rounded-full px-4 text-[13px] font-medium text-ink-muted transition-colors hover:text-ink"
          >
            {t("Cancel")}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!canSave}
            className="flex h-10 items-center justify-center rounded-full bg-ink px-5 text-[13.5px] font-semibold text-canvas transition-opacity disabled:opacity-40"
          >
            {saving ? t("Adding…") : t("Add Game")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11.5px] font-semibold uppercase tracking-[0.1em] text-ink-subtle">
        {label}
      </span>
      {children}
    </label>
  );
}

function PathPicker({
  value,
  placeholder,
  onPick,
}: {
  value: string;
  placeholder: string;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="flex h-10 w-full items-center gap-2 rounded-lg bg-canvas px-3 text-[13px] text-ink-muted ring-1 ring-edge-soft transition-colors hover:text-ink"
    >
      <FolderOpen size={14} />
      <span className="truncate">{value || placeholder}</span>
    </button>
  );
}
