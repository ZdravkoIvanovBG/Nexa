import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { applyRemote, mirrorProfiles, purgeProfileFromCloud } from "./cloud/mirror";
import { readCachedSupabaseUserId } from "./supabase";
import type { HiddenTabs } from "./lockable-tabs";
import type { ContentFilters } from "./settings";
import {
  isAutoCreatedProfile,
  isDisposableDefaultProfile,
  isPlaceholderName,
} from "./profile-provenance";

export { isAutoCreatedProfile, isDisposableDefaultProfile, isPlaceholderName };

export const PROFILE_COLORS = [
  "#7dd3fc",
  "#60a5fa",
  "#a78bfa",
  "#f472b6",
  "#fb7185",
  "#fb923c",
  "#fbbf24",
  "#a3e635",
  "#34d399",
  "#22d3ee",
] as const;

export type ProfileColor = string;

export type KidConfig = {
  age: number;
  curfewMinutes: number | null;
  parentPinHash: string | null;
};

export const DEFAULT_KID: KidConfig = { age: 7, curfewMinutes: null, parentPinHash: null };

export type Profile = {
  id: string;
  name: string;
  avatar: string | null;
  color: ProfileColor;
  isPrimary: boolean;
  passwordHash: string | null;
  hideContent: ContentFilters | null;
  lockedTabs: HiddenTabs | null;
  kid: KidConfig | null;
  settingsLinked?: boolean;
  createdAt: number;
  /** Last edit, cloud-side conflicts resolve on this. */
  updatedAt: number;
  /**
   * True only for a profile this device invented on its own (initState's
   * bootstrap default, or ensureLocalProfile's non-adopting fallback) --
   * never for one made via the "Add Profile" button. Local-only: deliberately
   * NOT written to ProfileRow/profileToRow, so it never reaches the cloud
   * schema (see cloud/rows.ts). Cleared the moment the profile is genuinely
   * adopted as the account's own (ensureLocalProfile's adopting path) or the
   * user personalises it (updateProfileRecord). See isAutoCreatedProfile().
   */
  autoCreated?: boolean;
};

type ProfilesState = {
  profiles: Profile[];
  activeId: string | null;
};

export type PickerView =
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "edit"; profileId: string }
  | { kind: "unlock"; profileId: string };

type ProfilesValue = {
  profiles: Profile[];
  activeId: string | null;
  activeProfile: Profile | null;
  pickerOpen: boolean;
  pickerView: PickerView;
  openPicker: (view?: PickerView) => void;
  setPickerView: (view: PickerView) => void;
  closePicker: () => void;
  selectProfile: (id: string, opts?: { unlocked?: boolean }) => void;
  sessionUnlockedIds: Set<string>;
  createProfile: (input: {
    name: string;
    avatar?: string | null;
    color: ProfileColor;
    kid?: KidConfig | null;
  }) => Profile;
  updateProfile: (
    id: string,
    patch: Partial<Omit<Profile, "id" | "createdAt" | "isPrimary">>,
  ) => void;
  deleteProfile: (id: string) => void;
};

const STORAGE_KEY = "harbor.profiles.v1";
const TOGETHER_NAME_KEY = "harbor.together.name";
const SETTINGS_KEY = "harbor.settings";
const SHARED_SETTINGS_KEY = "harbor.settings.shared";
const LEGACY_PARENTAL_KEY = "harbor.parental";

function readLaunchSettingsRaw(): string | null {
  try {
    return localStorage.getItem(SHARED_SETTINGS_KEY) ?? localStorage.getItem(SETTINGS_KEY);
  } catch {
    return null;
  }
}

function readLegacyParental(): { hiddenTabs: HiddenTabs | null; hadPin: boolean } {
  try {
    const raw = localStorage.getItem(LEGACY_PARENTAL_KEY);
    if (!raw) return { hiddenTabs: null, hadPin: false };
    const parsed = JSON.parse(raw) as { hiddenTabs?: HiddenTabs; pinHash?: string | null };
    const hidden = parsed.hiddenTabs ?? null;
    const hadAny = !!hidden && Object.values(hidden).some(Boolean);
    return {
      hiddenTabs: hadAny ? hidden : null,
      hadPin: typeof parsed.pinHash === "string" && parsed.pinHash.length > 0,
    };
  } catch {
    return { hiddenTabs: null, hadPin: false };
  }
}

function generateGuestName(): string {
  return `Guest ${1000 + Math.floor(Math.random() * 9000)}`;
}

