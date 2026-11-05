// @ts-nocheck -- Node's test modules are not included in the application tsconfig.
// Stage 4: the development-only provider switch, the IGDB gate, cache
// isolation between providers, provider-dependent presentation, and the
// Stage 4/5/6 boundaries (no IGDB saves, no IGDB franchises). Pure modules and
// source-shape checks; no React, no Tauri, no network.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DEV_PROVIDER_KEY,
  createDevProviderStore,
  resolveActiveGameProvider,
} from "../src/lib/game-discovery/dev-provider.ts";
import { providerPageUrl, safeExternalUrl } from "../src/lib/game-discovery/external-url.ts";
import { gameImage } from "../src/lib/game-discovery/game-image.ts";
import { gamesSearchAvailable, igdbConfigState } from "../src/lib/game-discovery/gates.ts";
import { createIgdbStatusStore } from "../src/lib/game-discovery/igdb-status.ts";
import { PRODUCTION_GAME_PROVIDER, providerFeatures } from "../src/lib/game-discovery/provider.ts";
import { isStaleGamesQuery } from "../src/lib/game-discovery/query-root.ts";
import { gameSections } from "../src/lib/game-discovery/sections.ts";
import { rawgImage } from "../src/lib/providers/rawg/image.ts";
import { criticScoreOf, userScoreOf } from "../src/views/game-discovery/format.ts";

const src = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
}

// ---------------------------------------------------------------------------
// Development-only switch

test("production builds are always RAWG, whatever is stored", () => {
  assert.equal(PRODUCTION_GAME_PROVIDER, "rawg");
  assert.equal(resolveActiveGameProvider(false, "igdb"), "rawg");
  const storage = memoryStorage({ [DEV_PROVIDER_KEY]: "igdb" });
  const store = createDevProviderStore({ dev: false, storage });
  assert.equal(store.switchable, false);
  assert.equal(store.get(), "rawg");
  store.set("igdb");
  assert.equal(store.get(), "rawg", "set is a no-op in production");
});

test("development builds switch explicitly and only to exactly 'igdb'", () => {
  for (const junk of [null, "", "IGDB", "igdb ", "steam", "rawg", 1]) {
    assert.equal(resolveActiveGameProvider(true, junk), "rawg", String(junk));
  }
  const storage = memoryStorage();
  const store = createDevProviderStore({ dev: true, storage });
  let heard = 0;
  store.subscribe(() => heard++);
  assert.equal(store.get(), "rawg");
  store.set("igdb");
  assert.equal(store.get(), "igdb");
  assert.equal(storage.data.get(DEV_PROVIDER_KEY), "igdb");
  store.set("igdb");
  store.set("rawg");
  assert.equal(heard, 2, "one notice per real change");
  assert.equal(storage.data.has(DEV_PROVIDER_KEY), false, "RAWG clears the key");
  assert.equal(
    createDevProviderStore({
      dev: true,
      storage: memoryStorage({ [DEV_PROVIDER_KEY]: "igdb" }),
    }).get(),
    "igdb",
  );
});

test("the switch key stays out of backups, cloud side-stores, settings and Supabase", () => {
  // Backups and side-stores sweep the `harbor.` namespace; the key is outside it.
  assert.ok(!DEV_PROVIDER_KEY.startsWith("harbor."));
  for (const path of [
    "lib/backup.ts",
    "lib/cloud/side-stores.ts",
    "lib/settings/types.ts",
    "lib/settings/defaults.ts",
    "lib/cloud/rows.ts",
  ]) {
    assert.ok(!/gamesProvider|nexa\.dev/.test(src(path)), path);
  }
});

test("unreadable or unwritable storage falls back to RAWG / this session", () => {
  const throwing = {
    getItem() {
      throw new Error("denied");
    },
    setItem() {
      throw new Error("full");
    },
    removeItem() {},
  };
  const store = createDevProviderStore({ dev: true, storage: throwing });
  assert.equal(store.get(), "rawg");
  store.set("igdb");
  assert.equal(store.get(), "igdb", "kept for the session");
});

// ---------------------------------------------------------------------------
// IGDB gate

const status = (state, storage = "secure") => ({
  storage,
  state,
  verifying: false,
  clientIdHint: null,
});

