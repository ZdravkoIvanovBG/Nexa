// @ts-nocheck -- Node's test modules are not included in the application tsconfig.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { mergeRecord } from "../src/lib/game-library/merge.ts";
import { isGamePlayed } from "../src/lib/game-library/played.ts";
import {
  addToBoard,
  applyPatch,
  backToWishlist,
  chainChanges,
  beginPlaying,
  boardTier,
  franchiseCollection,
  gameStage,
  isEmptyPatch,
  markPlayed,
  moveToTier,
  playAgain,
  playStateOf,
  playingView,
  removeFromBoard,
  removeFromTierList,
  restoreState,
  restoreTier,
  saveCollection,
  saveGame,
  setNotes,
  setProgress,
  setProgressEnabled,
  setStatus,
  startGame,
  stepOnBoard,
  tierBoard,
  tierStateOf,
  wishlistView,
} from "../src/lib/game-library/rules.ts";
import { franchiseMenuActions, gameMenuActions } from "../src/views/game-discovery/game-menu.ts";

const src = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

const rawg = (id, name = `Game ${id}`) => ({
  provider: "rawg",
  rawgId: id,
  slug: `game-${id}`,
  name,
  released: "2010-01-01",
  image: `https://media.rawg.io/${id}.jpg`,
});
const igdb = (id, name = `Game ${id}`) => ({
  provider: "igdb",
  igdbId: id,
  slug: `igdb-game-${id}`,
  name,
  released: "2012-01-01",
  image: null,
});

/** Applies changes in sequence with a clock that always moves forward. */
function library() {
  let now = 1000;
  let data = { records: {}, queue: {} };
  const ctx = () => ({ now: (now += 10) });
  return {
    get data() {
      return data;
    },
    get now() {
      return now;
    },
    run(change, ...args) {
      const patch = change(data, ...args, ctx());
      data = applyPatch(data, patch);
      return patch;
    },
  };
}

// ── Mark as Played = the existing Completed status ──────────────────────────

test("a game that was never saved can be marked played directly", () => {
  const lib = library();
  const patch = lib.run(markPlayed, rawg(1));
  const record = lib.data.records["rawg:1"];
  assert.equal(record.status, "completed");
  assert.equal(record.completedAt, lib.now);
  assert.equal(record.startedAt, null, "it was never started");
  assert.equal(patch.queue.length, 0, "no Wishlist row is added");
  assert.equal(gameStage(lib.data, "rawg:1"), "completed");
  // It shows where completed games do: Currently Playing's Completed list,
  // and Unranked on the Tier List.
  assert.deepEqual(
    playingView(lib.data).completed.map((r) => r.gameId),
    ["rawg:1"],
  );
  assert.equal(boardTier(record), "unranked");
});

test("IGDB games are marked played the same way", () => {
  const lib = library();
  lib.run(markPlayed, igdb(7));
  assert.equal(lib.data.records["igdb:7"].status, "completed");
  assert.equal(lib.data.records["igdb:7"].provider, "igdb");
});

test("a Wishlist game marked played keeps its Wishlist row, hidden, and its place", () => {
  const lib = library();
  lib.run(saveGame, rawg(1));
  lib.run(saveGame, rawg(2));
  const row = lib.data.queue["g:rawg:1"];
  lib.run(markPlayed, rawg(1));
  assert.equal(gameStage(lib.data, "rawg:1"), "completed");
  assert.deepEqual(lib.data.queue["g:rawg:1"], row, "the row is untouched");
  assert.deepEqual(
    wishlistView(lib.data).map((i) => i.record.gameId),
    ["rawg:2"],
  );
});

test("a collection member marked played stays in its collection", () => {
  const lib = library();
  const def = { franchiseId: "ac", title: "Assassin's Creed Collection", image: null };
  lib.run(saveCollection, def, [rawg(10), rawg(11)], []);
  const before = JSON.stringify(lib.data.queue);
  lib.run(markPlayed, rawg(10));
  assert.equal(JSON.stringify(lib.data.queue), before);
  assert.equal(lib.data.records["rawg:10"].status, "completed");
});

test("a game being played keeps its start date when marked played", () => {
  const lib = library();
  lib.run(startGame, rawg(1));
  const started = lib.data.records["rawg:1"].startedAt;
  lib.run(markPlayed, rawg(1));
  assert.equal(lib.data.records["rawg:1"].status, "completed");
  assert.equal(lib.data.records["rawg:1"].startedAt, started);
});

test("paused and dropped games can be marked played", () => {
  for (const status of ["paused", "dropped"]) {
    const lib = library();
    lib.run(startGame, rawg(1));
    lib.run(setStatus, "rawg:1", status);
    lib.run(markPlayed, rawg(1));
    assert.equal(lib.data.records["rawg:1"].status, "completed", status);
  }
});

test("marking an already played game again writes nothing", () => {
  const lib = library();
  lib.run(markPlayed, rawg(1));
  assert.ok(isEmptyPatch(lib.run(markPlayed, rawg(1))));
});

test("notes, progress, rank and collections survive Mark as Played", () => {
  const lib = library();
  lib.run(saveGame, rawg(1));
  lib.run(startGame, rawg(1));
  lib.run(setNotes, "rawg:1", "Final chapter left.");
  lib.run(setProgressEnabled, "rawg:1", true);
  lib.run(setProgress, "rawg:1", 80);
  lib.run(moveToTier, "rawg:1", "A", 0);
  const before = lib.data.records["rawg:1"];
  const patch = lib.run(markPlayed, rawg(1));
  const after = lib.data.records["rawg:1"];
  for (const key of [
    "notes",
    "notesAt",
    "progressEnabled",
    "progress",
    "progressAt",
    "tier",
    "tierPosition",
    "tierAt",
  ]) {
    assert.deepEqual(after[key], before[key], key);
  }
  assert.ok(after.stateAt > before.stateAt, "only the state group is stamped");
  assert.equal(patch.queue.length, 0);
  assert.equal(patch.records.length, 1);
});

