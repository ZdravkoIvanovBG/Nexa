// @ts-nocheck -- Node's test modules are not included in the application tsconfig.
// Where IGDB credentials may and may not go (Stage 3), and where IGDB requests
// may start (Stage 4). Source-shape checks plus the pure gate helpers; no Tauri,
// no network, no OS credential store.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { activeProviderReady, gamesToggleAllowed } from "../src/lib/game-discovery/gates.ts";
import { PRODUCTION_GAME_PROVIDER } from "../src/lib/game-discovery/provider.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(ROOT, path), "utf8");
const rel = (path) => relative(ROOT, path).split(sep).join("/");
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

function walk(dir, pattern = /\.(ts|tsx|js|jsx|mjs|rs)$/) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path, pattern));
    else if (pattern.test(name)) out.push(path);
  }
  return out;
}

test("settings, cloud sync and backups know nothing about IGDB credentials", () => {
  const offenders = [];
  const files = [
    ...walk(join(ROOT, "src/lib/settings")),
    ...walk(join(ROOT, "src/lib/cloud")),
    join(ROOT, "src/lib/backup.ts"),
    join(ROOT, "src-tauri/src/settings_store.rs"),
  ];
  for (const file of files) {
    if (/igdb|twitch/i.test(readFileSync(file, "utf8"))) offenders.push(rel(file));
  }
  // The Game Library may hold igdb: game ids, never credentials.
  for (const file of walk(join(ROOT, "src/lib/game-library"))) {
    if (/twitch|client_?secret|clientId|access_?token/i.test(readFileSync(file, "utf8"))) {
      offenders.push(rel(file));
    }
  }
  assert.deepEqual(offenders, []);
});

