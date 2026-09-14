import { downloadText } from "@/lib/download-text";
import { loadBgImage, saveBgImage } from "@/lib/theme-storage";

declare const __APP_VERSION__: string;

const FORMAT = "harbor-backup";
const VERSION = 1;

export type Backup = {
  format: string;
  version: number;
  app: string;
  exportedAt: string;
  data: Record<string, string>;
  bgImage?: string | null;
};

function isPortable(key: string): boolean {
  if (!key.startsWith("harbor.")) return false;
  if (key === "harbor.auth" || key.startsWith("harbor.auth.")) return false;
  if (key === "harbor.together.clientId") return false;
  // Credentials. Exporting these writes a live refresh token into the .harbx in
  // plaintext, and restoring one wipes the session of whoever is signed in now.
  if (key.startsWith("harbor.supabase.")) return false;
  // Per-device sync bookkeeping, not user data. The pending-op queue belongs to
  // the device that recorded it, and the migration gates record "this device has
  // already merged with the cloud" -- restoring one onto a fresh device makes the
  // next hydrate treat local-only rows as deletions and silently drop them.
  if (key.startsWith("harbor.cloud.")) return false;
  // Tracks which account this device's local data currently belongs to. Never
  // part of a backup, and never wiped by wipePortableLocalData itself.
  if (key === "harbor.local.ownerUserId") return false;
  // "Has this installation introduced itself yet?" is a property of the
  // device, not of the account: wiping it on sign-out meant the first-run
  // wizard greeted a returning user every time they signed back in. The
  // account-following half of it -- so a new device signing into an
  // established account skips the wizard too, and dismissed nudges travel --
  // is carried in the settings row's side-store bundle instead.
  if (key === "harbor.onboarding") return false;
  return true;
}

/**
 * Removes every portable (user-following) key from localStorage, leaving only
 * device/session bookkeeping (auth token, cloud sync queue, migration gates,
 * the local-data owner marker) untouched. This is the same boundary a backup
 * export/restore uses -- profiles, addons, watchlist, watch progress, theme,
 * and every other setting a user would expect to move with their account.
 */
export function wipePortableLocalData(): void {
  const stale: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && isPortable(key)) stale.push(key);
  }
  for (const key of stale) localStorage.removeItem(key);
}

export async function buildBackup(): Promise<Backup> {
  const data: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !isPortable(key)) continue;
    const value = localStorage.getItem(key);
    if (value != null) data[key] = value;
  }
  const bgImage = await loadBgImage();
  return {
    format: FORMAT,
    version: VERSION,
    app: typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev",
    exportedAt: new Date().toISOString(),
    data,
    ...(bgImage ? { bgImage } : {}),
  };
}

export async function downloadBackup(): Promise<boolean> {
  const backup = await buildBackup();
  const text = JSON.stringify(backup, null, 2);
  const stamp = new Date().toISOString().slice(0, 10);
  return downloadText(`nexa-backup-${stamp}.harbx`, text, ["harbx"], "Nexa backup");
}

export type ParsedBackup = { ok: true; backup: Backup } | { ok: false; error: string };

export function parseBackup(text: string): ParsedBackup {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file is not valid JSON." };
  }
  if (!json || typeof json !== "object") {
    return { ok: false, error: "Unrecognized file." };
  }
  const b = json as Partial<Backup>;
  if (b.format !== FORMAT) {
    return { ok: false, error: "This is not a Nexa backup file." };
  }
  if (!b.data || typeof b.data !== "object") {
    return { ok: false, error: "This backup has no data in it." };
  }
  const data: Record<string, string> = {};
  for (const [k, v] of Object.entries(b.data)) {
    if (typeof v === "string" && isPortable(k)) data[k] = v;
  }
  if (Object.keys(data).length === 0) {
    return { ok: false, error: "This backup contained nothing restorable." };
  }
  return {
    ok: true,
    backup: {
      format: FORMAT,
      version: typeof b.version === "number" ? b.version : VERSION,
      app: typeof b.app === "string" ? b.app : "unknown",
      exportedAt: typeof b.exportedAt === "string" ? b.exportedAt : "",
      data,
      ...(typeof b.bgImage === "string" || b.bgImage === null ? { bgImage: b.bgImage } : {}),
    },
  };
}

export function backupKeyCount(backup: Backup): number {
  return Object.keys(backup.data).length;
}

export async function applyBackup(backup: Backup): Promise<void> {
  wipePortableLocalData();
  for (const [k, v] of Object.entries(backup.data)) {
    if (!isPortable(k)) continue;
    try {
      localStorage.setItem(k, v);
    } catch {
      /* keep restoring the rest even if one entry is rejected */
    }
  }
  if (backup.bgImage !== undefined) {
    try {
      await saveBgImage(backup.bgImage);
    } catch {
      /* background restore is best-effort */
    }
  }
}
