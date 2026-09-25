// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import {
  isAutoCreatedProfile,
  isDisposableDefaultProfile,
  isPlaceholderName,
  type ProfileProvenanceLike,
} from "../src/lib/profile-provenance.ts";

function profile(over: Partial<ProfileProvenanceLike> = {}): ProfileProvenanceLike {
  return {
    isPrimary: true,
    name: "Guest 4821",
    avatar: null,
    passwordHash: null,
    kid: null,
    lockedTabs: null,
    ...over,
  };
}

test("isPlaceholderName matches the generated guest pattern and the legacy names", () => {
  assert.equal(isPlaceholderName("Guest 4821"), true);
  assert.equal(isPlaceholderName("Me"), true);
  assert.equal(isPlaceholderName("You"), true);
  assert.equal(isPlaceholderName("Profile"), true);
  assert.equal(isPlaceholderName(null), true);
  assert.equal(isPlaceholderName("  "), true);
  assert.equal(isPlaceholderName("Zdravko"), false);
  assert.equal(isPlaceholderName("Guest"), false);
});

test("isDisposableDefaultProfile: untouched invented default matches", () => {
  assert.equal(isDisposableDefaultProfile(profile()), true);
});

test("isDisposableDefaultProfile: a custom avatar or name defeats the heuristic", () => {
  assert.equal(
    isDisposableDefaultProfile(profile({ avatar: "data:image/webp;base64,AAAA" })),
    false,
  );
  assert.equal(isDisposableDefaultProfile(profile({ name: "Zdravko" })), false);
});

test("isAutoCreatedProfile: the autoCreated flag alone is enough, even when personalised", () => {
  // The bug this guards against: makeDefaultPrimary() can pick up a Together
  // display name and a settings avatar before the user ever signs in, which
  // defeats isDisposableDefaultProfile's name/avatar heuristic entirely.
  // Provenance (the flag) must still catch it.
  const personalised = profile({
    autoCreated: true,
    name: "Zdravko",
    avatar: "data:image/webp;base64,AAAA",
  });
  assert.equal(isDisposableDefaultProfile(personalised), false);
  assert.equal(isAutoCreatedProfile(personalised), true);
});

test("isAutoCreatedProfile: a user-created profile (no flag, personalised) is never caught", () => {
  const userMade = profile({ name: "Zdravko", avatar: "data:image/webp;base64,AAAA" });
  assert.equal(isAutoCreatedProfile(userMade), false);
});

test("isAutoCreatedProfile: falls back to the legacy heuristic for a profile with no flag at all", () => {
  // A profile stored before the autoCreated flag existed carries no
  // `autoCreated` key (undefined), not `false`.
  const legacy = profile();
  delete (legacy as { autoCreated?: boolean }).autoCreated;
  assert.equal(isAutoCreatedProfile(legacy), true);
});
