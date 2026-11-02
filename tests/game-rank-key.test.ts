// @ts-nocheck -- Node's test modules are not included in the application tsconfig.
import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_KEY_LENGTH,
  compareRank,
  keyBetween,
  placeAt,
  spreadKeys,
} from "../src/lib/game-library/rank-key.ts";

// Seeded so a failure reproduces.
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const assertSorted = (keys) => {
  for (let i = 1; i < keys.length; i++) {
    assert.ok(keys[i - 1] < keys[i], `${keys[i - 1]} should sort before ${keys[i]}`);
  }
};

test("the first key has no bounds", () => {
  assert.match(keyBetween(null, null, seeded(1)), /^[0-9A-Za-z]+$/);
});

test("a key sorts strictly between its bounds", () => {
  const random = seeded(2);
  const a = keyBetween(null, null, random);
  const b = keyBetween(a, null, random);
  const mid = keyBetween(a, b, random);
  assert.ok(a < mid && mid < b);
});

test("keys sort correctly around a bound that is a prefix of the other", () => {
  const random = seeded(3);
  for (const [a, b] of [
    ["5", "5V"],
    ["1", "11"],
    ["a", "a1"],
    ["Uzz", "V"],
    ["z", null],
    [null, "1"],
    [null, "01"],
  ]) {
    for (let i = 0; i < 200; i++) {
      const key = keyBetween(a, b, random);
      if (a !== null) assert.ok(a < key, `${a} < ${key}`);
      if (b !== null) assert.ok(key < b, `${key} < ${b}`);
    }
  }
});

test("keys never end in the zero digit, which would leave no room below", () => {
  const random = seeded(4);
  let key = keyBetween(null, null, random);
  for (let i = 0; i < 5000; i++) {
    key = keyBetween(key, null, random);
    assert.notEqual(key.at(-1), "0");
  }
});

test("equal or reversed bounds still produce a key after the lower bound", () => {
  const random = seeded(5);
  assert.ok(keyBetween("Abc", "Abc", random) > "Abc");
  assert.ok(keyBetween("b", "a", random) > "b");
});

test("malformed stored keys are treated as missing bounds", () => {
  const random = seeded(6);
  assert.match(keyBetween("not a key!", null, random), /^[0-9A-Za-z]+$/);
  assert.match(keyBetween(null, "é", random), /^[0-9A-Za-z]+$/);
  assert.match(keyBetween(null, "000", random), /^[0-9A-Za-z]+$/);
  assert.ok(keyBetween("U10", null, random) > "U10");
});

test("appending and prepending stay short for a long time", () => {
  const random = seeded(7);
  let last = keyBetween(null, null, random);
  let first = last;
  for (let i = 0; i < 1500; i++) {
    const next = keyBetween(last, null, random);
    assert.ok(next > last);
    assert.ok(next.length <= 6, next);
    last = next;
    const previous = keyBetween(null, first, random);
    assert.ok(previous < first);
    assert.ok(previous.length <= 6, previous);
    first = previous;
  }
});

test("appending keeps working past the fixed-width head", () => {
  const random = seeded(8);
  let key = keyBetween(null, null, random);
  for (let i = 0; i < 4000; i++) {
    const next = keyBetween(key, null, random);
    assert.ok(next > key);
    key = next;
  }
});

test("prepending keeps working past the fixed-width head", () => {
  const random = seeded(9);
  let key = keyBetween(null, null, random);
  for (let i = 0; i < 4000; i++) {
    const next = keyBetween(null, key, random);
    assert.ok(next < key);
    key = next;
  }
});

test("10,000 random inserts keep the list in exactly the order requested", () => {
  const random = seeded(10);
  const expected = [];
  for (let i = 0; i < 10000; i++) {
    const at = Math.floor(random() * (expected.length + 1));
    const { position, rewrites } = placeAt(expected, at, random);
    for (const r of rewrites) expected.find((e) => e.id === r.id).position = r.position;
    expected.splice(at, 0, { id: `id${i}`, position });
  }
  assert.deepEqual(
    [...expected].sort(compareRank).map((e) => e.id),
    expected.map((e) => e.id),
  );
  assertSorted(expected.map((e) => e.position));
  assert.ok(expected.every((e) => e.position.length <= MAX_KEY_LENGTH));
});

test("compareRank uses the id to settle identical keys on every device", () => {
  const a = { id: "a", position: "U" };
  const b = { id: "b", position: "U" };
  assert.deepEqual([b, a].sort(compareRank), [a, b]);
  assert.deepEqual([a, b].sort(compareRank), [a, b]);
});

test("compareRank orders by code unit, not by locale", () => {
  const ranked = ["a", "B", "0", "Z", "z"].map((position) => ({ id: position, position }));
  assert.deepEqual(
    ranked.sort(compareRank).map((r) => r.position),
    ["0", "B", "Z", "a", "z"],
  );
});

test("a normal move writes only the moved item", () => {
  const random = seeded(11);
  const siblings = spreadKeys(5, random).map((position, i) => ({ id: `${i}`, position }));
  const { position, rewrites } = placeAt(siblings, 2, random);
  assert.deepEqual(rewrites, []);
  assert.ok(siblings[1].position < position && position < siblings[2].position);
});

test("the index is clamped to the list", () => {
  const random = seeded(12);
  const siblings = spreadKeys(3, random).map((position, i) => ({ id: `${i}`, position }));
  assert.ok(placeAt(siblings, -5, random).position < siblings[0].position);
  assert.ok(placeAt(siblings, 99, random).position > siblings[2].position);
  assert.deepEqual(placeAt([], 4, random).rewrites, []);
});

test("dropping between neighbours that share a key moves one neighbour", () => {
  const random = seeded(13);
  const siblings = [
    { id: "a", position: "U1" },
    { id: "b", position: "U1" },
    { id: "c", position: "W1" },
  ];
  const { position, rewrites } = placeAt(siblings, 1, random);
  assert.equal(rewrites.length, 1);
  assert.equal(rewrites[0].id, "b");
  assert.ok("U1" < position);
  assert.ok(position < rewrites[0].position);
  assert.ok(rewrites[0].position < "W1");
});

test("a run of identical keys is spread out after the drop", () => {
  const random = seeded(14);
  const siblings = ["a", "b", "c", "d"].map((id) => ({ id, position: "U1" }));
  const { position, rewrites } = placeAt(siblings, 1, random);
  assert.deepEqual(
    rewrites.map((r) => r.id),
    ["b", "c", "d"],
  );
  assertSorted(["U1", position, ...rewrites.map((r) => r.position)]);
});

test("repeatedly filling one gap stays bounded by respacing", () => {
  const random = seeded(15);
  const list = spreadKeys(3, random).map((position, i) => ({ id: `s${i}`, position }));
  let rewritten = 0;
  for (let i = 0; i < 2000; i++) {
    const { position, rewrites } = placeAt(list, 1, random);
    rewritten += rewrites.length > 0 ? 1 : 0;
    for (const r of rewrites) list.find((e) => e.id === r.id).position = r.position;
    list.splice(1, 0, { id: `n${i}`, position });
    assert.ok(position.length <= MAX_KEY_LENGTH);
  }
  assertSorted(list.map((e) => e.position));
  assert.ok(rewritten < 200, `respaced ${rewritten} times`);
});

test("spreadKeys returns the requested number of ascending keys", () => {
  const keys = spreadKeys(40, seeded(16));
  assert.equal(keys.length, 40);
  assertSorted(keys);
  assert.deepEqual(spreadKeys(0), []);
});