test("only verified IGDB credentials open the gate", () => {
  assert.equal(igdbConfigState(status("verified"), true), "ready");
  assert.equal(igdbConfigState(status("configured"), true), "igdb_unverified");
  assert.equal(igdbConfigState(status("invalid"), true), "igdb_rejected");
  assert.equal(igdbConfigState(status("not_configured"), true), "igdb_missing");
  assert.equal(igdbConfigState(status("corrupted"), true), "igdb_missing");
  assert.equal(igdbConfigState(status("unavailable", "unavailable"), true), "igdb_unavailable");
  assert.equal(igdbConfigState(status("not_configured", "unsupported"), true), "igdb_unsupported");
  assert.equal(igdbConfigState(null, true), "igdb_checking");
  assert.equal(igdbConfigState(status("verified"), false), "igdb_unsupported", "web build");
  // Global search follows the active gate; kid profiles never get it.
  assert.equal(gamesSearchAvailable({ featureEnabled: true, ready: true }, true), false);
});

test("status store: one read, generations move only on credential changes", async () => {
  let reads = 0;
  let next = status("verified");
  const store = createIgdbStatusStore(async () => {
    reads++;
    return next;
  });
  store.ensure();
  store.ensure();
  await store.refresh();
  assert.equal(reads, 1, "ensure reads once; a concurrent refresh shares it");
  assert.equal(store.get().status.state, "verified");
  assert.equal(store.get().generation, 0);
  store.publish(status("verified"));
  assert.equal(store.get().generation, 0, "a re-verify keeps the cache");
  store.publish(status("not_configured"), { credentialsChanged: true });
  assert.equal(store.get().generation, 1, "removal starts a fresh cache");
  store.publish(status("verified"), { credentialsChanged: true });
  assert.equal(store.get().generation, 2, "new credentials start a fresh cache");
});

test("status store: a slow read never overwrites a newer published status", async () => {
  let release;
  const store = createIgdbStatusStore(
    () => new Promise((resolve) => (release = () => resolve(status("verified")))),
  );
  const pending = store.refresh();
  store.publish(status("not_configured"), { credentialsChanged: true });
  release();
  await pending;
  assert.equal(store.get().status.state, "not_configured");
});

test("the gate reads IGDB status only when IGDB is active and Games is on", () => {
  const hook = code(src("lib/game-discovery/use-games-gate.ts"));
  assert.match(hook, /useIgdbStatus\(provider === "igdb" && rawg\.featureEnabled\)/);
  assert.match(hook, /if \(needed && igdbNativeAvailable\) igdbStatus\.ensure\(\);/);
});

// ---------------------------------------------------------------------------
// Cache isolation

