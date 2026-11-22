// @ts-nocheck -- Node's test modules are not included in the application tsconfig.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import test from "node:test";
import { hasGameLibraryFrame, withoutGameFrames } from "../src/lib/library-frames.ts";
import { navFeatureAllows } from "../src/chrome/nav-order.ts";
import { pathFromView, viewFromPath } from "../src/router/paths.ts";

const source = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
const exists = (path) => {
  try {
    statSync(new URL(`../src/${path}`, import.meta.url));
    return true;
  } catch {
    return false;
  }
};

const LIBRARY = { kind: "library" };
const GAME_LIBRARY = { kind: "game-library" };
const SETTINGS = { kind: "settings" };

// ── stack rules ─────────────────────────────────────────────────────────────

test("only a game-library frame counts as the Game Library", () => {
  assert.equal(hasGameLibraryFrame([GAME_LIBRARY]), true);
  assert.equal(hasGameLibraryFrame([{ kind: "game" }, GAME_LIBRARY]), true);
  assert.equal(hasGameLibraryFrame([LIBRARY]), false);
  assert.equal(hasGameLibraryFrame([{ kind: "games" }, { kind: "game" }]), false);
  assert.equal(hasGameLibraryFrame([{ kind: "home" }]), false);
});

test("turning Games off on the Game Library lands on My Library", () => {
  assert.deepEqual(withoutGameFrames([GAME_LIBRARY], LIBRARY), [LIBRARY]);
});

test("Settings stays open when Games is turned off from it, and Back leads to My Library", () => {
  assert.deepEqual(withoutGameFrames([GAME_LIBRARY, SETTINGS], LIBRARY), [LIBRARY, SETTINGS]);
});

test("a Game Library opened from a game page goes, game pages and all", () => {
  const stack = [{ kind: "games" }, { kind: "game" }, GAME_LIBRARY];
  assert.deepEqual(withoutGameFrames(stack, LIBRARY), [LIBRARY]);
  assert.deepEqual(withoutGameFrames([...stack, SETTINGS], LIBRARY), [LIBRARY, SETTINGS]);
  assert.deepEqual(withoutGameFrames([GAME_LIBRARY, { kind: "game" }], LIBRARY), [LIBRARY]);
});

test("nothing unrelated is touched, and the stack is never left empty", () => {
  const meta = { kind: "meta" };
  assert.deepEqual(withoutGameFrames([LIBRARY, meta], LIBRARY), [LIBRARY, meta]);
  assert.deepEqual(withoutGameFrames([{ kind: "home" }, meta], LIBRARY), [{ kind: "home" }, meta]);
  assert.deepEqual(withoutGameFrames([{ kind: "games" }], LIBRARY), [LIBRARY]);
});

test("frames are not modified in place", () => {
  const stack = [GAME_LIBRARY, SETTINGS];
  withoutGameFrames(stack, LIBRARY);
  assert.deepEqual(stack, [GAME_LIBRARY, SETTINGS]);
});

// ── My Library and the Game Library are separate pages ──────────────────────