test("Undo puts back exactly the state before, saved or not", () => {
  // A game that was being played.
  const lib = library();
  lib.run(startGame, rawg(1));
  const previous = playStateOf(lib.data.records["rawg:1"]);
  lib.run(markPlayed, rawg(1));
  lib.run(restoreState, "rawg:1", previous);
  assert.deepEqual(playStateOf(lib.data.records["rawg:1"]), previous);

  // A game that was never saved: Undo leaves it on no list at all.
  const fresh = library();
  fresh.run(markPlayed, rawg(2));
  fresh.run(restoreState, "rawg:2", { status: null, startedAt: null, completedAt: null });
  assert.equal(gameStage(fresh.data, "rawg:2"), "none");
  assert.equal(playingView(fresh.data).completed.length, 0);
});

// ── the card menu, by state ─────────────────────────────────────────────────

const base = { canSave: true, stage: "none", standalone: false, maybeSame: false, onBoard: false };
const menu = (over) => gameMenuActions({ ...base, ...over });

test("a card's menu offers what the game page offers, by the game's state", () => {
  assert.deepEqual(menu({}), ["details", "separator", "add-wishlist", "start", "played"]);
  assert.deepEqual(menu({ stage: "wishlist", standalone: true }), [
    "details",
    "separator",
    "view-wishlist",
    "start",
    "played",
    "separator",
    "remove-wishlist",
  ]);
  assert.deepEqual(menu({ stage: "collection" }), [
    "details",
    "separator",
    "view-wishlist",
    "start",
    "played",
  ]);
  assert.deepEqual(menu({ stage: "playing" }), [
    "details",
    "separator",
    "view-playing",
    "pause",
    "played",
  ]);
  for (const stage of ["paused", "dropped"]) {
    assert.deepEqual(menu({ stage }), ["details", "separator", "view-playing", "resume", "played"]);
  }
  assert.deepEqual(menu({ stage: "completed" }), [
    "details",
    "separator",
    "view-playing",
    "again",
    "add-tiers",
  ]);
  assert.deepEqual(menu({ stage: "completed", onBoard: true }).at(-1), "view-tiers");
});

test("a maybe-the-same game is only offered on its page; kid profiles only view details", () => {
  assert.deepEqual(menu({ maybeSame: true }), ["details", "separator", "add-wishlist"]);
  assert.deepEqual(menu({ canSave: false }), ["details"]);
  assert.deepEqual(menu({ canSave: false, stage: "playing" }), ["details"]);
});

// ── the game page's buttons ─────────────────────────────────────────────────

test("the game page's buttons use the Movie/Show detail page's styles", () => {
  const save = src("views/game-discovery/save-controls.tsx");
  const movie = src("views/detail.tsx");
  const constant = (name) => save.match(new RegExp(`export const ${name} =\\s*"([^"]+)";`))?.[1];
  for (const name of ["PILL", "PILL_IDLE", "PILL_SAVED", "PILL_ON", "ROUND"]) {
    const value = constant(name);
    assert.ok(value, name);
    assert.ok(movie.includes(value), `${name} matches views/detail.tsx`);
  }
  const detail = src("views/game-discovery/game-detail.tsx");
  assert.equal(detail.match(/className=\{`\$\{PILL\} \$\{PILL_IDLE\}`\}/g)?.length, 3);
  // The provider links still open the provider's page.
  assert.match(detail, /onClick=\{\(\) => openUrl\(page\)\}/);
  assert.match(detail, /onClick=\{\(\) => openUrl\(link\)\}/);
});

test("the game page offers Add to Wishlist, Start Playing and Mark as Played, then Played ✓", () => {
  const save = src("views/game-discovery/save-controls.tsx");
  for (const label of [
    "Add to Wishlist",
    "Start Playing",
    "Mark as Played",
    "Played",
    "Play again",
  ]) {
    assert.ok(save.includes(`t("${label}")`), label);
  }
  // Played ✓ is the active style and opens the existing Completed menu.
  assert.match(
    save,
    /onClick=\{\(e\) => openMenu\(e\.currentTarget, statusMenu\("completed"\)\)\}\s*className=\{`\$\{PILL\} \$\{PILL_ON\}`\}/,
  );
  assert.match(save, /const played = \(\) => markGamePlayed\(own, name, t\);/);
  assert.match(
    save,
    /label: t\("Mark as Played"\),\s*icon: <CircleCheckBig \{\.\.\.ICON\} \/>,\s*run: \(\) => completeGame/,
  );
});

