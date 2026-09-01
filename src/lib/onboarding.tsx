import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

type Flags = { onboarded: boolean; nudges: Record<string, boolean> };

type OnboardingValue = {
  onboarded: boolean;
  finishOnboarding: () => void;
  resetOnboarding: () => void;
  resetNudges: () => void;
  isDismissed: (key: string) => boolean;
  dismiss: (key: string) => void;
};

const STORAGE_KEY = "harbor.onboarding";
const DEFAULT: Flags = { onboarded: false, nudges: {} };

function readStored(): Flags {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT;
    const parsed = JSON.parse(raw) as Partial<Flags>;
    return { ...DEFAULT, ...parsed, nudges: { ...DEFAULT.nudges, ...(parsed.nudges ?? {}) } };
  } catch {
    return DEFAULT;
  }
}

function persist(next: Flags): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

// ── module-level store ───────────────────────────────────────────────────────
//
// Modelled on profiles.tsx. The flags used to live in the provider's own
// useState, which put them out of reach of the cloud hydrators: those run in
// plain modules, and they are the ones that know an account has been set up
// before. Keeping the source of truth here lets them mark it.

let flags: Flags = readStored();

/**
 * Whether the cloud has answered "has this account been set up before?".
 *
 * The app is gated behind sign-in, so the wizard would render the instant the
 * gate lifts -- a frame or more before the profile pull that reveals this
 * account is years old. The wizard holds until this flips, which is what stops
 * a returning user seeing a flash of "welcome to Harbor" on every sign-in.
 */
let cloudAnswered = false;

const subs = new Set<() => void>();

function notify(): void {
  for (const fn of subs) fn();
}

function commit(next: Flags): void {
  flags = next;
  persist(next);
  notify();
}

export function getOnboardingFlags(): Flags {
  return flags;
}

export function subscribeOnboarding(fn: () => void): () => void {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

/**
 * Re-read the key after something outside React rewrote it -- the settings
 * hydrator restores `harbor.onboarding` from the cloud alongside the blob, so
 * dismissed nudges follow the account too.
 */
export function reloadOnboardingFromStorage(): void {
  const next = readStored();
  if (JSON.stringify(next) === JSON.stringify(flags)) return;
  flags = next;
  notify();
}

/**
 * Mark the wizard as already seen, with no UI pass.
 *
 * The flag itself now survives a sign-out (see isPortable in backup.ts), which
 * covers signing back in on the same device. This covers the other half: a
 * device that has never seen this account, whose cloud copy already holds a
 * profile roster or a settings blob and so has plainly been set up before.
 * It also repairs accounts whose rows predate the side-store bundle, where
 * there is no stored flag to restore.
 */
export function markOnboarded(): void {
  cloudAnswered = true;
  if (flags.onboarded) {
    notify();
    return;
  }
  commit({ ...flags, onboarded: true });
}

/** True while the wizard must hold: signed in, and the roster has not landed. */
export function onboardingAwaitingCloud(): boolean {
  return !cloudAnswered && !flags.onboarded;
}

/**
 * The cloud has had its turn -- an empty roster, a failed pull, an offline
 * start or no account at all. Whatever the wizard's local flag says now is
 * the real answer, so let it render. Called from ensureLocalProfile(), which
 * every one of those paths already goes through.
 */
export function settleOnboarding(): void {
  if (cloudAnswered) return;
  cloudAnswered = true;
  notify();
}

// ── React binding ────────────────────────────────────────────────────────────

const Ctx = createContext<OnboardingValue | null>(null);

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(subscribeOnboarding, getOnboardingFlags, getOnboardingFlags);

  // These read the module's current flags rather than the render's, so a
  // dismissal never races a hydrate that landed between renders.
  const finishOnboarding = useCallback(() => commit({ ...flags, onboarded: true }), []);
  const resetOnboarding = useCallback(() => commit({ onboarded: false, nudges: {} }), []);
  const resetNudges = useCallback(() => commit({ ...flags, nudges: {} }), []);
  const isDismissed = useCallback((key: string) => !!state.nudges[key], [state.nudges]);
  const dismiss = useCallback(
    (key: string) => commit({ ...flags, nudges: { ...flags.nudges, [key]: true } }),
    [],
  );

  const value = useMemo(
    () => ({
      onboarded: state.onboarded,
      finishOnboarding,
      resetOnboarding,
      resetNudges,
      isDismissed,
      dismiss,
    }),
    [state.onboarded, finishOnboarding, resetOnboarding, resetNudges, isDismissed, dismiss],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOnboarding() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useOnboarding outside OnboardingProvider");
  return v;
}
