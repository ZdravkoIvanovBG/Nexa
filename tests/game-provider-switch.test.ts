// @ts-nocheck -- Node's test modules are not included in the application tsconfig.
// Stage 4, updated for Stage 7: the device's provider choice (IGDB by
// default, RAWG legacy only by explicit choice), the IGDB gate, cache
// isolation between providers, provider-dependent presentation, and the
// Stage 4/5/6 boundaries (no IGDB saves, no IGDB franchises). Pure modules and
// source-shape checks; no React, no Tauri, no network.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  LEGACY_DEV_PROVIDER_KEY,
  PROVIDER_CHOICE_KEY,
  createProviderChoiceStore,
  resolveGameProvider,
} from "../src/lib/game-discovery/provider-choice.ts";
import { providerPageUrl, safeExternalUrl } from "../src/lib/game-discovery/external-url.ts";
import { gameImage } from "../src/lib/game-discovery/game-image.ts";
import { gamesSearchAvailable, igdbConfigState } from "../src/lib/game-discovery/gates.ts";
import { createIgdbStatusStore } from "../src/lib/game-discovery/igdb-status.ts";
import { DEFAULT_GAME_PROVIDER, providerFeatures } from "../src/lib/game-discovery/provider.ts";
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
// Provider choice (Stage 7)

test("every build defaults to IGDB; only an explicit 'rawg' selects RAWG legacy", () => {
  assert.equal(DEFAULT_GAME_PROVIDER, "igdb");
  for (const junk of [null, undefined, "", "igdb", "IGDB", "RAWG", "rawg ", "steam", 1, true]) {
    assert.equal(resolveGameProvider(junk), "igdb", String(junk));
  }
  assert.equal(resolveGameProvider("rawg"), "rawg");
  assert.equal(createProviderChoiceStore(null).get(), "igdb", "no storage means IGDB");
  assert.equal(createProviderChoiceStore(memoryStorage()).get(), "igdb");
  assert.equal(
    createProviderChoiceStore(memoryStorage({ [PROVIDER_CHOICE_KEY]: "rawg" })).get(),
    "rawg",
  );
});

test("switching is explicit, persisted and announced once per change", () => {
  const storage = memoryStorage();
  const store = createProviderChoiceStore(storage);
  let heard = 0;
  store.subscribe(() => heard++);
  store.set("rawg");
  assert.equal(store.get(), "rawg");
  assert.equal(storage.data.get(PROVIDER_CHOICE_KEY), "rawg");
  store.set("rawg");
  store.set("igdb");
  assert.equal(heard, 2, "one notice per real change");
  assert.equal(storage.data.has(PROVIDER_CHOICE_KEY), false, "the default stores nothing");
  store.set("nonsense");
  assert.equal(store.get(), "igdb");
  assert.equal(heard, 2);
});

test("the Stage 4 development switch is retired: never read, removed on start", () => {
  // Under Stage 4 a missing dev key meant RAWG. It must not keep anyone on RAWG,
  // and its "igdb" value must not be needed to reach IGDB.
  for (const value of ["igdb", "rawg"]) {
    const storage = memoryStorage({ [LEGACY_DEV_PROVIDER_KEY]: value });
    assert.equal(createProviderChoiceStore(storage).get(), "igdb", value);
    assert.equal(storage.data.has(LEGACY_DEV_PROVIDER_KEY), false, value);
  }
});