test("switching provider, credentials or turning Games off drops the old cache", () => {
  const igdb = { provider: "igdb", scope: "g1" };
  assert.equal(isStaleGamesQuery(["harbor", "games", "rawg", "abc", "list"], igdb), true);
  assert.equal(isStaleGamesQuery(["harbor", "games", "igdb", "g0", "list"], igdb), true);
  assert.equal(
    isStaleGamesQuery(["harbor", "games", "igdb", "g1", "detail", "igdb:1"], igdb),
    false,
  );
  assert.equal(
    isStaleGamesQuery(["harbor", "games", "igdb", "g1", "list"], null),
    true,
    "Games off",
  );
  for (const other of [["harbor", "tmdb", "movie"], ["catalog", "x"], []]) {
    assert.equal(isStaleGamesQuery(other, null), false, "never touches Movies/Shows");
  }
  const app = src("App.tsx");
  assert.match(app, /useGamesCacheIsolation\(\);/);
  const iso = code(src("lib/game-discovery/cache-isolation.ts"));
  // The cleanup never reads the credential store itself.
  assert.match(iso, /const games = useGamesCacheScope\(\);/);
  assert.doesNotMatch(iso, /useGamesGate\(/);
  assert.match(
    code(src("lib/game-discovery/use-games-gate.ts")),
    /const \{ generation \} = useIgdbStatus\(false\);/,
  );
  assert.match(iso, /qc\.cancelQueries\(\{ predicate \}\)/);
  assert.match(iso, /qc\.removeQueries\(\{ predicate \}\)/);
});

test("query keys lead with the provider and its scope; frames remount on a switch", () => {
  const queries = src("lib/game-discovery/queries.ts");
  assert.match(queries, /all: \(p: Scope\) => \[\.\.\.ROOT, p\.id, p\.scope\] as const/);
  const frame = src("views/game-discovery/games-frame.tsx");
  assert.match(frame, /<Fragment key=\{`\$\{gate\.provider\}:\$\{gate\.scope\}`\}>/);
});

test("every Games query waits for the active provider's gate", () => {
  const queries = src("lib/game-discovery/queries.ts");
  const enabled = [...queries.matchAll(/enabled: (enabled [^,\n]+)/g)].map((m) => m[1]);
  assert.equal(enabled.length, 8);
  for (const e of enabled) assert.match(e, /gate\.ready/, e);
});

// ---------------------------------------------------------------------------
// Sections and presentation

test("IGDB rows keep RAWG's ids, order and titles (Popular is relabelled honestly)", () => {
  const today = new Date(2026, 10, 5);
  const rawg = gameSections(today, "rawg");
  const igdb = gameSections(today, "igdb");
  assert.deepEqual(
    igdb.map((s) => s.id),
    rawg.map((s) => s.id),
  );
  assert.deepEqual(
    igdb.map((s) => s.eager),
    rawg.map((s) => s.eager),
  );
  assert.deepEqual(
    igdb.map((s) => s.title),
    ["Popular right now", ...rawg.slice(1).map((s) => s.title)],
  );
  for (const s of igdb) assert.equal(s.filter.section, s.id);
  assert.ok(!igdb.some((s) => /Metacritic|RAWG/.test(s.subtitle)));
  // RAWG's rows are exactly as before.
  assert.deepEqual(gameSections(today), rawg);
  assert.deepEqual(rawg[0].filter, { dates: "2026-01-01,2026-11-05", ordering: "-added" });
});

test("scores: Metacritic only for RAWG; IGDB shows Critic Score and User Score", () => {
  const rawg = { metacritic: 92, criticScore: undefined, rating: 4.6 };
  assert.deepEqual(criticScoreOf(rawg), { score: 92, label: "Metacritic", count: 0 });
  assert.equal(userScoreOf(rawg), null);
  const igdb = {
    metacritic: null,
    criticScore: 88,
    criticCount: 12,
    userScore: 92,
    userCount: 900,
  };
  assert.deepEqual(criticScoreOf(igdb), { score: 88, label: "Critic score", count: 12 });
  assert.deepEqual(userScoreOf(igdb), { score: 92, count: 900 });
  assert.equal(criticScoreOf({ metacritic: null, criticScore: null }), null);
});

test("image sizes: RAWG unchanged, IGDB resized, covers never resized into a crop", () => {
  const r = "https://media.rawg.io/media/games/618/618c.jpg";
  for (const w of [420, 640, 1280, null]) assert.deepEqual(gameImage(r, w), rawgImage(r, w));
  const art = "https://images.igdb.com/igdb/image/upload/t_1080p/abc123.jpg";
  assert.deepEqual(gameImage(art, 640), [
    "https://images.igdb.com/igdb/image/upload/t_screenshot_med/abc123.jpg",
    art,
  ]);
  assert.deepEqual(
    gameImage(art, 1280)[0],
    "https://images.igdb.com/igdb/image/upload/t_720p/abc123.jpg",
  );
  assert.deepEqual(gameImage(art, null), [art]);
  const cover = "https://images.igdb.com/igdb/image/upload/t_cover_big/abc123.jpg";
  assert.deepEqual(gameImage(cover, 640), [cover]);
  assert.deepEqual(gameImage(null, 640), []);
});

test("portrait covers are never placed in the hero or stretched in a card", () => {
  const discovery = src("views/game-discovery.tsx");
  assert.match(discovery, /\.filter\(\(g\) => heroImageOf\(g\)\)/);
  const format = src("views/game-discovery/format.ts");
  assert.match(format, /if \(game\.heroImage !== undefined\) return game\.heroImage;/);
  assert.match(format, /return game\.imageKind === "portrait" \? null : game\.image;/);
  const card = src("views/game-discovery/game-card.tsx");
  assert.match(
    card,
    /const \[src, \.\.\.fallbacks\] = portrait \? \[\] : gameImage\(game\.image, 640\);/,
  );
  assert.match(card, /object-contain/);
});

test("outbound links: rawg.io for RAWG, www.igdb.com (https) for IGDB, http(s) websites", () => {
  assert.equal(providerPageUrl("rawg", "the-witcher-3"), "https://rawg.io/games/the-witcher-3");
  assert.equal(providerPageUrl("rawg", "../x"), null);
  assert.equal(
    providerPageUrl("igdb", "x", "https://www.igdb.com/games/the-witcher-3-wild-hunt"),
    "https://www.igdb.com/games/the-witcher-3-wild-hunt",
  );
  for (const bad of [
    "http://www.igdb.com/games/x",
    "https://evil.example/games/x",
    "https://www.igdb.com.evil.example/x",
    "javascript:alert(1)",
    null,
  ]) {
    assert.equal(providerPageUrl("igdb", "x", bad), null, String(bad));
  }
  assert.equal(safeExternalUrl("https://thewitcher.com"), "https://thewitcher.com/");
  assert.equal(safeExternalUrl("file:///C:/x"), null);
});

// ---------------------------------------------------------------------------
// Stage 5 boundary: franchises

test("IGDB never gets curated franchises (Stage 5), RAWG keeps them", () => {
  assert.deepEqual(providerFeatures("rawg"), { franchises: true, librarySaves: true });
  assert.deepEqual(providerFeatures("igdb"), { franchises: false, librarySaves: false });
  const discovery = src("views/game-discovery.tsx");
  assert.match(discovery, /const franchises = providerFeatures\(gate\.provider\)\.franchises;/);
  assert.match(discovery, /\{franchises && \(\s*<WhenNear/);
  const detail = src("views/game-discovery/game-detail.tsx");
  assert.match(
    detail,
    /const franchise = providerFeatures\(gate\.provider\)\.franchises\s*\? franchiseForSlug\(game\.slug\)\s*: null;/,
  );
  const view = src("views/game-discovery/franchise-view.tsx");
  assert.match(view, /providerFeatures\(gate\.provider\)\.franchises \?/);
  const queries = src("lib/game-discovery/queries.ts");
  assert.match(queries, /providerFeatures\(provider\.id\)\.franchises/);
  // RAWG franchise art in the device cache is never shown for another provider.
  assert.match(queries, /const id = supported \? \(def\?\.id \?\? ""\) : "";/);
});

// ---------------------------------------------------------------------------
// Stage 6 boundary: the Game Library

test("Discovery can't save an IGDB game: every write takes its ref from savableRef", () => {
  const save = code(src("views/game-discovery/save-controls.tsx"));
  assert.match(
    save,
    /export function savableRef\(game: GameSummary\): GameRef \| null \{\s*return providerFeatures\(providerOf\(game\.id\)\)\.librarySaves \? toGameRef\(game\) : null;\s*\}/,
  );
  assert.equal((save.match(/toGameRef\(/g) ?? []).length, 1, "toGameRef only inside savableRef");
  // Every library change passes a ref that came from savableRef.
  const writes = save
    .split("changeGameLibrary((d, ctx) =>")
    .slice(1)
    .map((rest) => rest.slice(0, rest.indexOf(");")));
  assert.equal(writes.length, 6, `found ${writes.length} writes`);
  for (const w of writes) {
    assert.doesNotMatch(w, /toGameRef|game\)|games\.map/, w);
  }
  assert.match(save, /const ref = savableRef\(game\);\s*if \(!ref\) return <NotSavableYet \/>;/);
  assert.match(
    save,
    /const refs = games\.map\(savableRef\);\s*if \(refs\.some\(\(r\) => r === null\)\) return null;/,
  );
});

test("no other Discovery view writes to the Game Library", () => {
  const views = [
    "views/game-discovery.tsx",
    "views/game-discovery/browse-view.tsx",
    "views/game-discovery/game-card.tsx",
    "views/game-discovery/game-detail.tsx",
    "views/game-discovery/game-row.tsx",
    "views/game-discovery/games-hero.tsx",
    "views/game-discovery/franchise-view.tsx",
    "views/game-discovery/franchise-card.tsx",
  ];
  for (const path of views) {
    assert.doesNotMatch(src(path), /changeGameLibrary|game-library\/rules|toGameRef/, path);
  }
});

test("a saved RAWG game opened under IGDB shows its snapshot and makes no request", () => {
  const detail = src("views/game-discovery/game-detail.tsx");
  assert.match(
    detail,
    /providerOf\(gameId\) === gate\.provider \? \(\s*<GameDetailBody[\s\S]*?\) : \(\s*<OtherProviderGame gameId=\{gameId\} seed=\{seed\} \/>/,
  );
  const other = detail.slice(
    detail.indexOf("function OtherProviderGame"),
    detail.indexOf("function GameDetailBody"),
  );
  assert.doesNotMatch(
    other,
    /useGame(Detail|Related|Screenshots)|useDeveloperGames|useRefreshSavedGame/,
  );
});

test("kid profiles still can't open any Games frame", () => {
  const app = src("App.tsx");
  const block = app.slice(
    app.indexOf("if (!kid || player) return;"),
    app.indexOf('if (!allowed) setView("kids");'),
  );
  assert.ok(block.length > 0);
  assert.doesNotMatch(block, /game/);
});
