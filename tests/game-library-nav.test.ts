// @ts-nocheck -- Node's test modules are not included in the application tsconfig.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import test from "node:test";
import {
  currentLibrarySection,
  hasLibrarySection,
  withoutGameFrames,
} from "../src/lib/library-frames.ts";

const source = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

const ROOT = { kind: "library" };
const MOVIES = { kind: "library", section: "movies" };
const GAMES = { kind: "library", section: "games" };

test("a plain library frame has no section", () => {
  assert.equal(currentLibrarySection([ROOT]), null);
  assert.equal(hasLibrarySection([ROOT]), false);
  assert.equal(hasLibrarySection([{ kind: "home" }]), false);
  assert.equal(currentLibrarySection([{ kind: "home" }]), null);
});

test("the top library frame decides what the library layer shows", () => {
  assert.equal(currentLibrarySection([ROOT, GAMES]), "games");
  assert.equal(currentLibrarySection([ROOT, MOVIES]), "movies");
  assert.equal(currentLibrarySection([ROOT, MOVIES, { kind: "meta" }]), "movies");
  assert.equal(hasLibrarySection([ROOT, GAMES, { kind: "game" }]), true);
});

test("turning Games off inside the Game Library lands on the Movie Library", () => {
  assert.deepEqual(withoutGameFrames([ROOT, GAMES], ROOT), [ROOT]);
  assert.deepEqual(withoutGameFrames([ROOT, MOVIES], ROOT), [ROOT]);
});

test("Settings stays open when Games is turned off from it", () => {
  const settings = { kind: "settings" };
  assert.deepEqual(withoutGameFrames([ROOT, GAMES, settings], ROOT), [ROOT, settings]);
});

test("game pages above the library go too, and nothing unrelated does", () => {
  const meta = { kind: "meta" };
  assert.deepEqual(withoutGameFrames([ROOT, GAMES, { kind: "game" }], ROOT), [ROOT]);
  assert.deepEqual(withoutGameFrames([ROOT, MOVIES, meta], ROOT), [ROOT, meta]);
});

test("reaching the library from Discovery still leaves a working stack", () => {
  const stack = [{ kind: "games" }, { kind: "game" }, GAMES, { kind: "settings" }];
  assert.deepEqual(withoutGameFrames(stack, ROOT), [ROOT, { kind: "settings" }]);
  assert.deepEqual(withoutGameFrames([{ kind: "games" }, GAMES], ROOT), [ROOT]);
});

test("the stack is never left empty", () => {
  assert.deepEqual(withoutGameFrames([{ kind: "games" }], ROOT), [ROOT]);
});

test("frames are not modified in place", () => {
  const stack = [ROOT, GAMES];
  withoutGameFrames(stack, ROOT);
  assert.deepEqual(stack, [ROOT, GAMES]);
});

// ── Games off keeps today's behaviour ───────────────────────────────────────

test("with Games off, App renders the Movie Library directly", () => {
  assert.match(
    source("App.tsx"),
    /\{gamesOn \? \(\s*<LibraryGate[\s\S]*?\/>\s*\) : \(\s*<LibraryView active=\{libraryTop\} \/>\s*\)\}/,
  );
});

test("the Movie Library's existing preload is untouched", () => {
  assert.match(source("App.tsx"), /const importLibrary = \(\) => import\("@\/views\/library"\);/);
  assert.match(source("App.tsx"), /void importLibrary\(\);/);
});

test("the gate uses the same Games switch as the rest of the app", () => {
  assert.match(source("App.tsx"), /const gamesOn = gamesFeatureEnabled\(settings\);/);
  const sync = source("router/sync.tsx");
  assert.match(sync, /const gamesEnabled = gamesFeatureEnabled\(settings\);/);
  assert.match(sync, /if \(gamesEnabled\) return;/);
});

test("a library section only exists above a plain library frame's route", () => {
  const view = source("lib/view.tsx");
  assert.match(view, /library: "library",/, "the route is unchanged");
  assert.match(view, /return \[\{ kind: "library" \}\];/, "the sidebar still resets the stack");
  assert.match(view, /return f\.section \? `library:\$\{f\.section\}` : "library";/);
});

test("Back appears on library and game pages in the floating-button layouts", () => {
  const back = source("chrome/floating-back.tsx");
  for (const kind of ["library", "game", "game-franchise", "game-browse"]) {
    assert.ok(back.includes(`topKind === "${kind}"`), kind);
  }
});

test("Movie Library files stay independent of the new screens", () => {
  for (const file of ["views/library.tsx", "views/library/watchlist-tab.tsx"]) {
    assert.doesNotMatch(source(file), /library-gate|library-chooser|game-library/, file);
  }
});

// ── what the new screens can reach ──────────────────────────────────────────

function sourcesUnder(path) {
  const url = new URL(`../src/${path}`, import.meta.url);
  if (!statSync(url).isDirectory()) return [path];
  return readdirSync(url).flatMap((name) => sourcesUnder(`${path}/${name}`));
}

const NEW_SCREENS = [
  "views/library-gate.tsx",
  "views/library-chooser.tsx",
  "views/library-chooser",
  "views/game-library.tsx",
  "views/game-library",
].flatMap(sourcesUnder);

test("the new screens send RAWG no requests and need no key", () => {
  assert.ok(NEW_SCREENS.length >= 6);
  for (const file of NEW_SCREENS) {
    // rawg/image only rewrites saved image URLs; it sends nothing.
    assert.doesNotMatch(
      source(file),
      /providers\/rawg(?!\/image)|game-discovery\/(queries|use-rawg|status|gates)|games-frame|useQuery/,
      file,
    );
  }
});

test("the chooser can't touch game data, so choosing a library changes nothing", () => {
  for (const file of [
    ...sourcesUnder("views/library-chooser"),
    "views/library-chooser.tsx",
    "views/library-gate.tsx",
  ]) {
    assert.doesNotMatch(source(file), /game-library\/|changeGameLibrary|supabase/, file);
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

test("the chooser ships no third-party artwork", () => {
  const art = source("views/library-chooser/art.ts");
  assert.match(art, /movies: null,/);
  assert.match(art, /games: null,/);
  assert.doesNotMatch(
    source("views/library-chooser/scenes.tsx"),
    /<image|href=|https?:\/\/(?!www\.w3)/,
  );
});

test("the chooser avoids aspect-ratio, which collapses on older WebView2 builds", () => {
  assert.doesNotMatch(source("views/library-chooser.tsx"), /aspect-\[/);
});

test("the sync code sets up no polling or realtime channel", () => {
  for (const file of sourcesUnder("lib/game-library")) {
    assert.doesNotMatch(source(file), /setInterval|\.channel\(|\.subscribe\(\{/, file);
  }
});