test("existing RAWG settings never select RAWG by themselves", () => {
  // The choice reads one device key only; a synced RAWG key, gamesEnabled or
  // saved RAWG games can't change it, and nothing switches on a failure.
  const choice = code(src("lib/game-discovery/provider-choice.ts"));
  assert.doesNotMatch(choice, /rawgApiKey|gamesEnabled|settings|records|onError|catch \(e/);
  const active = code(src("lib/game-discovery/use-active-provider.ts"));
  assert.match(active, /gamesProviderChoice\.subscribe, gamesProviderChoice\.get/);
  // Only Settings → Games writes the choice.
  const writers = [
    "views/settings/games/provider-section.tsx",
    "views/game-discovery/games-frame.tsx",
    "views/game-discovery/games-state.tsx",
    "lib/game-discovery/use-games-gate.ts",
    "lib/game-discovery/queries.ts",
  ].filter((path) => /gamesProviderChoice\.set\(/.test(code(src(path))));
  assert.deepEqual(writers, ["views/settings/games/provider-section.tsx"]);
});

test("the choice key stays out of backups, cloud side-stores, settings and Supabase", () => {
  // Backups and side-stores sweep the `harbor.` namespace; the key is outside it.
  for (const key of [PROVIDER_CHOICE_KEY, LEGACY_DEV_PROVIDER_KEY]) {
    assert.ok(!key.startsWith("harbor."), key);
  }
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

test("Settings → Games offers the choice in every build, RAWG clearly labelled legacy", () => {
  const panel = code(src("views/settings/games-panel.tsx"));
  assert.doesNotMatch(panel, /import\.meta\.env\.DEV/);
  assert.match(panel, /<ProviderSection \/>/);
  assert.match(panel, /<IgdbSection \/>/);
  assert.match(panel, /<GamesToggleSection \/>/);
  // The RAWG key section stays reachable while RAWG is chosen or a key is stored.
  assert.match(panel, /provider === "rawg" \|\| settings\.rawgApiKey\.trim\(\) !== ""/);
  const section = src("views/settings/games/provider-section.tsx");
  assert.match(section, /"IGDB \(recommended\)"/);
  assert.match(section, /"RAWG \(legacy\)"/);
  assert.match(src("views/settings/games/rawg-section.tsx"), /t\("RAWG \(legacy\)"\)/);
});

test("unreadable or unwritable storage falls back to IGDB / this session", () => {
  const throwing = {
    getItem() {
      throw new Error("denied");
    },
    setItem() {
      throw new Error("full");
    },
    removeItem() {
      throw new Error("denied");
    },
  };
  const store = createProviderChoiceStore(throwing);
  assert.equal(store.get(), "igdb");
  store.set("rawg");
  assert.equal(store.get(), "rawg", "kept for the session");
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
  assert.equal(enabled.length, 9);
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

test("both providers get curated franchises; RAWG keeps its slug path and device cache", () => {
  assert.deepEqual(providerFeatures("rawg"), {
    franchises: true,
    librarySaves: true,
    cards: "landscape",
  });
  assert.deepEqual(providerFeatures("igdb"), {
    franchises: true,
    librarySaves: true,
    cards: "cover",
  });
  const discovery = src("views/game-discovery.tsx");
  assert.match(discovery, /const franchises = providerFeatures\(gate\.provider\)\.franchises;/);
  assert.match(discovery, /\{franchises && \(\s*<WhenNear/);
  const detail = src("views/game-discovery/game-detail.tsx");
  assert.match(
    detail,
    /const franchise = providerFeatures\(gate\.provider\)\.franchises \? franchiseOfGame\(game\) : null;/,
  );
  const queries = src("lib/game-discovery/queries.ts");
  // RAWG franchise art in the device cache is never read for another provider.
  assert.match(
    queries,
    /const perCard = !batched && providerFeatures\(provider\.id\)\.franchises && provider\.id === "rawg";/,
  );
  assert.match(queries, /const id = perCard \? \(def\?\.id \?\? ""\) : "";/);
});

// ---------------------------------------------------------------------------
// Stage 6: the Game Library

test("every Discovery write takes its ref from savableRef, resolved at write time", () => {
  const save = code(src("views/game-discovery/save-controls.tsx"));
  assert.match(
    save,
    /export function savableRef\(game: GameSummary\): GameRef \| null \{\s*return providerFeatures\(providerOf\(game\.id\)\)\.librarySaves \? toGameRef\(game\) : null;\s*\}/,
  );
  assert.equal((save.match(/toGameRef\(/g) ?? []).length, 1, "toGameRef only inside savableRef");
  // Every library change passes a ref that came from savableRef, and every
  // save checks it against the library as it is when the change runs.
  const writes = save
    .split("changeGameLibrary((d, ctx) =>")
    .slice(1)
    .map((rest) => rest.slice(0, rest.indexOf(");")));
  assert.equal(writes.length, 5, `found ${writes.length} writes`);
  for (const w of writes) {
    assert.doesNotMatch(w, /toGameRef|game\)|games\.map/, w);
    assert.match(w, /libraryRefs?\(d, (own|memberRefs|newRefs)\)|refreshSnapshot\(d, ref, ctx/, w);
  }
  assert.match(save, /const own = useMemo\(\(\) => savableRef\(game\), \[game\]\);/);
  assert.match(save, /if \(!canSave \|\| !own\) return null;/);
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
    /providerOf\(gameId\) === gate\.provider \? \(\s*<GameDetailBody[\s\S]*?\) : \(\s*<OtherProviderGame gameId=\{gameId\} seed=\{seed\} active=\{gate\.provider\} \/>/,
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

test("a failed first credential read explains itself instead of loading forever", () => {
  assert.equal(igdbConfigState(null, true), "igdb_checking");
  assert.equal(igdbConfigState(null, true, true), "igdb_unavailable");
  // A later failure keeps the last known status.
  assert.equal(igdbConfigState(status("verified"), true, true), "ready");
  assert.equal(igdbConfigState(null, false, true), "igdb_unsupported");
  assert.match(
    code(src("lib/game-discovery/use-games-gate.ts")),
    /igdbConfigState\(igdb\.status, igdbNativeAvailable, igdb\.failed\)/,
  );
});

test("the Games hero stops rotating while the window is minimised (Stage 7)", () => {
  // WebView2 keeps document.hidden false when minimised, so the hero also asks
  // the window. Measured in the release build: ~8.6% of one core before.
  const hero = code(src("views/game-discovery/games-hero.tsx"));
  assert.match(hero, /const minimized = useWindowMinimized\(\);/);
  assert.match(hero, /!pageVisible \|\| minimized \|\| slides\.length < 2\) return;/);
  const hook = code(src("lib/game-discovery/use-window-minimized.ts"));
  // The shell's existing focus event: no new window permission.
  // Raw source: code() strips the "//" inside the event name as a comment.
  assert.match(src("lib/game-discovery/use-window-minimized.ts"), /"harbor:\/\/window-activity"/);
  assert.match(hook, /setMinimized\(!e\.payload\.focused && e\.payload\.minimized\)/);
  assert.doesNotMatch(hook, /isMinimized|plugin:window/);
  // The Movies hero is untouched.
  assert.doesNotMatch(src("components/cinema-hero.tsx"), /useWindowMinimized/);
});

test("off-screen Games placeholders don't animate while waiting (Stage 7)", () => {
  // WhenNear's fallback is never on screen; its pulsing skeletons cost ~4.7% of
  // one core idle in the release build. The real row keeps its own skeleton.
  const near = src("views/game-discovery/when-near.tsx");
  assert.match(near, /aria-hidden className="\[&_\*\]:animate-none"/);
  assert.match(src("views/game-discovery/game-card.tsx"), /animate-pulse/);
});
