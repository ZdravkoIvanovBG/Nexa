/**
 * Pure profile-provenance checks, split out of profiles.tsx so they can be
 * unit tested directly: profiles.tsx pulls in the cloud-mirror/Supabase
 * dependency chain, which `node --test` cannot resolve (no `@/` alias
 * support) -- the same reason tracking-tiers.ts exists as its own leaf
 * module. See isAutoCreatedProfile()'s use in cloud/hydrate.ts, which is the
 * actual defense against a device-invented profile being adopted into an
 * account that already has a real roster.
 */

const PLACEHOLDER_NAMES = new Set(["Me", "You", "Profile"]);

export function isPlaceholderName(name: string | null | undefined): boolean {
  if (!name) return true;
  const trimmed = name.trim();
  if (!trimmed) return true;
  if (PLACEHOLDER_NAMES.has(trimmed)) return true;
  return /^Guest \d+$/.test(trimmed);
}

/** The subset of Profile these checks need, so this stays independent of profiles.tsx. */
export type ProfileProvenanceLike = {
  isPrimary: boolean;
  name: string;
  avatar: string | null;
  passwordHash: string | null;
  kid: unknown;
  lockedTabs: unknown;
  autoCreated?: boolean;
};

/**
 * A default profile this device invented while it had no roster: auto-named,
 * never personalised. It is a placeholder, not the user's data, so a cloud
 * roster replaces it instead of merging (and uploading) it alongside.
 *
 * This is the legacy heuristic, kept as a fallback for a profile stored
 * before the `autoCreated` flag existed -- prefer isAutoCreatedProfile()
 * below, which checks provenance directly instead of guessing from name and
 * avatar (a device-invented default that already picked up a Together
 * display name or a settings avatar before sign-in defeats this heuristic).
 */
export function isDisposableDefaultProfile(p: ProfileProvenanceLike): boolean {
  return (
    p.isPrimary &&
    isPlaceholderName(p.name) &&
    !p.avatar &&
    !p.passwordHash &&
    !p.kid &&
    !p.lockedTabs
  );
}

/**
 * True for a profile the app invented rather than one the user created --
 * either flagged directly (`autoCreated`, set by makeDefaultPrimary and
 * cleared by updateProfileRecord the moment the user touches it), or, for a
 * profile stored before that flag existed, matching the legacy placeholder
 * heuristic above.
 */
export function isAutoCreatedProfile(p: ProfileProvenanceLike): boolean {
  return p.autoCreated === true || isDisposableDefaultProfile(p);
}
