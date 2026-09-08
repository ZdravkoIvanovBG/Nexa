// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import { capFromNumbers } from "../src/lib/stepper-cap.ts";

test("caps at the highest number present, not the count of entries", () => {
  // A 10-episode season with a special numbered out of sequence, or a gap --
  // eps.length would be 9 or 11, but the real cap is the finale's number.
  assert.equal(capFromNumbers([1, 2, 3, 5, 6, 7, 8, 9, 10]), 10);
});

test("an empty list means unknown -- do not cap", () => {
  // Math.max() on an empty spread is -Infinity, which would lock the
  // stepper at 1 forever. Must be null instead.
  assert.equal(capFromNumbers([]), null);
});

test("ignores non-finite or non-positive garbage", () => {
  assert.equal(capFromNumbers([0, -1, NaN, Infinity, 4]), 4);
  assert.equal(capFromNumbers([0, -1, NaN, Infinity]), null);
});

test("order does not matter", () => {
  assert.equal(capFromNumbers([10, 3, 7, 1]), 10);
});