test("the settings section keeps the secret in component state only", () => {
  const source = code(read("src/views/settings/games/igdb-section.tsx"));
  for (const forbidden of [
    /localStorage/,
    /sessionStorage/,
    /indexedDB/,
    /useSettings/,
    /\bupdate\(/,
    /\bconsole\.(log|info|warn|error|debug)\(/,
    /<form\b/,
    /\bname=/,
  ]) {
    assert.ok(!forbidden.test(source), `igdb-section uses ${forbidden}`);
  }
  // The secret input is masked, has no reveal toggle, and opts out of autofill.
  assert.match(source, /type=\{secret \? "password" : "text"\}/);
  assert.match(source, /autoComplete=\{secret \? "new-password" : "off"\}/);
  assert.ok(!/setReveal|reveal/.test(source));
  // It's cleared after a successful save and after a rejection.
  assert.equal((source.match(/setSecret\(""\)/g) ?? []).length >= 3, true);
});

test("credentials are device-local: no profile or account input anywhere", () => {
  for (const path of [
    "src/lib/game-discovery/igdb-native.ts",
    "src/lib/providers/igdb/native.ts",
    "src/views/settings/games/igdb-section.tsx",
  ]) {
    const source = code(read(path));
    assert.ok(
      !/profiles|useActiveProfile|activeProfile|profileId|useAuth|supabase|userId/.test(source),
      `${path} depends on the active profile or account`,
    );
  }
  const commands = read("src-tauri/src/igdb/commands.rs");
  assert.ok(!/profile|user_id|account/i.test(commands.replace(/\/\/.*$/gm, "")));
});

test("only igdb_set_credentials accepts the secret, and nothing returns it", () => {
  const commands = read("src-tauri/src/igdb/commands.rs");
  const fns = [
    ...commands.matchAll(/#\[tauri::command\]\s*pub async fn (\w+)\(([^)]*)\)\s*->\s*([^{]+)\{/g),
  ];
  assert.deepEqual(
    fns.map((m) => m[1]),
    [
      "igdb_status",
      "igdb_set_credentials",
      "igdb_verify_credentials",
      "igdb_clear_credentials",
      "igdb_query",
    ],
  );
  for (const [, name, params, returns] of fns) {
    assert.equal(/secret/i.test(params), name === "igdb_set_credentials", `${name} params`);
    assert.ok(!/Secret|String|token/i.test(returns), `${name} returns ${returns.trim()}`);
  }
});

test("the Rust IGDB module never logs, writes files or touches settings", () => {
  const offenders = [];
  for (const file of walk(join(ROOT, "src-tauri/src/igdb"))) {
    const source = readFileSync(file, "utf8");
    const code = rel(file).endsWith("/tests.rs")
      ? source
      : source.replace(/#\[cfg\(test\)\][\s\S]*$/, "");
    if (/eprintln!|\blog::|tracing::|dbg!|std::fs|app_data_dir|settings_store/.test(code)) {
      offenders.push(`${rel(file)} logs or writes`);
    }
    if (!rel(file).endsWith("/tests.rs") && /println!/.test(code))
      offenders.push(`${rel(file)} prints`);
  }
  assert.deepEqual(offenders, []);
  // The live test prints only counts and public ids.
  const live = read("src-tauri/src/igdb/tests.rs")
    .split(/\r?\n/)
    .filter((line) => /println!/.test(line));
  assert.ok(live.length >= 5);
  for (const line of live) assert.ok(!/expose|\{sec|\{id\}|bearer|access_token/i.test(line), line);
});

test("lib.rs only registers the commands; nothing runs at startup", () => {
  const lib = read("src-tauri/src/lib.rs");
  const mentions = lib
    .split(/\r?\n/)
    .filter((line) => /igdb/.test(line))
    .map((l) => l.trim());
  assert.deepEqual(mentions, [
    "mod igdb;",
    ".manage(igdb::production_state());",
    "igdb::commands::igdb_status,",
    "igdb::commands::igdb_set_credentials,",
    "igdb::commands::igdb_verify_credentials,",
    "igdb::commands::igdb_clear_credentials,",
    "igdb::commands::igdb_query,",
  ]);
});

test("only the Games IGDB wiring creates an IGDB client (Stage 4)", () => {
  const offenders = [];
  for (const file of walk(join(ROOT, "src"))) {
    if (rel(file).startsWith("src/lib/providers/igdb/")) continue;
    if (rel(file) === "src/lib/game-discovery/igdb-discovery.ts") continue;
    if (
      /igdb_query|createNativeIgdbClient|createTauriTransport|createIgdbClient|createIgdbProvider/.test(
        readFileSync(file, "utf8"),
      )
    ) {
      offenders.push(rel(file));
    }
  }
  assert.deepEqual(offenders, []);
  // That wiring is loaded only by the Games query hooks (the lazy Games views).
  const importers = walk(join(ROOT, "src"))
    .filter((file) =>
      /from "\.\/igdb-discovery"|game-discovery\/igdb-discovery/.test(readFileSync(file, "utf8")),
    )
    .map(rel);
  assert.deepEqual(importers, ["src/lib/game-discovery/queries.ts"]);
});

test("production builds use RAWG; only the active provider's readiness counts", () => {
  assert.equal(PRODUCTION_GAME_PROVIDER, "rawg");
  assert.equal(activeProviderReady(PRODUCTION_GAME_PROVIDER, { rawg: false, igdb: true }), false);
  assert.equal(activeProviderReady(PRODUCTION_GAME_PROVIDER, { rawg: true, igdb: false }), true);
  assert.equal(activeProviderReady("igdb", { rawg: false, igdb: true }), true);
  assert.equal(activeProviderReady("igdb", { rawg: true, igdb: false }), false);
  // The RAWG toggle rule is unchanged; IGDB uses the same rule on its own readiness.
  const gates = read("src/lib/game-discovery/gates.ts");
  assert.match(
    gates,
    /return gamesFeatureEnabled\(settings\) \|\| rawgReady\(settings, isRejected\);/,
  );
  assert.equal(gamesToggleAllowed(false, true), true);
  assert.equal(gamesToggleAllowed(false, false), false);
  assert.equal(gamesToggleAllowed(true, false), true, "turning Games off is always allowed");
  // The dev switch reads import.meta.env.DEV and nothing else turns IGDB on.
  const native = code(read("src/lib/game-discovery/igdb-native.ts"));
  assert.match(native, /dev: import\.meta\.env\.DEV,/);
  assert.match(native, /storage: import\.meta\.env\.DEV \? devStorage\(\) : null,/);
  const panel = code(read("src/views/settings/games-panel.tsx"));
  assert.match(panel, /\{import\.meta\.env\.DEV && <DevProviderSection \/>\}/);
});

test("the local credentials file is never committed", () => {
  // Exits non-zero (and throws) when the path is not ignored.
  execFileSync("git", ["check-ignore", "-q", ".env.igdb.local"], { cwd: ROOT, stdio: "ignore" });
  const tracked = execFileSync("git", ["ls-files", "--", ".env*"], { cwd: ROOT, encoding: "utf8" });
  assert.ok(!/\.env\.igdb/.test(tracked));
});
