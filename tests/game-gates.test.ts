// @ts-nocheck -- Node's test modules are not included in the application tsconfig.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  canToggleGames,
  gamesFeatureEnabled,
  gamesSearchAvailable,
  keyFingerprint,
  rawgConfigState,
  rawgReady,
} from "../src/lib/game-discovery/gates.ts";

const never = () => false;
const KEY = "abc123def456";
const FP = keyFingerprint(KEY);

test("defaults keep Games off with no key", () => {
  // defaults.ts imports through the "@/" alias, so assert on its source.
  const source = readFileSync(new URL("../src/lib/settings/defaults.ts", import.meta.url), "utf8");
  assert.match(source, /^\s*gamesEnabled: false,$/m);
  assert.match(source, /^\s*rawgApiKey: "",$/m);
  assert.match(source, /^\s*rawgKeyVerifiedFor: "",$/m);
  const DEFAULT = { gamesEnabled: false, rawgApiKey: "", rawgKeyVerifiedFor: "" };
  assert.equal(gamesFeatureEnabled(DEFAULT), false);
  assert.equal(rawgConfigState(DEFAULT, never), "missing_key");
  assert.equal(canToggleGames(DEFAULT, never), false);
});

test("fingerprints are stable, trim-insensitive and key-specific", () => {
  assert.equal(keyFingerprint(KEY), FP);
  assert.equal(keyFingerprint(`  ${KEY}\n`), FP);
  assert.notEqual(keyFingerprint("abc123def457"), FP);
  assert.equal(keyFingerprint(""), "");
  assert.equal(keyFingerprint("   "), "");
  assert.ok(!FP.includes(KEY));
});

test("verification is bound to the exact key", () => {
  const verified = { rawgApiKey: KEY, rawgKeyVerifiedFor: FP };
  assert.equal(rawgConfigState(verified, never), "ready");
  // Edited locally, or a different key synced from another device/profile scope.
  assert.equal(
    rawgConfigState({ rawgApiKey: "another-key", rawgKeyVerifiedFor: FP }, never),
    "unverified",
  );
  assert.equal(rawgConfigState({ rawgApiKey: KEY, rawgKeyVerifiedFor: "" }, never), "unverified");
  assert.equal(rawgConfigState({ rawgApiKey: "", rawgKeyVerifiedFor: FP }, never), "missing_key");
});

test("a session rejection blocks requests for that key only", () => {
  const verified = { rawgApiKey: KEY, rawgKeyVerifiedFor: FP };
  const rejectedFp = (fp: string) => fp === FP;
  assert.equal(rawgConfigState(verified, rejectedFp), "rejected");
  assert.equal(rawgReady(verified, rejectedFp), false);
  const other = { rawgApiKey: "fresh-key", rawgKeyVerifiedFor: keyFingerprint("fresh-key") };
  assert.equal(rawgReady(other, rejectedFp), true);
  // After the rejection clears the stored verification, the reason stays visible.
  assert.equal(
    rawgConfigState({ rawgApiKey: KEY, rawgKeyVerifiedFor: "" }, rejectedFp),
    "rejected",
  );
});

test("visibility is independent of RAWG readiness once enabled", () => {
  for (const keyState of [
    { rawgApiKey: "", rawgKeyVerifiedFor: "" },
    { rawgApiKey: KEY, rawgKeyVerifiedFor: "" },
    { rawgApiKey: KEY, rawgKeyVerifiedFor: FP },
  ]) {
    const on = { gamesEnabled: true, ...keyState };
    assert.equal(gamesFeatureEnabled(on), true);
    assert.equal(
      canToggleGames(on, () => true),
      true,
      "turning off is always allowed",
    );
  }
});

test("enabling requires a ready key", () => {
  assert.equal(
    canToggleGames({ gamesEnabled: false, rawgApiKey: KEY, rawgKeyVerifiedFor: FP }, never),
    true,
  );
  assert.equal(
    canToggleGames({ gamesEnabled: false, rawgApiKey: KEY, rawgKeyVerifiedFor: "" }, never),
    false,
  );
  assert.equal(
    canToggleGames(
      { gamesEnabled: false, rawgApiKey: KEY, rawgKeyVerifiedFor: FP },
      (fp) => fp === FP,
    ),
    false,
  );
});

test("the global search shortcut needs usable Games and a non-kid profile", () => {
  const usable = { featureEnabled: true, ready: true };
  assert.equal(gamesSearchAvailable(usable, false), true);
  assert.equal(gamesSearchAvailable(usable, true), false, "kid profiles can't open Games");
  assert.equal(gamesSearchAvailable({ featureEnabled: false, ready: true }, false), false);
  assert.equal(gamesSearchAvailable({ featureEnabled: true, ready: false }, false), false);
  assert.equal(gamesSearchAvailable({ featureEnabled: false, ready: false }, true), false);
});

test("global search takes the kid check from the active profile", () => {
  const overlay = readFileSync(
    new URL("../src/components/search/search-overlay.tsx", import.meta.url),
    "utf8",
  );
  assert.match(overlay, /const kid = useActiveKid\(\);/);
  // The active provider's gate (RAWG, or IGDB in development builds).
  assert.match(overlay, /const gamesGate = useGamesGate\(\);/);
  assert.match(overlay, /gamesSearchAvailable\(gamesGate, !!kid\)/);
  assert.doesNotMatch(overlay, /gamesGate\.featureEnabled/);
});