function defaultPrimaryName(): string {
  try {
    const existing = localStorage.getItem(TOGETHER_NAME_KEY)?.trim();
    if (existing && !isPlaceholderName(existing)) return existing;
  } catch {
    return generateGuestName();
  }
  return generateGuestName();
}

function readSettingsIdentity(): { color: string | null; avatar: string | null } {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { color: null, avatar: null };
    const parsed = JSON.parse(raw) as { harborColor?: unknown; harborAvatar?: unknown };
    const color =
      typeof parsed.harborColor === "string" && /^#[0-9a-f]{6}$/i.test(parsed.harborColor)
        ? parsed.harborColor
        : null;
    const avatar =
      typeof parsed.harborAvatar === "string" && parsed.harborAvatar.length > 0
        ? parsed.harborAvatar
        : null;
    return { color, avatar };
  } catch {
    return { color: null, avatar: null };
  }
}

type ProfilePromptInterval = "launch" | "15m" | "30m" | "never";
function readProfilePromptInterval(): ProfilePromptInterval {
  try {
    const raw = readLaunchSettingsRaw();
    if (!raw) return "launch";
    const parsed = JSON.parse(raw) as {
      profilePromptInterval?: unknown;
      skipProfileScreen?: unknown;
    };
    const v = parsed.profilePromptInterval;
    if (v === "launch" || v === "15m" || v === "30m" || v === "never") return v;
    return parsed.skipProfileScreen === true ? "never" : "launch";
  } catch {
    return "launch";
  }
}
function intervalMinutes(i: ProfilePromptInterval): number {
  return i === "15m" ? 15 : i === "30m" ? 30 : 0;
}
function readDefaultProfileId(): string {
  try {
    const raw = readLaunchSettingsRaw();
    if (!raw) return "";
    const v = (JSON.parse(raw) as { defaultProfileId?: unknown }).defaultProfileId;
    return typeof v === "string" ? v : "";
  } catch {
    return "";
  }
}
function launchDefault(profiles: Profile[]): Profile | null {
  const id = readDefaultProfileId();
  if (!id) return null;
  const p = profiles.find((x) => x.id === id);
  return p && !p.passwordHash ? p : null;
}
const LAST_SELECT_KEY = "harbor.profile.lastSelectAt";
function readLastProfileSelectAt(): number {
  try {
    return Number(localStorage.getItem(LAST_SELECT_KEY)) || 0;
  } catch {
    return 0;
  }
}
function markProfileSelectedNow(): void {
  try {
    localStorage.setItem(LAST_SELECT_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

const PICKER_SESSION_KEY = "harbor.pickerShown";
function launchPickerShownThisSession(): boolean {
  try {
    return sessionStorage.getItem(PICKER_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}
function markLaunchPickerShown(): void {
  try {
    sessionStorage.setItem(PICKER_SESSION_KEY, "1");
  } catch {
    /* ignore */
  }
}

function readStoredState(): ProfilesState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { profiles: [], activeId: null };
    const parsed = JSON.parse(raw) as ProfilesState;
    if (!parsed || !Array.isArray(parsed.profiles)) {
      return { profiles: [], activeId: null };
    }
    const fallbackName = defaultPrimaryName();
    const identity = readSettingsIdentity();
    const legacyParental = readLegacyParental();
    const migrated = parsed.profiles.map((p) => {
      const next = { ...p };
      if (typeof p.passwordHash === "undefined") {
        next.passwordHash = null;
      }
      if (typeof p.hideContent === "undefined") {
        next.hideContent = null;
      }
      if (typeof p.lockedTabs === "undefined") {
        next.lockedTabs = p.isPrimary ? legacyParental.hiddenTabs : null;
      }
      if (typeof p.kid === "undefined" || p.kid == null) {
        next.kid = null;
      } else {
        next.kid = {
          age: p.kid.age ?? 7,
          curfewMinutes: p.kid.curfewMinutes ?? null,
          parentPinHash: p.kid.parentPinHash ?? null,
        };
      }
      if (typeof p.updatedAt !== "number") {
        next.updatedAt = p.createdAt ?? Date.now();
      }
      if (p.isPrimary) {
        if (isPlaceholderName(p.name)) next.name = fallbackName;
        if (identity.color) next.color = identity.color;
        if (identity.avatar != null && !identity.avatar.startsWith("/kids/avatars/")) {
          next.avatar = identity.avatar;
        }
      }
      if (
        next.kid == null &&
        typeof next.avatar === "string" &&
        next.avatar.startsWith("/kids/avatars/")
      ) {
        next.avatar = null;
      }
      return next;
    });
    return { profiles: migrated, activeId: parsed.activeId };
  } catch {
    return { profiles: [], activeId: null };
  }
}

function persistState(next: ProfilesState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

function pickColor(existing: Profile[]): ProfileColor {
  const used = new Set(existing.map((p) => p.color));
  const free = PROFILE_COLORS.find((c) => !used.has(c));
  return free ?? PROFILE_COLORS[existing.length % PROFILE_COLORS.length];
}

function newId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function makeDefaultPrimary(): Profile {
  const identity = readSettingsIdentity();
  const legacyParental = readLegacyParental();
  const now = Date.now();
  return {
    id: newId(),
    name: defaultPrimaryName(),
    avatar: identity.avatar,
    color: identity.color ?? PROFILE_COLORS[0],
    isPrimary: true,
    passwordHash: null,
    hideContent: null,
    lockedTabs: legacyParental.hiddenTabs,
    kid: null,
    createdAt: now,
    updatedAt: now,
    // Cleared by updateProfileRecord the first time the user touches this
    // profile. Until then it marks "the app invented this, not the user" --
    // see isAutoCreatedProfile() and its use in hydrateProfilesFromCloud.
    autoCreated: true,
  };
}

/**
 * True while an empty local roster is waiting on the cloud to deliver the real
 * one, so nothing invents a placeholder profile in the meantime.
 *
 * This module initialises synchronously at import, long before any network
 * call: creating the default here unconditionally is what reset a returning
 * user to a fresh "Guest" every time they signed back in.
 */
let awaitingCloudRoster = false;

export function profilesAwaitingCloudRoster(): boolean {
  return awaitingCloudRoster;
}

function initState(): ProfilesState {
  const loaded = readStoredState();
  if (loaded.profiles.length > 0) {
    const def = launchDefault(loaded.profiles);
    return def ? { ...loaded, activeId: def.id } : loaded;
  }
  // Nothing stored. If a session is already cached on this device, the roster
  // for that account is about to arrive -- hold the empty list until it does.
  if (readCachedSupabaseUserId()) {
    awaitingCloudRoster = true;
    return { profiles: [], activeId: null };
  }
  const primary = makeDefaultPrimary();
  const initial: ProfilesState = { profiles: [primary], activeId: primary.id };
  persistState(initial);
  return initial;
}

// ── module-level store ───────────────────────────────────────────────────────
//
// Profiles used to live entirely inside ProfilesProvider's own useState. That
// worked until profiles needed to sync: hydrateProfilesFromCloud() runs from a
// plain module (sync-mount.tsx), outside React, and has no way to reach into a
// component's state. Moving the source of truth here -- the same pattern
// addon-store.ts and watchlist.ts already use -- lets the hydrator write
// straight into it, with the Provider just subscribing for re-renders.

let state: ProfilesState = initState();
const subs = new Set<() => void>();

function notify(): void {
  for (const fn of subs) fn();
}

function commit(next: ProfilesState): void {
  state = next;
  persistState(next);
  notify();
  mirrorProfiles(next.profiles);
}

export function getProfilesState(): ProfilesState {
  return state;
}

export function loadProfiles(): Profile[] {
  return state.profiles;
}

export function subscribeProfiles(fn: () => void): () => void {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

/**
 * Overwrite the whole roster from a cloud pull. Wrapped in applyRemote so the
 * mirror treats it as inbound and does not push it straight back.
 */
export function replaceProfiles(profiles: Profile[]): void {
  awaitingCloudRoster = false;
  applyRemote(() => {
    const activeStillExists = profiles.some((p) => p.id === state.activeId);
    const fallback = profiles.find((p) => p.isPrimary) ?? profiles[0] ?? null;
    const activeId = activeStillExists ? state.activeId : (fallback?.id ?? null);
    commit({ profiles, activeId });
  });
}

/**
 * Seed a default profile if the roster is still empty once the cloud has had
 * its turn. Idempotent, and always settles awaitingCloudRoster so the UI
 * stops waiting.
 *
 * `adopt` decides whether this profile is genuinely the account's own, or
 * just a local stand-in:
 *
 * - `adopt: true` -- ONLY from hydrateProfilesFromCloud, after a pull that
 *   *succeeded* and came back with zero rows. That is proof the account has
 *   no roster yet, so this really is its first profile: it mirrors, same as
 *   any other local edit.
 * - `adopt: false` (default) -- the pull failed, is offline, signed out, or
 *   cloud sync is unconfigured. The roster may simply not have arrived yet,
 *   so this exists only to keep the app usable: it is suppressed from the
 *   mirror (applyRemote, same mechanism replaceProfiles uses for an inbound
 *   cloud roster) so it is never uploaded on its own. If the real roster
 *   turns out to be non-empty on a later successful pull, this placeholder
 *   is dropped rather than merged in -- see isAutoCreatedProfile().
 */
export function ensureLocalProfile(opts: { adopt: boolean } = { adopt: false }): void {
  const wasAwaiting = awaitingCloudRoster;
  awaitingCloudRoster = false;
  if (state.profiles.length > 0) {
    if (wasAwaiting) notify();
    return;
  }
  const primary = makeDefaultPrimary();
  if (opts.adopt) {
    commit({ profiles: [primary], activeId: primary.id });
    return;
  }
  applyRemote(() => commit({ profiles: [primary], activeId: primary.id }));
}

function selectProfileRecord(id: string): void {
  markProfileSelectedNow();
  if (id === state.activeId) return;
  commit({ ...state, activeId: id });
}

function createProfileRecord(input: {
  name: string;
  avatar?: string | null;
  color: ProfileColor;
  kid?: KidConfig | null;
}): Profile {
  const now = Date.now();
  const created: Profile = {
    id: newId(),
    name: input.name.trim().slice(0, 32) || "Profile",
    avatar: input.avatar ?? null,
    color: input.color,
    isPrimary: false,
    passwordHash: null,
    hideContent: null,
    lockedTabs: null,
    kid: input.kid ?? null,
    settingsLinked: true,
    createdAt: now,
    updatedAt: now,
  };
  commit({ ...state, profiles: [...state.profiles, created] });
  return created;
}

function updateProfileRecord(
  id: string,
  patch: Partial<Omit<Profile, "id" | "createdAt" | "isPrimary">>,
): void {
  const profiles = state.profiles.map((p) =>
    p.id === id
      ? {
          ...p,
          ...patch,
          name: patch.name != null ? patch.name.trim().slice(0, 32) || p.name : p.name,
          updatedAt: Date.now(),
          // Only ever reached via a user-driven edit (this is the sole
          // caller of updateProfileRecord), so the profile is no longer
          // "app-invented" from here on -- see isAutoCreatedProfile().
          autoCreated: undefined,
        }
      : p,
  );
  commit({ ...state, profiles });
}

function deleteProfileRecord(id: string): void {
  const target = state.profiles.find((p) => p.id === id);
  if (!target) return;
  // The primary profile owns roster management -- creating and editing the
  // others -- so deleting it would strand the household with no way back. The
  // length guard is belt and braces: a roster of zero has nothing to fall back
  // to, and initState would invent a placeholder on the next launch.
  if (target.isPrimary || state.profiles.length <= 1) return;
  try {
    localStorage.removeItem(`harbor.auth.${id}`);
    localStorage.removeItem(`harbor.favorites.v1.${id}`);
    localStorage.removeItem(`harbor.localwatchlist.v1.${id}`);
    localStorage.removeItem(`harbor.settings.${id}`);
    localStorage.removeItem(`harbor.trakt.session.v1.${id}`);
    localStorage.removeItem(`harbor.simkl.session.v1.${id}`);
    localStorage.removeItem(`harbor.anilist.session.v1.${id}`);
    localStorage.removeItem(`harbor.mal.session.v1.${id}`);
    localStorage.removeItem(`harbor.simkl.cache.v2.${id}`);
    localStorage.removeItem(`harbor.anilist.synced.v1.${id}`);
    localStorage.removeItem(`harbor.mal.synced.v1.${id}`);
  } catch {
    /* ignore */
  }
  // Everything this profile owned in the cloud goes with it. Best-effort: the
  // row itself is removed through the durable queue by the mirror below.
  void purgeProfileFromCloud(id);

  const profiles = state.profiles.filter((p) => p.id !== id);
  // Deleting the profile in use hands control back to the primary rather than
  // to whichever profile happens to sort first.
  const fallback = profiles.find((p) => p.isPrimary) ?? profiles[0] ?? null;
  const activeId = state.activeId === id ? (fallback?.id ?? null) : state.activeId;
  // An automatic switch still counts as picking a profile, or the launch
  // interval would re-prompt "who's watching?" immediately afterwards.
  if (activeId !== state.activeId) markProfileSelectedNow();
  commit({ profiles, activeId });
}

// ── React binding ────────────────────────────────────────────────────────────

/**
 * The launch "who's watching?" rule. Deferred while the roster is inbound --
 * asking who is watching before the profiles exist would show an empty picker
 * and answer the question with the wrong list.
 */
function shouldOpenPickerAtLaunch(s: ProfilesState): boolean {
  if (s.activeId == null) return s.profiles.length > 0;
  if (s.profiles.length <= 1) return false;
  if (launchDefault(s.profiles)) return false;
  const interval = readProfilePromptInterval();
  if (interval === "never") return false;
  if (interval === "launch") {
    const shownThisSession = launchPickerShownThisSession();
    markLaunchPickerShown();
    return !shownThisSession;
  }
  return Date.now() - readLastProfileSelectAt() >= intervalMinutes(interval) * 60000;
}

const Ctx = createContext<ProfilesValue | null>(null);

export function ProfilesProvider({ children }: { children: ReactNode }) {
  const externalState = useSyncExternalStore(subscribeProfiles, getProfilesState, getProfilesState);
  const awaitingRoster = useSyncExternalStore(
    subscribeProfiles,
    profilesAwaitingCloudRoster,
    profilesAwaitingCloudRoster,
  );

  const [pickerOpen, setPickerOpen] = useState<boolean>(() =>
    awaitingRoster ? false : shouldOpenPickerAtLaunch(externalState),
  );
  const [pickerView, setPickerViewState] = useState<PickerView>({ kind: "list" });
  const [sessionUnlockedIds, setSessionUnlockedIds] = useState<Set<string>>(() => new Set());
  // The launch picker decision is deferred while the roster is inbound; make
  // it once, when the cloud delivers.
  const pickerDecided = useRef(!awaitingRoster);

  const activeProfile = useMemo(
    () => externalState.profiles.find((p) => p.id === externalState.activeId) ?? null,
    [externalState.profiles, externalState.activeId],
  );

  useEffect(() => {
    if (awaitingRoster || pickerDecided.current) return;
    pickerDecided.current = true;
    if (shouldOpenPickerAtLaunch(getProfilesState())) {
      setPickerViewState({ kind: "list" });
      setPickerOpen(true);
    }
  }, [awaitingRoster]);

  useEffect(() => {
    const onFocus = () => {
      const mins = intervalMinutes(readProfilePromptInterval());
      if (mins <= 0 || externalState.activeId == null || externalState.profiles.length <= 1) return;
      if (Date.now() - readLastProfileSelectAt() >= mins * 60000) {
        setPickerViewState({ kind: "list" });
        setPickerOpen(true);
      }
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [externalState.activeId, externalState.profiles.length]);

  const selectProfile = useCallback((id: string, opts?: { unlocked?: boolean }) => {
    if (opts?.unlocked) {
      setSessionUnlockedIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    }
    selectProfileRecord(id);
    setPickerOpen(false);
    setPickerViewState({ kind: "list" });
  }, []);

  const openPicker = useCallback((view: PickerView = { kind: "list" }) => {
    setPickerViewState(view);
    setPickerOpen(true);
  }, []);
  const setPickerView = useCallback((view: PickerView) => setPickerViewState(view), []);
  const closePicker = useCallback(() => {
    setPickerOpen(false);
    setPickerViewState({ kind: "list" });
  }, []);

  const createProfile = useCallback<ProfilesValue["createProfile"]>(
    (input) => createProfileRecord(input),
    [],
  );
  const updateProfile = useCallback<ProfilesValue["updateProfile"]>(
    (id, patch) => updateProfileRecord(id, patch),
    [],
  );
  const deleteProfile = useCallback<ProfilesValue["deleteProfile"]>(
    (id) => deleteProfileRecord(id),
    [],
  );

  const value = useMemo<ProfilesValue>(
    () => ({
      profiles: externalState.profiles,
      activeId: externalState.activeId,
      activeProfile,
      pickerOpen,
      pickerView,
      openPicker,
      setPickerView,
      closePicker,
      selectProfile,
      sessionUnlockedIds,
      createProfile,
      updateProfile,
      deleteProfile,
    }),
    [
      externalState.profiles,
      externalState.activeId,
      activeProfile,
      pickerOpen,
      pickerView,
      sessionUnlockedIds,
      openPicker,
      setPickerView,
      closePicker,
      selectProfile,
      createProfile,
      updateProfile,
      deleteProfile,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProfiles(): ProfilesValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useProfiles outside ProfilesProvider");
  return v;
}

export function useActiveKid(): KidConfig | null {
  const { activeProfile } = useProfiles();
  return activeProfile?.kid ?? null;
}

export function nextProfileColor(existing: Profile[]): ProfileColor {
  return pickColor(existing);
}

export function profileInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
