// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import { diffAddons, diffByKey } from "../src/lib/cloud/diff.ts";

type Addon = Parameters<typeof diffAddons>[0][number];

function addon(over: Partial<Addon> & { transportUrl: string }): Addon {
  return {
    id: "org.example",
    installedAt: 1000,
    manifest: { id: "org.example", name: "Example", version: "1.0.0", catalogs: [] },
    ...over,
  } as Addon;
}

test("diffByKey keys on something other than id", () => {
  const prev = [{ url: "a", v: 1 }];
  const next = [
    { url: "a", v: 2 },
    { url: "b", v: 1 },
  ];
  const d = diffByKey(
    prev,
    next,
    (e) => e.url,
    (a, b) => a.v === b.v,
  );
  assert.deepEqual(
    d.upserts.map((e) => e.url),
    ["a", "b"],
  );
  assert.deepEqual(d.deletes, []);
});

test("a removed addon becomes a delete keyed by transport URL", () => {
  const a = addon({ transportUrl: "https://one/manifest.json" });
  const b = addon({ transportUrl: "https://two/manifest.json" });
  const d = diffAddons([a, b], [a]);
  assert.deepEqual(d.deletes, ["https://two/manifest.json"]);
  assert.equal(d.upserts.length, 0);
});

test("enable and reorder each produce an upsert", () => {
  const base = addon({ transportUrl: "https://one/manifest.json", enabled: true, order: 0 });
  assert.equal(diffAddons([base], [{ ...base, enabled: false }]).upserts.length, 1);
  assert.equal(diffAddons([base], [{ ...base, order: 3 }]).upserts.length, 1);
});

test("absent enabled is treated as enabled, so it is not a spurious upsert", () => {
  const withFlag = addon({ transportUrl: "https://one/manifest.json", enabled: true, order: 0 });
  const without = addon({ transportUrl: "https://one/manifest.json", order: 0 });
  assert.equal(diffAddons([without], [withFlag]).upserts.length, 0);
});

test("a manifest backfill does not cause an upsert storm", () => {
  // fetchInstalledAddons re-saves once per addon from three screens; only a real
  // manifest change (version/name/catalog count) may enqueue a write.
  const before = addon({ transportUrl: "https://one/manifest.json", order: 0 });
  const refetched = { ...before, manifestFetchedAt: Date.now() };
  assert.equal(diffAddons([before], [refetched]).upserts.length, 0);

  const upgraded = {
    ...before,
    manifest: { ...before.manifest, version: "2.0.0" },
  } as Addon;
  assert.equal(diffAddons([before], [upgraded]).upserts.length, 1);
});
