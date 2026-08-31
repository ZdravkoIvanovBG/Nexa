// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import { toLocalDayISO } from "../src/lib/local-date.ts";

test("passes a bare calendar date through unchanged", () => {
  assert.equal(toLocalDayISO("2024-01-06"), "2024-01-06");
});

test("converts a UTC timestamp to the viewer's local calendar day", () => {
  // 22:30 UTC lands on Jan 7th for any timezone at UTC+2 or later (e.g.
  // Europe/Sofia), which is exactly the case that was spilling into the
  // next day's bucket while still being counted for the UTC day too.
  const utcLateNight = new Date("2024-01-06T22:30:00.000Z");
  const y = utcLateNight.getFullYear();
  const m = String(utcLateNight.getMonth() + 1).padStart(2, "0");
  const d = String(utcLateNight.getDate()).padStart(2, "0");
  assert.equal(toLocalDayISO("2024-01-06T22:30:00.000Z"), `${y}-${m}-${d}`);
});

test("returns empty string for missing input", () => {
  assert.equal(toLocalDayISO(null), "");
  assert.equal(toLocalDayISO(undefined), "");
  assert.equal(toLocalDayISO(""), "");
});

test("falls back to a raw slice for unparsable input instead of throwing", () => {
  assert.equal(toLocalDayISO("not-a-date"), "not-a-date");
});
