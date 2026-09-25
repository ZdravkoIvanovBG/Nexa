// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  version: string;
};
const tauriConf = JSON.parse(
  readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
) as { version: string };
const cargoToml = readFileSync(new URL("../src-tauri/Cargo.toml", import.meta.url), "utf8");

test("tauri.conf.json defers its version to package.json, the single release authority", () => {
  assert.equal(
    tauriConf.version,
    "../package.json",
    'src-tauri/tauri.conf.json "version" must stay "../package.json" so the bundle, ' +
      "app.package_info(), getVersion(), and the published latest.json all follow package.json " +
      "instead of drifting from it.",
  );
});

test("src-tauri/Cargo.toml version matches package.json (the release authority)", () => {
  const match = cargoToml.match(/^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m);
  assert.ok(match, "src-tauri/Cargo.toml must declare a [package] version");
  assert.equal(
    match?.[1],
    pkg.version,
    `src-tauri/Cargo.toml version (${match?.[1]}) must match package.json version ` +
      `(${pkg.version}). Cargo.toml can't reference package.json directly, so bump it by hand ` +
      "whenever package.json's version changes.",
  );
});