test("My Library always renders the Movie/Show Library, Games on or off", () => {
  const app = source("App.tsx");
  assert.match(
    app,
    /\{libraryAlive && \(\s*<div className=\{layer\(libraryTop\)\}>\s*<Suspense fallback=\{null\}>\s*<LibraryView active=\{libraryTop\} \/>\s*<\/Suspense>/,
  );
  assert.doesNotMatch(app, /LibraryGate|library-gate|LibraryChooser/);
});

test("the chooser is gone", () => {
  for (const file of [
    "views/library-gate.tsx",
    "views/library-chooser.tsx",
    "views/library-chooser",
  ]) {
    assert.equal(exists(file), false, file);
  }
  assert.doesNotMatch(source("lib/view.tsx"), /librarySection|openLibrarySection|LibrarySection/);
});

test("the Game Library is its own page, rendered only with Games on", () => {
  const app = source("App.tsx");
  assert.match(app, /const gameLibraryTop = topKind === "game-library";/);
  assert.match(
    app,
    /\{gamesOn && gameLibraryAlive && \(\s*<div className=\{layer\(gameLibraryTop\)\}>\s*<Suspense fallback=\{null\}>\s*<GameLibraryView\s+active=\{gameLibraryTop\}/,
  );
  assert.match(app, /const importGameLibrary = \(\) => import\("@\/views\/game-library"\);/);
});

test("the Game Library has its own route, and My Library keeps its route", () => {
  assert.equal(pathFromView("library"), "/library");
  assert.equal(pathFromView("game-library"), "/game-library");
  assert.equal(viewFromPath("/game-library"), "game-library");
  assert.equal(viewFromPath("/library"), "library");
  assert.match(source("router/router.tsx"), /tabRoute\("\/game-library"\),/);
  const view = source("lib/view.tsx");
  assert.match(view, /library: "library",/);
  assert.match(view, /"game-library": "game-library",/);
  assert.match(view, /return \[\{ kind: "library" \}\];/, "the sidebar resets the stack");
  assert.match(view, /return \[\{ kind: "game-library" \}\];/, "and for the Game Library too");
});

test("a game page's links push the Game Library, so Back returns to the game", () => {
  assert.match(
    source("lib/view.tsx"),
    /const openGameLibrary = useCallback\(\(\) => \{\s*setNavStack\(\(cur\) => \{\s*const t = cur\[cur\.length - 1\];\s*if \(t\.kind === "game-library"\) return cur;\s*return pushFrame\(cur, \{ kind: "game-library" \}\);/,
  );
  const save = source("views/game-discovery/save-controls.tsx");
  assert.equal(save.match(/openGameLibrary\(\);/g)?.length, 3);
  for (const tab of ["wishlist", "tiers", "playing"]) {
    assert.match(save, new RegExp(`requestTab\\("${tab}"\\);\\s*openGameLibrary\\(\\);`), tab);
  }
});

test("turning Games off leaves the Game Library for My Library, other game pages for Home", () => {
  const sync = source("router/sync.tsx");
  assert.match(sync, /const gamesEnabled = gamesFeatureEnabled\(settings\);/);
  assert.match(
    sync,
    /if \(gamesEnabled\) return;\s*if \(hasGameLibraryFrames\) \{\s*setNavStack\(\(stack\) => withoutGameFrames\(stack, \{ kind: "library" \}\)\);\s*\} else if \(onGamesFrame\) \{\s*setView\("home"\);/,
  );
  // Forward can't lead back into it either.
  assert.match(
    source("lib/view.tsx"),
    /const hasGameLibraryFrames = hasGameLibraryFrame\(stack\) \|\| hasGameLibraryFrame\(forwardStack\);/,
  );
  assert.match(source("App.tsx"), /const gamesOn = gamesFeatureEnabled\(settings\);/);
});

test("the sidebar item follows the Games switch and My Library's parental lock", () => {
  assert.equal(navFeatureAllows("game-library", undefined), false);
  assert.equal(navFeatureAllows("game-library", { games: false }), false);
  assert.equal(navFeatureAllows("game-library", { games: true }), true);
  assert.equal(navFeatureAllows("library", undefined), true);
  assert.match(
    source("chrome/nav-items.tsx"),
    /id: "game-library",\s*label: "nav\.gameLibrary",\s*render: \(active\) => <GameLibraryIcon active=\{active\} \/>,\s*view: "game-library",\s*parentalKey: "library",/,
  );
  assert.match(
    source("views/settings/theme-panel/theme-studio/nav-editor.tsx"),
    /\(id !== "games" && id !== "game-library"\) \|\| settings\.gamesEnabled/,
  );
});

test("the Game Library header no longer points back into My Library", () => {
  const page = source("views/game-library.tsx");
  assert.doesNotMatch(page, /setView\("library"\)|t\("My library"\)/);
  assert.match(page, /\{t\("Game Library"\)\}/);
});

test("Back appears on the Game Library and game pages in the floating-button layouts", () => {
  const back = source("chrome/floating-back.tsx");
  for (const kind of ["game-library", "game", "game-franchise", "game-browse"]) {
    assert.ok(back.includes(`topKind === "${kind}"`), kind);
  }
  // The Game Library pads for it only when Back is actually showing.
  assert.match(
    source("App.tsx"),
    /backFloatsOverPage=\{\s*canGoBack &&\s*\(layout === "topdock" \|\| layout === "cinematic" \|\| layout === "royal"\)\s*\}/,
  );
});

test("kid profiles still can't reach the Game Library", () => {
  // App's kid allow-list sends every other page back to Kids.
  const app = source("App.tsx");
  const end = app.indexOf('if (!allowed) setView("kids");');
  assert.ok(end > 0);
  const allow = app.slice(app.lastIndexOf("const allowed", end), end);
  assert.match(allow, /topKind === "kids"/);
  assert.doesNotMatch(allow, /game/);
});

test("the Movie Library's existing preload is untouched", () => {
  assert.match(source("App.tsx"), /const importLibrary = \(\) => import\("@\/views\/library"\);/);
  assert.match(source("App.tsx"), /void importLibrary\(\);/);
});

test("Movie Library files stay independent of the Game Library", () => {
  for (const file of ["views/library.tsx", "views/library/watchlist-tab.tsx"]) {
    assert.doesNotMatch(source(file), /library-gate|library-chooser|game-library/, file);
  }
});

// ── custom-HTML layouts (Feishin) ───────────────────────────────────────────

test("Feishin has a Game Library button directly below its Library button", () => {
  const theme = source("lib/theme.ts");
  const library = theme.indexOf(
    `<button data-harbor-nav="library" onclick="window.harbor.navigate('library')">`,
  );
  const game = theme.indexOf(
    `<button data-harbor-nav="game-library" onclick="window.harbor.navigate('game-library')">`,
  );
  assert.ok(library > 0 && game > library, "both buttons exist, Game Library second");
  // Nothing sits between them but the Library button's own markup.
  assert.doesNotMatch(theme.slice(library, game), /<button[\s\S]*<button/);
  assert.match(theme.slice(game, game + 900), /<span>Game Library<\/span>/);
  // The Library button still opens My Library.
  assert.match(theme.slice(library, game), /<span>Library<\/span>/);
});

test("Feishin shows the Game Library button only while Nexa says it is available", () => {
  const theme = source("lib/theme.ts");
  assert.match(
    theme,
    /html\[data-theme-layout="custom"\]:not\(\[data-game-library="on"\]\) \.fsh-nav \[data-harbor-nav="game-library"\] \{ display: none; \}/,
  );
  // Its highlight is the same data-active rule every Feishin item uses.
  assert.match(theme, /\.fsh-nav button\[data-active\] \{ color: #3574FC; \}/);
});

test("the root flag follows Games, kid profiles and the My Library parental lock", () => {
  const app = source("App.tsx");
  assert.match(
    app,
    /const gameLibraryNav = gamesOn && !kid && !\(parentalLocked && hiddenTabs\.library\);/,
  );
  assert.match(
    app,
    /document\.documentElement\.dataset\.gameLibrary = gameLibraryNav \? "on" : "off";/,
  );
  // Same attribute App uses to highlight every layout's items, Feishin's included.
  assert.match(app, /el\.getAttribute\("data-harbor-nav"\) === topKind/);
});

test("the theme documentation lists the new flag and view", () => {
  const sheet = source("views/settings/theme-panel/theme-studio/cheat-sheet-data.ts");
  assert.match(sheet, /attr: "data-game-library",\s*values: \["on", "off"\],/);
  assert.match(sheet, /\{ id: "game-library", label: "Game Library \(only with Games on\)" \},/);
});

// ── what the new screens can reach ──────────────────────────────────────────

function sourcesUnder(path) {
  const url = new URL(`../src/${path}`, import.meta.url);
  if (!statSync(url).isDirectory()) return [path];
  return readdirSync(url).flatMap((name) => sourcesUnder(`${path}/${name}`));
}

const NEW_SCREENS = ["views/game-library.tsx", "views/game-library"].flatMap(sourcesUnder);

test("the Game Library sends RAWG no requests and needs no key", () => {
  assert.ok(NEW_SCREENS.length >= 4);
  for (const file of NEW_SCREENS) {
    // rawg/image only rewrites saved image URLs; it sends nothing.
    assert.doesNotMatch(
      source(file),
      /providers\/rawg(?!\/image)|game-discovery\/(queries|use-rawg|status|gates)|games-frame|useQuery/,
      file,
    );
  }
});

test("the Game Library changes data only through changeGameLibrary", () => {
  for (const file of NEW_SCREENS) {
    assert.doesNotMatch(
      source(file),
      /store-core|cloud\/(client|queue|hydrate|rows)|gameStore|gameQueue|lib\/supabase|localStorage\.setItem\("harbor\.games\./,
      file,
    );
  }
});

test("the sync code sets up no polling or realtime channel", () => {
  for (const file of sourcesUnder("lib/game-library")) {
    assert.doesNotMatch(source(file), /setInterval|\.channel\(|\.subscribe\(\{/, file);
  }
});

// IGDB Stage 7: Wishlist sort handles under TV navigation. Verified with real
// key events in headless Chrome (TV navigation on and off); these pin the shape.
test("only a lifted sort handle takes keys away from TV navigation", () => {
  const nav = readFileSync(new URL("../src/lib/keyboard-navigation.ts", import.meta.url), "utf8");
  assert.match(nav, /const KEYS_TAKEN_SELECTOR = '\[data-tv-local-keys="true"\]';/);
  // Checked first, so arrows, Back and Enter all reach the lifted handle.
  assert.match(
    nav,
    /if \(e\.altKey \|\| e\.ctrlKey \|\| e\.metaKey\) return;\s+if \(e\.target instanceof HTMLElement && e\.target\.closest\(KEYS_TAKEN_SELECTOR\)\) return;/,
  );
  // The resting handle is not locally managed: arrows still move focus there.
  assert.doesNotMatch(nav, /data-sort-handle/);

  const parts = readFileSync(
    new URL("../src/views/game-library/wishlist-parts.tsx", import.meta.url),
    "utf8",
  );
  assert.match(parts, /data-tv-local-keys=\{lifted \? "true" : undefined\}/);
  assert.match(parts, /aria-pressed=\{lifted\}/);
  // Escape puts a lifted game down; at rest it is left to Back.
  assert.match(parts, /if \(e\.key === "Escape" && lifted\)/);

  // The Tier List's tiles follow the same rule: only a lifted tile takes the keys,
  // and at rest Escape is left to Back (it is only handled in the lifted branch).
  const tiles = readFileSync(
    new URL("../src/views/game-library/tier-row.tsx", import.meta.url),
    "utf8",
  );
  assert.match(tiles, /data-tv-local-keys=\{lifted \? "true" : undefined\}/);
  assert.match(tiles, /aria-pressed=\{lifted\}/);
  assert.match(tiles, /if \(!lifted\) \{[\s\S]*?return;\s*\}[\s\S]*?case "Escape":/);

  // Nothing else in the app opts out of TV navigation this way.
  const users = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (
        /\.tsx?$/.test(entry.name) &&
        readFileSync(path, "utf8").includes("data-tv-local-keys")
      )
        users.push(path.replace(/^.*\/src\//, "src/"));
    }
  };
  walk(new URL("../src", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
  assert.deepEqual(users.sort(), [
    "src/lib/keyboard-navigation.ts",
    "src/views/game-library/tier-row.tsx",
    "src/views/game-library/wishlist-parts.tsx",
  ]);
});
