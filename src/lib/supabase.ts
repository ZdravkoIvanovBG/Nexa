import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { setItemWithRecovery } from "@/lib/storage-recovery";
import { isSecondaryWindow } from "@/lib/window-role";

export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || "";
export const SUPABASE_ANON_KEY =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || "";

/** Storage slot for the persisted session. Also read synchronously at boot. */
export const SUPABASE_STORAGE_KEY = "harbor.supabase.auth";

/** False when the build has no credentials -- callers degrade instead of throwing. */
export const supabaseConfigured = !!SUPABASE_URL && !!SUPABASE_ANON_KEY;

// createClient throws on an empty URL, so a credential-less build gets a stub
// whose every call rejects. Keeps `import { supabase }` safe at module scope.
function createStub(): SupabaseClient {
  const fail = () => Promise.reject(new Error("Supabase is not configured"));
  return new Proxy({} as SupabaseClient, {
    get: () => new Proxy(fail, { get: () => fail }),
  });
}

/**
 * localStorage, but a full disk cannot cost us the session.
 *
 * auth-js persists the rotated refresh token with a bare setItem *after* the
 * server has already invalidated the old one. If that write throws on quota the
 * token is gone for good: the next boot presents a burned token, the refresh
 * fails with invalid_grant, and the client signs the user out. Routing through
 * setItemWithRecovery evicts prunable caches to make room instead.
 */
const quotaSafeStorage = {
  getItem: (key: string): string | null => {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      console.error("[supabase] could not read the stored session", e);
      return null;
    }
  },
  setItem: (key: string, value: string): void => {
    try {
      if (!setItemWithRecovery(key, value)) {
        console.error(
          `[supabase] out of localStorage room for "${key}" -- the session will not survive a restart`,
        );
      }
    } catch (e) {
      // setItemWithRecovery re-throws anything that is not a quota error, and a
      // SecurityError escaping _saveSession loses the token the same way.
      console.error(`[supabase] could not persist "${key}"`, e);
    }
  },
  removeItem: (key: string): void => {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      console.error(`[supabase] could not clear "${key}"`, e);
    }
  },
};

// PiP and the two overlays share this origin with the main window. A second
// auto-refreshing client there would race the main one for the same refresh
// token, so those windows get a read-only, non-persisting client.
const secondary = isSecondaryWindow();

export const supabase: SupabaseClient = supabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: !secondary,
        autoRefreshToken: !secondary,
        storageKey: SUPABASE_STORAGE_KEY,
        storage: quotaSafeStorage,
        // Tauri runs on memory history: there is never a token in the URL, and
        // leaving this on makes the client parse window.location on every boot.
        detectSessionInUrl: false,
      },
    })
  : createStub();