test("Mark as Played resolves the ref inside the change, like a save", () => {
  const actions = src("views/game-library/play-actions.ts");
  const fn = actions.slice(actions.indexOf("export function markGamePlayed"));
  assert.match(
    fn,
    /changeGameLibrary\(\(data, ctx\) => \{\s*const target = libraryRef\(data, ref\);[\s\S]*?return markPlayed\(data, target, ctx\);/,
  );
  assert.match(fn, /offerUndo\(seen\.gameId, \{ previous: seen\.previous, patch \}, message, t\)/);
  // No new status, field or table: Completed, through setStatus.
  const rules = src("lib/game-library/rules.ts");
  assert.match(
    rules.slice(rules.indexOf("export function markPlayed")),
    /return setStatus\([\s\S]*?"completed",\s*ctx,\s*\);/,
  );
});

// ── the card's right-click menu ─────────────────────────────────────────────

test("both card shapes open Nexa's menu instead of the browser's", () => {
  const card = src("views/game-discovery/game-card.tsx");
  assert.equal(card.match(/onContextMenu=\{\(e\) => openGameCardMenu\(e, game\)\}/g)?.length, 2);
  // Left-click still opens the game.
  assert.equal(card.match(/onClick=\{\(\) => openGame\(game\)\}/g)?.length, 2);
  const menuFile = src("views/game-discovery/game-card-menu.tsx");
  assert.match(menuFile, /event\.preventDefault\(\);\s*event\.stopPropagation\(\);/);
  // Keyboard (Menu key, Shift+F10) opens below the card; a click at the pointer.
  assert.match(
    menuFile,
    /if \(r\.fromKeyboard\) openFromButton\(r\.trigger, items\);\s*else openAt\(r\.x, r\.y, r\.trigger, items\);/,
  );
});

test("the card menu writes nothing itself: every action is a shared one", () => {
  const menuFile = src("views/game-discovery/game-card-menu.tsx");
  assert.doesNotMatch(menuFile, /changeGameLibrary|game-library\/rules|toGameRef/);
  assert.match(menuFile, /run: \(\) => own && saveToWishlist\(own, name, t, view\)/);
  assert.match(menuFile, /run: \(\) => own && markGamePlayed\(own, name, t\)/);
  // The global app menu leaves an event a card already handled alone.
  assert.match(src("components/context-menu.tsx"), /if \(e\.defaultPrevented\) return;/);
});

test("the shared card menu is mounted only while a Games page is open", () => {
  const app = src("App.tsx");
  assert.match(
    app,
    /\{gamesOn && \(gamesAlive \|\| gameAlive \|\| gameBrowseAlive \|\| gameFranchiseAlive\) && \(\s*<Suspense fallback=\{null\}>\s*<GameCardMenuHost \/>/,
  );
  assert.match(
    app,
    /const importGameCardMenu = \(\) => import\("@\/views\/game-discovery\/game-card-menu"\);/,
  );
});

// ── the Played tick on Discovery cards ──────────────────────────────────────

const played = (lib, gameId, slug = "") => isGamePlayed(lib.data, { gameId, slug });

test("the tick shows only for Played (Completed), never for other states", () => {
  const lib = library();
  assert.equal(played(lib, "rawg:1"), false, "not in the library");
  lib.run(saveGame, rawg(1));
  assert.equal(played(lib, "rawg:1"), false, "Wishlist");
  lib.run(beginPlaying, "rawg:1");
  assert.equal(played(lib, "rawg:1"), false, "Playing");
  lib.run(setStatus, "rawg:1", "paused");
  assert.equal(played(lib, "rawg:1"), false, "Paused");
  lib.run(setStatus, "rawg:1", "dropped");
  assert.equal(played(lib, "rawg:1"), false, "Dropped");
  lib.run(markPlayed, rawg(1));
  assert.equal(played(lib, "rawg:1"), true, "Played");
  lib.run(markPlayed, igdb(5));
  assert.equal(played(lib, "igdb:5"), true, "IGDB");
});

test("the tick follows every change: Undo, Play again, Back to Wishlist", () => {
  const lib = library();
  lib.run(startGame, rawg(1));
  const previous = playStateOf(lib.data.records["rawg:1"]);
  lib.run(markPlayed, rawg(1));
  assert.equal(played(lib, "rawg:1"), true);
  lib.run(restoreState, "rawg:1", previous);
  assert.equal(played(lib, "rawg:1"), false, "after Undo");
  lib.run(markPlayed, rawg(1));
  lib.run(playAgain, "rawg:1");
  assert.equal(played(lib, "rawg:1"), false, "after Play again");
  lib.run(markPlayed, rawg(1));
  lib.run(backToWishlist, "rawg:1");
  assert.equal(played(lib, "rawg:1"), false, "after Back to Wishlist");
  // A never-saved game marked played, then undone: no tick.
  lib.run(markPlayed, rawg(2));
  lib.run(restoreState, "rawg:2", { status: null, startedAt: null, completedAt: null });
  assert.equal(played(lib, "rawg:2"), false);
});

test("the tick reads whatever the library holds, so a synced or reloaded record shows it", () => {
  // As hydration does: a record that arrives from another device.
  const remote = library();
  remote.run(markPlayed, rawg(3));
  const here = { records: { ...remote.data.records }, queue: {} };
  assert.equal(isGamePlayed(here, { gameId: "rawg:3", slug: "" }), true);
  // And a reload re-reads the same stored blob: a structural copy decides the same.
  assert.equal(
    isGamePlayed(JSON.parse(JSON.stringify(here)), { gameId: "rawg:3", slug: "" }),
    true,
  );
});

test("the tick crosses providers through the curated catalog, like the game page", () => {
  // Assassin's Creed II: curated RAWG slug assassins-creed-ii, reviewed IGDB id 127.
  const lib = library();
  const ac2 = { ...rawg(4201, "Assassin's Creed II"), slug: "assassins-creed-ii" };
  lib.run(markPlayed, ac2);
  assert.equal(isGamePlayed(lib.data, { gameId: "igdb:127", slug: "igdb-127" }), true, "IGDB card");
  assert.equal(isGamePlayed(lib.data, { gameId: "rawg:4201", slug: "assassins-creed-ii" }), true);
  // An uncurated look-alike is not the same game.
  assert.equal(isGamePlayed(lib.data, { gameId: "igdb:128", slug: "igdb-128" }), false);
});

test("both card shapes show the Movie/Show Watched tick when the game is Played", () => {
  const card = src("views/game-discovery/game-card.tsx");
  assert.equal(card.match(/const played = useGamePlayed\(game\);/g)?.length, 2);
  assert.equal(card.match(/\{played && <PlayedBadge \/>\}/g)?.length, 2);
  assert.match(
    card,
    /return ready && isGamePlayed\(data, \{ gameId: game\.id, slug: game\.slug \}\);/,
  );
  // Same badge as pick-card.tsx's Watched tick.
  const tick =
    "absolute bottom-1.5 start-1.5 z-[1] flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/90 text-white ring-1 ring-emerald-300/40 backdrop-blur-sm";
  assert.ok(card.includes(tick));
  assert.ok(
    src("components/pick-card.tsx").includes(
      "absolute bottom-1.5 start-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/90 text-white ring-1 ring-emerald-300/40 backdrop-blur-sm",
    ),
  );
  // Reading the library is all a card does: still no writes from a card.
  assert.doesNotMatch(card, /changeGameLibrary|game-library\/rules|toGameRef/);
});

// ── Start Playing on a Wishlist row ─────────────────────────────────────────

test("a Wishlist row's Start Playing moves it to Currently Playing and keeps the order", () => {
  const lib = library();
  for (const id of [1, 2, 3]) lib.run(saveGame, rawg(id));
  const row = lib.data.queue["g:rawg:2"];
  lib.run(beginPlaying, "rawg:2"); // what startRecord runs
  assert.equal(lib.data.records["rawg:2"].status, "playing");
  assert.deepEqual(
    wishlistView(lib.data).map((i) => i.record.gameId),
    ["rawg:1", "rawg:3"],
  );
  assert.deepEqual(lib.data.queue["g:rawg:2"], row, "its row is kept, hidden, in its place");
  lib.run(backToWishlist, "rawg:2");
  assert.deepEqual(
    wishlistView(lib.data).map((i) => i.record.gameId),
    ["rawg:1", "rawg:2", "rawg:3"],
  );
});

test("a collection row's Start Playing starts its next game, then the one after", () => {
  const lib = library();
  const def = { franchiseId: "ac", title: "Assassin's Creed Collection", image: null };
  lib.run(saveCollection, def, [rawg(10), rawg(11)], []);
  const next = () => wishlistView(lib.data)[0].nextUp?.gameId ?? null;
  assert.equal(next(), "rawg:10");
  lib.run(beginPlaying, next());
  assert.equal(next(), "rawg:11");
  lib.run(beginPlaying, next());
  assert.equal(next(), null, "no button once every game has been started");
});

test("the Wishlist rows' Start Playing runs the menu's own start", () => {
  const list = src("views/game-library/wishlist-list.tsx");
  assert.match(
    list,
    /<StartButton\s+label=\{t\("Start Playing"\)\}\s+title=\{t\("Start \{name\}", \{ name: record\.name \}\)\}\s+onStart=\{\(\) => startRecord\(record\.gameId, record\.name, t\)\}\s+\/>\s+<MoreButton/,
  );
  assert.match(
    list,
    /\{item\.nextUp && \(\s*<StartButton[\s\S]*?if \(next\) startRecord\(next\.gameId, next\.name, t\);[\s\S]*?\/>\s*\)\}\s*<MoreButton/,
  );
  const menus = src("views/game-library/entry-menus.tsx");
  assert.match(menus, /run: \(\) => startRecord\(record\.gameId, record\.name, t\)/);
  assert.match(menus, /run: \(\) => startRecord\(next\.gameId, next\.name, t\)/);
});

// ── Franchise collection cards: Nexa's menu ─────────────────────────────────

test("a franchise card's menu offers the collection actions for its state", () => {
  const unsaved = { canSave: true, saved: false, canAdd: true, hasNext: false };
  assert.deepEqual(franchiseMenuActions(unsaved), ["open", "separator", "add-wishlist"]);
  assert.deepEqual(franchiseMenuActions({ ...unsaved, saved: true, hasNext: true }), [
    "open",
    "separator",
    "view-wishlist",
    "start-next",
  ]);
  assert.deepEqual(
    franchiseMenuActions({ ...unsaved, saved: true, hasNext: false }),
    ["open", "separator", "view-wishlist"],
    "nothing left to start",
  );
  assert.deepEqual(
    franchiseMenuActions({ ...unsaved, canAdd: false }),
    ["open"],
    "a provider that can't load or save it offers only Open",
  );
  for (const saved of [false, true]) {
    assert.deepEqual(
      franchiseMenuActions({ canSave: false, saved, canAdd: true, hasNext: true }),
      ["open"],
      "kid profiles and an unloaded library only open the collection",
    );
  }
});

test("a franchise's collection state: saved or not, and its next unstarted game", () => {
  const lib = library();
  assert.equal(franchiseCollection(lib.data, "ac"), null);
  const def = { franchiseId: "ac", title: "Assassin's Creed", image: null };
  lib.run(saveCollection, def, [rawg(10), rawg(11), igdb(12)], []);
  assert.equal(franchiseCollection(lib.data, "ac").nextUp.gameId, "rawg:10");
  lib.run(beginPlaying, "rawg:10");
  assert.equal(franchiseCollection(lib.data, "ac").nextUp.gameId, "rawg:11");
  lib.run(markPlayed, rawg(11));
  assert.equal(franchiseCollection(lib.data, "ac").nextUp.gameId, "igdb:12", "IGDB members too");
  lib.run(beginPlaying, "igdb:12");
  const found = franchiseCollection(lib.data, "ac");
  assert.equal(found.entry.franchiseId, "ac");
  assert.equal(found.nextUp, null, "every game started: no Start item");
  // The card's next game is the Wishlist row's next game.
  lib.run(backToWishlist, "rawg:11");
  const row = wishlistView(lib.data).find((i) => i.kind === "collection");
  assert.equal(franchiseCollection(lib.data, "ac").nextUp.gameId, row.nextUp.gameId);
});

test("saving a franchise's collection twice changes nothing", () => {
  const lib = library();
  const def = { franchiseId: "ac", title: "Assassin's Creed", image: null };
  lib.run(saveCollection, def, [rawg(10), rawg(11)], []);
  const before = JSON.stringify(lib.data);
  assert.ok(isEmptyPatch(lib.run(saveCollection, def, [rawg(10), rawg(11)], [])));
  assert.equal(JSON.stringify(lib.data), before);
});

test("franchise cards open Nexa's menu, never the browser's, by mouse or keyboard", () => {
  const card = src("views/game-discovery/franchise-card.tsx");
  assert.match(
    card,
    /onClick=\{\(\) => openGameFranchise\(franchise\.id\)\}/,
    "left-click opens it",
  );
  assert.match(card, /onContextMenu=\{menu\.onContextMenu\}/);
  assert.match(card, /useFranchiseCardMenu\(franchise, gate, art\.image\)/);
  // The menu is rendered beside the card, not inside the button.
  assert.match(card, /<\/button>\s*\{menu\.element\}/);
  const menu = src("views/game-discovery/franchise-card-menu.tsx");
  assert.match(menu, /event\.preventDefault\(\);\s*event\.stopPropagation\(\);/);
  assert.match(
    menu,
    /if \(isKeyboardContextMenu\(event\)\) menu\.openFromButton\(trigger, build\(\)\);\s*else menu\.openAt\(event\.clientX, event\.clientY, trigger, build\(\)\);/,
    "Shift+F10 and the Menu key open it below the card, which gets focus back",
  );
  assert.match(menu, /useActionMenu\(\)/, "the Game Library's menu, as on game cards");
  // No business logic of its own: the page's save, the Wishlist's start.
  assert.doesNotMatch(menu, /changeGameLibrary|game-library\/rules|toGameRef/);
  assert.match(
    menu,
    /saveCollectionToWishlist\(franchise, refs as GameRef\[\], image \?\? games\[0\]\.image/,
  );
  assert.match(menu, /resolveFranchiseData\(await load\(franchise\), "release"\)\.groups\.main/);
  assert.match(menu, /const refs = games\.map\(savableRef\);/);
  assert.match(menu, /if \(next\) startRecord\(next\.gameId, next\.name, t\);/);
  assert.match(menu, /const profileId = activeGameProfile\(\) \?\? "";/);
  assert.match(menu, /canSave,/, "kid profiles get Open only");
});

test("the franchise page and the card save collections through one function", () => {
  const save = src("views/game-discovery/save-controls.tsx");
  assert.match(
    save,
    /const save = \(\) =>\s*saveCollectionToWishlist\(def, memberRefs, image \?\? games\[0\]\.image, t, view\);/,
  );
  const fn = save.slice(
    save.indexOf("export function saveCollectionToWishlist"),
    save.indexOf("export function franchiseCollectionStateOf"),
  );
  assert.match(fn, /activeGameProfile\(\) !== options\.profileId\)\s*return false;/);
  assert.match(fn, /changeGameLibrary\(\(d, ctx\) =>\s*saveCollection\(/);
  // The card reuses the page's query (same key), so a visited page costs no request.
  const queries = src("lib/game-discovery/queries.ts");
  assert.match(queries, /useQuery\(\{\s*\.\.\.franchiseQueryOptions\(qc, provider, def\),/);
  assert.match(queries, /qc\.fetchQuery\(franchiseQueryOptions\(qc, provider, def\)\)/);
});

test("game cards and the Wishlist keep their menus", () => {
  const card = src("views/game-discovery/game-card.tsx");
  assert.equal(
    (card.match(/onContextMenu=\{\(e\) => openGameCardMenu\(e, game\)\}/g) ?? []).length,
    2,
  );
  const cardMenu = src("views/game-discovery/game-card-menu.tsx");
  assert.match(cardMenu, /const fromKeyboard = isKeyboardContextMenu\(event\);/);
  assert.match(src("views/game-library/wishlist-list.tsx"), /<MoreButton/);
  assert.match(src("views/game-library/wishlist-gallery.tsx"), /<MoreButton/);
});

// ── Tier List tiles: the movie Tier List's X, not a menu ────────────────────

/** The source of a button, from a marker inside it to its closing tag. */
const buttonAt = (source, marker) => {
  const at = source.indexOf(marker);
  assert.ok(at >= 0, marker);
  return source.slice(at, source.indexOf("</button>", at));
};

test("Tier List tiles have the movie Tier List's X and red Remove, and no ⋯ menu", () => {
  const row = src("views/game-library/tier-row.tsx");
  const tab = src("views/game-library/tier-tab.tsx");
  assert.doesNotMatch(row, /MoreButton|tileMenu|More options for/);
  assert.doesNotMatch(tab, /useActionMenu|tileMenu|menu\.element/);
  const movie = buttonAt(src("views/library/tier-tile.tsx"), "onMouseLeave");
  const game = buttonAt(row, "data-tile-remove");
  // Same look in both states; the game tile's hover group is named.
  for (const cls of [
    "absolute end-1 top-1 flex h-6 items-center justify-center gap-1 rounded-full text-white shadow-[0_2px_8px_rgba(0,0,0,0.4)] transition-all duration-200",
    '"bg-danger px-2 text-[10px] font-semibold"',
    "w-6 bg-canvas/70 opacity-0 backdrop-blur-sm hover:bg-canvas/90 focus-visible:opacity-100",
    "<X size={12} strokeWidth={2.4} />",
    '{confirmRemove && t("Remove")}',
  ]) {
    assert.ok(movie.includes(cls), `movie: ${cls}`);
    assert.ok(game.includes(cls), `game: ${cls}`);
  }
  assert.match(game, /group-hover\/tile:opacity-100/, "shows on hover");
  assert.match(
    game,
    /\[@media\(hover:none\)\]:opacity-100/,
    "always shown where there is no hover",
  );
});

test("the X confirms first, and leaving, blurring or Escape cancels", () => {
  const row = src("views/game-library/tier-row.tsx");
  const x = buttonAt(row, "data-tile-remove");
  assert.match(x, /onPointerDown=\{\(e\) => e\.stopPropagation\(\)\}/, "never starts a drag");
  assert.match(x, /onMouseLeave=\{\(\) => setConfirmRemove\(false\)\}/);
  assert.match(x, /onBlur=\{\(e\) => \{/, "a real move of focus away cancels");
  assert.match(
    x,
    /if \(e\.key === "Escape" && confirmRemove\) \{[\s\S]*?setConfirmRemove\(false\);/,
  );
  assert.match(
    x,
    /if \(confirmRemove\) \{\s*setConfirmRemove\(false\);[\s\S]*?onRemove\(e\.detail === 0\);\s*\} else \{\s*setConfirmRemove\(true\);/,
  );
  assert.match(
    row,
    /<button\s+type="button"\s+data-tile-remove=\{gameId\}/,
    "a real button: Tab reaches it, Enter and Space press it",
  );
  assert.match(x, /aria-label=\{\s*confirmRemove/);
  // The tile itself: right-click shows no browser menu, left-click opens the game.
  assert.match(row, /onContextMenu=\{\(e\) => e\.preventDefault\(\)\}/);
  assert.match(row, /onClick=\{onClick\}/);
  const tab = src("views/game-library/tier-tab.tsx");
  assert.match(tab, /if \(!drag\.consumeClick\(\)\) openDetails\(\);/);
  assert.match(
    tab,
    /removeTile\(gameId, tile\.record\.name, t\);/,
    "the existing removal, with its Undo",
  );
  assert.match(tab, /if \(fromKeyboard && neighbour\) focusTile\(neighbour\.record\.gameId\);/);
});

test("drag and keyboard ranking are still wired", () => {
  const row = src("views/game-library/tier-row.tsx");
  const tab = src("views/game-library/tier-tab.tsx");
  assert.match(tab, /onPointerDown=\{\(e\) => drag\.start\(gameId, e\)\}/);
  assert.match(tab, /const drag = useBoardDrag\(onDrop\);/);
  assert.match(tab, /dropTile\(gameId, tier, slot, t\);/);
  for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"]) {
    assert.match(row, new RegExp(`case "${key}":`), key);
  }
  assert.match(row, /moved = stepTile\(gameId, "up", t\);/);
  assert.match(row, /onLift\(true\);/, "Space picks a game up");
});

test("Tier List Remove on a completed game: off the board and no longer Played, the rest kept", () => {
  const lib = library();
  lib.run(saveGame, rawg(1));
  lib.run(saveGame, rawg(2));
  lib.run(startGame, rawg(1));
  lib.run(setProgressEnabled, "rawg:1", true);
  lib.run(setProgress, "rawg:1", 40);
  lib.run(setNotes, "rawg:1", "Great ending");
  lib.run(setStatus, "rawg:1", "completed");
  lib.run(moveToTier, "rawg:1", "S", 0);
  const before = lib.data.records["rawg:1"];
  const queue = JSON.stringify(lib.data.queue);
  assert.equal(played(lib, "rawg:1"), true);
  assert.deepEqual(
    wishlistView(lib.data).map((i) => i.record.gameId),
    ["rawg:2"],
  );

  const patch = lib.run(removeFromTierList, "rawg:1");
  assert.equal(patch.records.length, 1, "one record write");
  assert.equal(patch.queue.length, 0, "no Wishlist row written");
  const after = lib.data.records["rawg:1"];
  assert.equal(after.status, null, "no longer Completed");
  assert.equal(after.completedAt, null, "completion date cleared");
  assert.equal(after.startedAt, before.startedAt, "start date kept");
  assert.equal(after.tier, null);
  assert.equal(after.tierPosition, null);
  assert.ok(
    after.stateAt > before.stateAt && after.tierAt > before.tierAt,
    "both groups restamped",
  );
  for (const field of [
    "notes",
    "notesAt",
    "progress",
    "progressEnabled",
    "progressAt",
    "name",
    "image",
  ]) {
    assert.deepEqual(after[field], before[field], field);
  }
  const board = tierBoard(lib.data);
  assert.ok(
    Object.values(board).every((tiles) => !tiles.some((t) => t.record.gameId === "rawg:1")),
    "not even in Unranked",
  );
  assert.equal(played(lib, "rawg:1"), false, "the green Played tick goes");
  assert.deepEqual(playingView(lib.data).completed, [], "gone from Currently Playing → Completed");
  assert.equal(JSON.stringify(lib.data.queue), queue, "Wishlist rows untouched");
  assert.deepEqual(
    wishlistView(lib.data).map((i) => i.record.gameId),
    ["rawg:1", "rawg:2"],
    "back on the Wishlist in its own place",
  );
});

test("Undo after Remove restores the exact status, dates, tier and position", () => {
  const lib = library();
  for (const id of [1, 2, 3]) {
    lib.run(startGame, rawg(id));
    lib.run(setStatus, `rawg:${id}`, "completed");
    lib.run(moveToTier, `rawg:${id}`, "A", 99);
  }
  const before = lib.data.records["rawg:2"];
  const play = playStateOf(before);
  const tier = tierStateOf(before);
  lib.run(removeFromTierList, "rawg:2");
  // What removeTile's Undo runs, in one write.
  const undo = lib.run((data, ctx) =>
    chainChanges(data, ctx, [
      (d, c) => restoreState(d, "rawg:2", play, c),
      (d, c) => restoreTier(d, "rawg:2", tier, c),
    ]),
  );
  assert.equal(undo.records.length, 1);
  const r = lib.data.records["rawg:2"];
  assert.deepEqual(playStateOf(r), play);
  assert.deepEqual(tierStateOf(r), tier);
  assert.deepEqual(
    tierBoard(lib.data).A.map((t) => t.record.gameId),
    ["rawg:1", "rawg:2", "rawg:3"],
    "back in its place",
  );
  assert.equal(played(lib, "rawg:2"), true, "the tick comes back");
});

test("Undo for a game waiting in Unranked puts it back there, in finish order", () => {
  const lib = library();
  for (const id of [1, 2, 3]) lib.run(markPlayed, rawg(id));
  const ids = () => tierBoard(lib.data).unranked.map((t) => t.record.gameId);
  const order = ids();
  const before = lib.data.records["rawg:2"];
  lib.run(removeFromTierList, "rawg:2");
  assert.ok(!ids().includes("rawg:2"));
  assert.equal(lib.data.records["rawg:2"].status, null);
  lib.run((data, ctx) =>
    chainChanges(data, ctx, [
      (d, c) => restoreState(d, "rawg:2", playStateOf(before), c),
      (d, c) => restoreTier(d, "rawg:2", tierStateOf(before), c),
    ]),
  );
  assert.deepEqual(ids(), order);
  assert.equal(lib.data.records["rawg:2"].completedAt, before.completedAt);
});

test("a ranked game that isn't finished keeps its Playing, Paused or Dropped status", () => {
  for (const status of ["playing", "paused", "dropped"]) {
    const lib = library();
    lib.run(startGame, rawg(1));
    if (status !== "playing") lib.run(setStatus, "rawg:1", status);
    lib.run(addToBoard, "rawg:1");
    lib.run(moveToTier, "rawg:1", "B", 0);
    const before = lib.data.records["rawg:1"];
    lib.run(removeFromTierList, "rawg:1");
    const after = lib.data.records["rawg:1"];
    assert.equal(after.status, status, status);
    assert.equal(after.stateAt, before.stateAt, `${status}: state group untouched`);
    assert.equal(after.startedAt, before.startedAt);
    assert.deepEqual(tierBoard(lib.data).B, []);
    assert.equal(boardTier(after), null);
  }
});

test("collection members and notes survive Remove; finishing again puts it back in Unranked", () => {
  const lib = library();
  const def = { franchiseId: "ac", title: "Assassin's Creed", image: null };
  lib.run(saveCollection, def, [rawg(10), rawg(11)], []);
  lib.run(markPlayed, rawg(10));
  lib.run(setNotes, "rawg:10", "kept");
  const queue = JSON.stringify(lib.data.queue);
  lib.run(removeFromTierList, "rawg:10");
  assert.equal(JSON.stringify(lib.data.queue), queue);
  const col = wishlistView(lib.data).find((i) => i.kind === "collection");
  assert.deepEqual(
    col.members.map((m) => m.record.gameId),
    ["rawg:10", "rawg:11"],
  );
  assert.equal(col.nextUp.gameId, "rawg:10", "unplayed again, so it's next up");
  assert.equal(lib.data.records["rawg:10"].notes, "kept");
  // Like a re-watched film: a new finish lands in Unranked.
  lib.run(markPlayed, rawg(10));
  assert.deepEqual(
    tierBoard(lib.data).unranked.map((t) => t.record.gameId),
    ["rawg:10"],
  );
});

test("Remove stays removed after a restart and against an older copy from another device", () => {
  const lib = library();
  lib.run(markPlayed, rawg(1));
  lib.run(moveToTier, "rawg:1", "S", 0);
  const stale = lib.data.records["rawg:1"]; // what another device still has
  lib.run(removeFromTierList, "rawg:1");
  const removed = lib.data.records["rawg:1"];
  // Restart: the stored record comes back as written.
  const reloaded = JSON.parse(JSON.stringify(lib.data));
  assert.equal(boardTier(reloaded.records["rawg:1"]), null);
  // This device's removal against the cloud's older copy: the removal uploads.
  let m = mergeRecord(removed, stale);
  assert.equal(m.upload, true);
  assert.equal(m.merged.status, null);
  assert.equal(m.merged.completedAt, null);
  assert.equal(m.merged.tier, null);
  // Another device holding the older copy takes the removal from the cloud.
  m = mergeRecord(stale, removed);
  assert.equal(m.upload, false);
  assert.equal(m.merged.status, null);
  assert.equal(boardTier(m.merged), null);
  // A newer note from another device still merges in; the removal stands.
  m = mergeRecord(removed, { ...stale, notes: "from phone", notesAt: removed.stateAt + 50 });
  assert.equal(m.merged.notes, "from phone");
  assert.equal(m.merged.status, null);
  assert.equal(boardTier(m.merged), null);
});

test("the Tier List X runs removeFromTierList, and its Undo restores both groups", () => {
  const actions = src("views/game-library/tier-actions.ts");
  const fn = actions.slice(
    actions.indexOf("export function removeTile"),
    actions.indexOf("export function addTile"),
  );
  assert.match(fn, /return removeFromTierList\(data, gameId, ctx\);/);
  assert.match(
    fn,
    /previous = record \? \{ play: playStateOf\(record\), tier: tierStateOf\(record\) \} : null;/,
  );
  assert.match(
    fn,
    /chainChanges\(data, ctx, \[\s*\(d, c\) => restoreState\(d, gameId, before\.play, c\),\s*\(d, c\) => restoreTier\(d, gameId, before\.tier, c\),\s*\]\)/,
  );
  assert.match(fn, /\{ profileId \}/, "Undo never lands on another profile");
  assert.doesNotMatch(fn, /removeFromBoard/);
});

test("tiles still move between tiers and within one", () => {
  const lib = library();
  for (const id of [1, 2, 3]) {
    lib.run(markPlayed, rawg(id));
    lib.run(moveToTier, `rawg:${id}`, "A", 99);
  }
  const ids = (tier) => tierBoard(lib.data)[tier].map((t) => t.record.gameId);
  assert.deepEqual(ids("A"), ["rawg:1", "rawg:2", "rawg:3"]);
  lib.run(moveToTier, "rawg:3", "S", 0); // a drop on another tier
  assert.deepEqual(ids("S"), ["rawg:3"]);
  lib.run(stepOnBoard, "rawg:2", "left"); // the keyboard's arrows
  assert.deepEqual(ids("A"), ["rawg:2", "rawg:1"]);
  lib.run(stepOnBoard, "rawg:1", "up");
  assert.deepEqual(ids("S"), ["rawg:3", "rawg:1"]);
  lib.run(removeFromBoard, "rawg:3");
  lib.run(addToBoard, "rawg:3");
  assert.deepEqual(ids("unranked"), ["rawg:3"], "Add games brings a removed game back");
});

test("TV navigation's programmatic blur (no new focus) doesn't cancel the Remove confirmation", () => {
  const x = src("views/game-library/tier-row.tsx");
  assert.match(
    x,
    /onBlur=\{\(e\) => \{\s*if \(e\.relatedTarget instanceof Node && !e\.currentTarget\.contains\(e\.relatedTarget\)\)\s*setConfirmRemove\(false\);\s*\}\}/,
  );
  // The blur it must survive: every pointerdown, one frame later.
  const nav = src("lib/keyboard-navigation.ts");
  assert.match(nav, /if \(focused && !isEditable\(focused\)\) focused\.blur\(\);/);
});

// ── Currently Playing: Back to Wishlist on the card ─────────────────────────

test("Playing and Paused cards show Back to Wishlist between Mark completed and Notes", () => {
  const card = src("views/game-library/playing-card.tsx");
  const row = card.slice(card.indexOf('{status === "playing" && ('), card.indexOf("<MoreButton"));
  const order = [
    "onClick={() => pauseGame(gameId, name, t)}",
    "onClick={() => completeGame(gameId, name, t)}",
    "onClick={() => sendBackToWishlist(gameId, name, t)}",
    't("Notes & progress")',
  ].map((s) => row.indexOf(s));
  assert.ok(
    order.every((i) => i >= 0),
    JSON.stringify(order),
  );
  assert.deepEqual(
    [...order].sort((a, b) => a - b),
    order,
    "Pause, Mark completed, Back to Wishlist, Notes",
  );
  assert.match(
    row,
    /\{\(status === "playing" \|\| status === "paused"\) && \(\s*\/\/[^\n]*\n\s*<button\s+type="button"\s+data-back-to-wishlist\s+onClick=\{\(\) => sendBackToWishlist\(gameId, name, t\)\}\s+className=\{SECONDARY\}/,
    "the menu's own action, in the card's secondary button style",
  );
  // The ⋯ menu keeps its own Back to Wishlist.
  assert.match(
    card,
    /label: t\("Back to Wishlist"\),\s*icon: <ListOrdered \{\.\.\.ICON\} \/>,\s*run: \(\) => sendBackToWishlist\(gameId, name, t\),/,
  );
  // The row wraps instead of overflowing on a narrow card.
  assert.match(card, /<div className="mt-auto flex flex-wrap items-center gap-2 pt-0\.5">/);
});

test("Back to Wishlist from Playing or Paused restores the Wishlist place, collections, notes and progress", () => {
  for (const from of ["playing", "paused"]) {
    const lib = library();
    lib.run(saveGame, rawg(1));
    lib.run(saveGame, rawg(2));
    lib.run(saveGame, rawg(3));
    const def = { franchiseId: "ac", title: "Assassin's Creed", image: null };
    lib.run(saveCollection, def, [rawg(10), rawg(11)], []);
    const queue = JSON.stringify(lib.data.queue);
    for (const id of ["rawg:2", "rawg:10"]) {
      lib.run(beginPlaying, id);
      lib.run(setProgressEnabled, id, true);
      lib.run(setProgress, id, 35);
      lib.run(setNotes, id, `notes for ${id}`);
      if (from === "paused") lib.run(setStatus, id, "paused");
    }
    assert.deepEqual(
      wishlistView(lib.data).map((i) => (i.kind === "game" ? i.record.gameId : i.entry.entryId)),
      ["rawg:1", "rawg:3", "c:ac"],
    );
    for (const id of ["rawg:2", "rawg:10"]) {
      const started = lib.data.records[id].startedAt;
      lib.run(backToWishlist, id);
      const r = lib.data.records[id];
      assert.equal(r.status, null, `${from}: ${id} leaves Currently Playing`);
      assert.equal(r.notes, `notes for ${id}`);
      assert.equal(r.progress, 35);
      assert.equal(r.progressEnabled, true);
      assert.equal(r.startedAt, started, "history kept");
    }
    assert.equal(JSON.stringify(lib.data.queue), queue, `${from}: no Wishlist row moved or added`);
    const view = wishlistView(lib.data);
    assert.deepEqual(
      view.map((i) => (i.kind === "game" ? i.record.gameId : i.entry.entryId)),
      ["rawg:1", "rawg:2", "rawg:3", "c:ac"],
      `${from}: back in its old place`,
    );
    const collection = view.find((i) => i.kind === "collection");
    assert.deepEqual(
      collection.members.map((m) => m.record.gameId),
      ["rawg:10", "rawg:11"],
      "still in its collection, in order",
    );
    assert.equal(collection.nextUp.gameId, "rawg:10");
    assert.deepEqual(playingView(lib.data).playing, []);
  }
});
