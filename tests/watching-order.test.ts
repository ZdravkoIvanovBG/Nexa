// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import { sortWatchingEntries } from "../src/lib/watching-order.ts";

function entry(id: string, addedAt: number) {
  return { id, addedAt };
}

test("orders by insertion (addedAt), not recency", () => {
  const entries = [entry("c", 300), entry("a", 100), entry("b", 200)];
  const sorted = sortWatchingEntries(entries);
  assert.deepEqual(
    sorted.map((e) => e.id),
    ["a", "b", "c"],
  );
});

test("a season/episode edit does not change order (updatedAt is not the sort key)", () => {
  const entries = [entry("a", 100), entry("b", 200)];
  // Simulate what setProgress() does: bump a timestamp field that isn't
  // addedAt. sortWatchingEntries must ignore it entirely.
  const edited = entries.map((e) => (e.id === "b" ? { ...e, updatedAt: 999_999 } : e));
  const sorted = sortWatchingEntries(edited);
  assert.deepEqual(
    sorted.map((e) => e.id),
    ["a", "b"],
  );
});

test("legacy rows sharing addedAt (defaulted to 0) get a stable, deterministic order", () => {
  const entries = [entry("z", 0), entry("a", 0), entry("m", 0)];
  const first = sortWatchingEntries(entries).map((e) => e.id);
  const second = sortWatchingEntries(entries).map((e) => e.id);
  assert.deepEqual(first, second);
  assert.deepEqual(first, ["a", "m", "z"]);
});

test("does not mutate the input array", () => {
  const entries = [entry("b", 200), entry("a", 100)];
  const original = [...entries];
  sortWatchingEntries(entries);
  assert.deepEqual(entries, original);
});
