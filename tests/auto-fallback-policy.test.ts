// @ts-nocheck -- Node's test modules are not included in the application tsconfig.
import assert from "node:assert/strict";
import test from "node:test";
import { AutoFallbackGuard } from "../src/views/player/hooks/auto-fallback-policy.ts";

test("starts unhalted and able to rescue", () => {
  const guard = new AutoFallbackGuard();
  assert.equal(guard.isHalted, false);
  assert.equal(guard.canRescue(), true);
});

test("halt() returns true the first time and latches", () => {
  const guard = new AutoFallbackGuard();
  assert.equal(guard.halt(), true);
  assert.equal(guard.isHalted, true);
  assert.equal(guard.canRescue(), false);
});

test("halt() returns false on every call after the first (idempotent)", () => {
  const guard = new AutoFallbackGuard();
  assert.equal(guard.halt(), true);
  assert.equal(guard.halt(), false);
  assert.equal(guard.halt(), false);
  assert.equal(guard.isHalted, true);
});
