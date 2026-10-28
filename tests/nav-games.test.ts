// @ts-nocheck -- Node's test modules are not included in the application tsconfig.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { mergeNavOrder, navFeatureAllows } from "../src/chrome/nav-order.ts";

const DEFAULTS = [
  "home",
  "discover",
  "movies",
  "shows",
  "games",
  "kids",
  "vod",
  "calendar",
  "library",
  "downloads",
  "addons",
  "settings",
];
const PRE_GAMES = DEFAULTS.filter((id) => id !== "games");

test("Games is opt-in: hidden unless explicitly enabled", () => {
  assert.equal(navFeatureAllows("games", undefined), false);
  assert.equal(navFeatureAllows("games", {}), false);
  assert.equal(navFeatureAllows("games", { downloads: true }), false);
  assert.equal(navFeatureAllows("games", { games: false }), false);
  assert.equal(navFeatureAllows("games", { games: true }), true);
  // Existing behaviour for other entries is unchanged.
  assert.equal(navFeatureAllows("downloads", undefined), true);
  assert.equal(navFeatureAllows("downloads", { downloads: false }), false);
  assert.equal(navFeatureAllows("movies", undefined), true);
});

test("Games sits directly after Shows in the default order", () => {
  const source = readFileSync(new URL("../src/chrome/nav-items.tsx", import.meta.url), "utf8");
  const ids = [...source.matchAll(/^\s*(?:\{ )?id: "([a-z]+)",/gm)].map((m) => m[1]);
  assert.deepEqual(ids, DEFAULTS);
  for (const file of ["sidebar", "dracula-sidebar", "forest-sidebar", "nord-sidebar", "siderail"]) {
    const layout = readFileSync(new URL(`../src/chrome/${file}.tsx`, import.meta.url), "utf8");
    assert.match(layout, /PRIMARY_IDS = new Set(?:<string>)?\(\[[^\]]*"shows",\s*"games",/, file);
    assert.match(layout, /navFeaturesFor\(settings\)/, file);
  }
});

test("a saved custom order that predates Games gets it right after Shows", () => {
  const saved = ["movies", "shows", "home", "discover", ...PRE_GAMES.slice(4)];
  const merged = mergeNavOrder(saved, DEFAULTS);
  assert.deepEqual(merged.slice(0, 5), ["movies", "shows", "games", "home", "discover"]);
  assert.equal(merged.length, DEFAULTS.length);
});

test("Games follows its nearest present neighbour when Shows was dropped from the order", () => {
  const merged = mergeNavOrder(["discover", "home", "movies"], DEFAULTS);
  assert.equal(merged.indexOf("games"), merged.indexOf("movies") + 1);
});

test("other missing ids keep the historic append-at-end behaviour", () => {
  // An order saved before Downloads existed: Downloads still goes to the end.
  const saved = PRE_GAMES.filter((id) => id !== "downloads");
  const merged = mergeNavOrder(saved, DEFAULTS);
  assert.equal(merged.at(-1), "downloads");
  assert.equal(merged.indexOf("games"), merged.indexOf("shows") + 1);
});

test("full saved orders are returned unchanged and unknown ids are dropped", () => {
  const custom = [...DEFAULTS].reverse();
  assert.deepEqual(mergeNavOrder(custom, DEFAULTS), custom);
  assert.deepEqual(mergeNavOrder(["ghost", ...DEFAULTS], DEFAULTS), DEFAULTS);
});
