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
import { supabase, supabaseConfigured, SUPABASE_STORAGE_KEY } from "@/lib/supabase";

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

/**
 * The user id in the persisted session blob, read synchronously so a returning
 * user renders the app on frame one instead of flashing the login screen while
 * getSession() resolves -- and so sync still has an owner when we are offline
 * and holding a cached session we could not refresh.
 */
function readCachedUserId(): string | null {
  try {
    const raw = localStorage.getItem(SUPABASE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { refresh_token?: unknown; user?: { id?: unknown } } | null;
    if (typeof parsed?.refresh_token !== "string") return null;
    return typeof parsed.user?.id === "string" ? parsed.user.id : null;
  } catch {
    return null;
  }
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
        setSession(data.session);
        setCachedUserId(data.session?.user.id ?? null);
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
      setSession(next);
      if (next) {
        setCachedUserId(next.user.id);
        setStatus("signed-in");
        setOffline(false);
      } else if (event === "SIGNED_OUT") {
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
    setSession(data.session);
    setCachedUserId(data.session?.user.id ?? null);
    setStatus(data.session ? "signed-in" : "signed-out");
    setOffline(false);
  }, []);

  const signUp = useCallback(async (email: string, password: string): Promise<SignUpResult> => {
    const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
    if (error) throw error;
    if (data.session) {
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
    await supabase.auth.signOut().catch(() => {});
    setSession(null);
    setCachedUserId(null);
    setStatus("signed-out");
    setOffline(false);
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
