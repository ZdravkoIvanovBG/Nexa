import type { Session, User } from "@supabase/supabase-js";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { wipePortableLocalData } from "@/lib/backup";
import { readCachedSupabaseUserId, supabase, supabaseConfigured } from "@/lib/supabase";
import { profilesSyncedFor } from "./hydrate";
import { flush, pendingCount } from "./queue";

export type CloudStatus = "loading" | "signed-in" | "signed-out";

export type SignUpResult = { needsConfirmation: boolean };

type CloudSessionValue = {
  session: Session | null;
  user: User | null;
  /** Live user id, or the cached one while offline. Null when signed out. */
  userId: string | null;
  status: CloudStatus;
  /** True when running on a cached session we could not refresh. */
  offline: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<SignUpResult>;
  signOut: () => Promise<void>;
};

const readCachedUserId = readCachedSupabaseUserId;

const LOCAL_OWNER_KEY = "harbor.local.ownerUserId";

function readLocalOwner(): string | null {
  try {
    return localStorage.getItem(LOCAL_OWNER_KEY);
  } catch {
    return null;
  }
}

function writeLocalOwner(userId: string): void {
  try {
    localStorage.setItem(LOCAL_OWNER_KEY, userId);
  } catch {
    /* ignore */
  }
}

/**
 * Profiles, addons, and watch data live in bare `harbor.*` keys with no
 * per-account scoping. Without this, signing into a different account on the
 * same device would silently adopt -- and then upload -- whatever the
 * previous account left behind (addons especially: hydrateFromCloud always
 * merges them local-first). Must run, and win, before anything else reads or
 * hydrates that data, so every call site that learns of a concrete signed-in
 * user id checks in here first.
 */
function claimLocalData(userId: string): boolean {
  const owner = readLocalOwner();
  const mismatch = !!owner && owner !== userId;
  if (mismatch) wipePortableLocalData();
  writeLocalOwner(userId);
  return mismatch;
}

function isNetworkError(err: unknown): boolean {
  if (!err) return false;
  const name = (err as { name?: string }).name ?? "";
  const message = (err as { message?: string }).message ?? "";
  return (
    name === "AuthRetryableFetchError" ||
    name === "TypeError" ||
    /fetch|network|offline|timeout/i.test(message)
  );
}

const Ctx = createContext<CloudSessionValue | null>(null);

export function CloudSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [cachedUserId, setCachedUserId] = useState<string | null>(() =>
    supabaseConfigured ? readCachedUserId() : null,
  );
  const [status, setStatus] = useState<CloudStatus>(() =>
    supabaseConfigured && readCachedUserId() ? "signed-in" : "signed-out",
  );
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (!supabaseConfigured) return;
    let cancelled = false;

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) throw error;
        const uid = data.session?.user.id ?? null;
        if (uid && claimLocalData(uid)) {
          window.location.reload();
          return;
        }
        setSession(data.session);
        setCachedUserId(uid);
        setStatus(data.session ? "signed-in" : "signed-out");
        setOffline(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // A dead network must not evict a user from a cached session -- that
        // would lock them out of an app that otherwise works offline.
        const cached = readCachedUserId();
        if (isNetworkError(err) && cached) {
          setCachedUserId(cached);
          setOffline(true);
          setStatus("signed-in");
          return;
        }
        setCachedUserId(null);
        setStatus("signed-out");
      });

    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      if (cancelled) return;
      if (next) {
        if (claimLocalData(next.user.id)) {
          window.location.reload();
          return;
        }
        setSession(next);
        setCachedUserId(next.user.id);
        setStatus("signed-in");
        setOffline(false);
      } else if (event === "SIGNED_OUT") {
        setSession(null);
        setCachedUserId(null);
        setStatus("signed-out");
      }
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) throw error;
    const uid = data.session?.user.id ?? null;
    if (uid && claimLocalData(uid)) {
      window.location.reload();
      return;
    }
    setSession(data.session);
    setCachedUserId(uid);
    setStatus(data.session ? "signed-in" : "signed-out");
    setOffline(false);
  }, []);

  const signUp = useCallback(async (email: string, password: string): Promise<SignUpResult> => {
    const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
    if (error) throw error;
    if (data.session) {
      if (claimLocalData(data.session.user.id)) {
        window.location.reload();
        return { needsConfirmation: false };
      }
      setSession(data.session);
      setCachedUserId(data.session.user.id);
      setStatus("signed-in");
      setOffline(false);
      return { needsConfirmation: false };
    }
    // Email confirmation is on for this project: no session until they click.
    return { needsConfirmation: true };
  }, []);

  const signOut = useCallback(async () => {
    const uid = readCachedSupabaseUserId();
    // Drain the write queue first, while the access token is still valid.
    // Store writes are debounced by 400ms, so a rename or avatar change made
    // seconds before signing out is still sitting in the queue -- and the
    // wipe + reload below would strand it there until the next sign-in, by
    // which point hydrate has already pulled the stale server copy over it.
    await flush().catch(() => {});
    // Only clear what the cloud is known to have a copy of. If the roster
    // never synced -- missing table, RLS, a first run that failed offline --
    // wiping would destroy the only copy of the user's profiles. Account
    // isolation does not depend on this: claimLocalData() clears the slate
    // anyway the moment a different account signs in on this device.
    const backedUp = pendingCount() === 0 && !!uid && profilesSyncedFor(uid);
    await supabase.auth.signOut().catch(() => {});
    if (backedUp) {
      // Profiles, addons, and watch data are plain `harbor.*` keys with no
      // per-account scoping in memory -- a reload is the only way to guarantee
      // every store (ProfilesProvider included, which reads localStorage once
      // at mount) starts clean for whoever signs in next on this device.
      wipePortableLocalData();
    } else {
      console.warn(
        "[cloud] signed out without clearing local data: it is not fully synced yet. " +
          "It will be cleared automatically if a different account signs in here.",
      );
    }
    window.location.reload();
  }, []);

  const value = useMemo<CloudSessionValue>(
    () => ({
      session,
      user: session?.user ?? null,
      userId: session?.user.id ?? cachedUserId,
      status,
      offline,
      signIn,
      signUp,
      signOut,
    }),
    [session, cachedUserId, status, offline, signIn, signUp, signOut],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCloudSession(): CloudSessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCloudSession outside CloudSessionProvider");
  return v;
}
