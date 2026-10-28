// @ts-nocheck -- Node's test modules are not included in the application tsconfig.
import assert from "node:assert/strict";
import test from "node:test";
import {
  FRANCHISE_ART_KEY,
  FRANCHISE_ART_TTL_MS,
  readFranchiseArt,
  writeFranchiseArt,
} from "../src/lib/game-discovery/franchise-art-cache.ts";

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    raw: () => map.get(FRANCHISE_ART_KEY),
  };
}

const ART = { rawgId: 1, slug: "a", image: "https://media.rawg.io/media/games/a.jpg" };

test("round-trips an entry within the TTL", () => {
  const storage = memoryStorage();
  writeFranchiseArt("far-cry", ART, 1_000, storage);
  assert.deepEqual(readFranchiseArt("far-cry", 2_000, storage), { ...ART, at: 1_000 });
  assert.equal(readFranchiseArt("other", 2_000, storage), null);
});

test("expires entries after seven days and ignores future timestamps", () => {
  const storage = memoryStorage();
  writeFranchiseArt("far-cry", ART, 1_000, storage);
  assert.equal(readFranchiseArt("far-cry", 1_000 + FRANCHISE_ART_TTL_MS + 1, storage), null);
  assert.equal(readFranchiseArt("far-cry", 500, storage), null);
});

test("caps the cache at 50 entries, keeping the newest", () => {
  const storage = memoryStorage();
  for (let i = 0; i < 60; i++) writeFranchiseArt(`f${i}`, ART, 1_000 + i, storage);
  const stored = JSON.parse(storage.raw());
  assert.equal(Object.keys(stored).length, 50);
  assert.equal(readFranchiseArt("f0", 2_000, storage), null);
  assert.ok(readFranchiseArt("f59", 2_000, storage));
});

test("tolerates corrupt or blocked storage", () => {
  assert.equal(readFranchiseArt("x", 0, memoryStorage({ [FRANCHISE_ART_KEY]: "{not json" })), null);
  assert.equal(readFranchiseArt("x", 0, memoryStorage({ [FRANCHISE_ART_KEY]: "[1,2]" })), null);
  assert.equal(
    readFranchiseArt("x", 0, memoryStorage({ [FRANCHISE_ART_KEY]: '{"x":{"rawgId":"bad"}}' })),
    null,
  );
  const throwing = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  assert.equal(readFranchiseArt("x", 0, throwing), null);
  assert.doesNotThrow(() => writeFranchiseArt("x", ART, 0, throwing));
  assert.equal(readFranchiseArt("x", 0, null), null);
});
