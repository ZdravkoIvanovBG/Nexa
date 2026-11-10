// @ts-nocheck -- Node's test modules are not included in the application tsconfig.
// The game Tier List's drop geometry, and its tie to the movie Tier List's look.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { insertionSlot } from "../src/views/game-library/board-geometry.ts";

// Tiles 132 px wide, 10 px apart, 100 px tall; a row 600 px wide wraps after four.
const W = 132;
const H = 100;
const GAP = 10;
function tile(i, perLine = 4, left = 0, top = 0) {
  const col = i % perLine;
  const line = Math.floor(i / perLine);
  const l = left + col * (W + GAP);
  const t = top + line * (H + GAP);
  return { left: l, top: t, right: l + W, bottom: t + H };
}
const row = (n, perLine) => Array.from({ length: n }, (_, i) => tile(i, perLine));
const empty = { left: 5, right: 595, top: 0, bottom: H };

test("an empty row takes the drop at its start", () => {
  assert.deepEqual(insertionSlot([], 300, 50, { empty }), { index: 0, x: 5, top: 0, bottom: H });
  assert.equal(insertionSlot([], 300, 50, { empty, rtl: true }).x, 595);
});

test("the slot follows tile centres along a line", () => {
  const tiles = row(3);
  assert.equal(insertionSlot(tiles, 10, 50, { empty }).index, 0);
  assert.equal(insertionSlot(tiles, 70, 50, { empty }).index, 1, "past the first centre");
  assert.equal(insertionSlot(tiles, 200, 50, { empty }).index, 1);
  assert.equal(insertionSlot(tiles, 230, 50, { empty }).index, 2);
  assert.equal(insertionSlot(tiles, 500, 50, { empty }).index, 3, "after the last");
});

test("the marker sits in the gap before the slot, or after the last tile", () => {
  const tiles = row(3);
  const before = insertionSlot(tiles, 150, 50, { empty, gap: GAP });
  assert.equal(before.index, 1);
  assert.equal(before.x, tiles[1].left - GAP / 2);
  const end = insertionSlot(tiles, 590, 50, { empty, gap: GAP });
  assert.equal(end.x, tiles[2].right + GAP / 2);
  assert.deepEqual([end.top, end.bottom], [0, H]);
});

test("wrapped rows are read line by line", () => {
  const tiles = row(6, 4); // line 1: 0-3, line 2: 4-5
  const second = insertionSlot(tiles, 10, H + GAP + 50, { empty });
  assert.equal(second.index, 4, "start of the second line");
  assert.deepEqual([second.top, second.bottom], [H + GAP, 2 * H + GAP]);
  assert.equal(insertionSlot(tiles, 590, 50, { empty }).index, 4, "end of the first line");
  assert.equal(insertionSlot(tiles, 250, H + GAP + 50, { empty }).index, 6, "end of the row");
});

test("between lines, the nearer line wins; below the last line is the end", () => {
  const tiles = row(6, 4);
  assert.equal(insertionSlot(tiles, 10, H + 2, { empty }).index, 0, "just under line one");
  assert.equal(insertionSlot(tiles, 10, H + GAP - 1, { empty }).index, 4, "just above line two");
  assert.equal(insertionSlot(tiles, 10, 900, { empty }).index, 6);
  assert.equal(insertionSlot(tiles, 10, -40, { empty }).index, 0, "above the row");
});

test("right-to-left rows count from the right", () => {
  // In RTL the first tile is rightmost.
  const tiles = [0, 1, 2].map((i) => {
    const right = 600 - i * (W + GAP);
    return { left: right - W, top: 0, right, bottom: H };
  });
  assert.equal(insertionSlot(tiles, 590, 50, { empty, rtl: true }).index, 0);
  assert.equal(insertionSlot(tiles, 520, 50, { empty, rtl: true }).index, 1);
  assert.equal(insertionSlot(tiles, 10, 50, { empty, rtl: true }).index, 3);
  assert.equal(
    insertionSlot(tiles, 520, 50, { empty, rtl: true, gap: GAP }).x,
    tiles[1].right + GAP / 2,
  );
});

test("the dragged tile's absence never shifts the drop: the caller omits it", () => {
  // Dragging tile 1 of [0, 1, 2]: the caller passes [0, 2]. Dropping where tile
  // 1 was (between 0 and 2) gives index 1, which is where it stays.
  const all = row(3);
  const without = [all[0], all[2]];
  assert.equal(insertionSlot(without, all[1].left + 10, 50, { empty }).index, 1);
});

function tierStyle(path) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const block = source.match(/TIER_STYLE: Record<Tier, string> = \{([\s\S]*?)\};/);
  assert.ok(block, path);
  return Object.fromEntries(
    [...block[1].matchAll(/^\s*(\w+): "([^"]+)",/gm)].map((m) => [m[1], m[2]]),
  );
}

test("game tiers use exactly the movie Tier List's colours", () => {
  const movie = tierStyle("../src/views/library/tier-row.tsx");
  const game = tierStyle("../src/views/game-library/tier-row.tsx");
  assert.equal(Object.keys(movie).length, 7);
  assert.deepEqual(game, movie);
});

test("the game board imports nothing from the movie Tier List or its stores", () => {
  for (const file of ["tier-tab.tsx", "tier-row.tsx", "tier-actions.ts", "use-board-drag.ts"]) {
    const source = readFileSync(
      new URL(`../src/views/game-library/${file}`, import.meta.url),
      "utf8",
    );
    const imports = source.split("\n").filter((line) => /^(import|} from)/.test(line));
    assert.doesNotMatch(
      imports.join("\n"),
      /library-tracking|tier-order|views\/library\/|\.\.\/library\//,
      file,
    );
  }
});
