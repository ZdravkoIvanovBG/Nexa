// @ts-nocheck -- Node's test modules are not included in the application tsconfig.
// Source-shape checks for the Stage 1 IGDB proof of concept: it must stay out
// of the app, keep credential handling in server/, and never use RAWG ids.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(ROOT, "src");
const IGDB = join(SRC, "lib", "providers", "igdb");

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name)) out.push(path);
  }
  return out;
}

const rel = (path) => relative(ROOT, path).split(sep).join("/");
const importsOf = (source) =>
  [
    ...source.matchAll(
      /(?:import|export)[^"'`]*?from\s*["'`]([^"'`]+)["'`]|import\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
    ),
  ].map((m) => m[1] ?? m[2]);

test("nothing in the app imports the IGDB proof of concept", () => {
  const offenders = [];
  for (const file of walk(SRC)) {
    if (file.startsWith(IGDB + sep)) continue;
    for (const spec of importsOf(readFileSync(file, "utf8"))) {
      if (/(^|\/)providers\/igdb(\/|$)/.test(spec) || /(^|\/)igdb\//.test(spec)) {
        offenders.push(`${rel(file)} -> ${spec}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test("credential-handling modules live in server/ and only server/ imports them", () => {
  const offenders = [];
  for (const file of walk(IGDB)) {
    if (file.includes(`${sep}server${sep}`)) continue;
    const source = readFileSync(file, "utf8");
    for (const spec of importsOf(source)) {
      if (spec.includes("server/")) offenders.push(`${rel(file)} -> ${spec}`);
    }
    for (const word of ["client_secret", "clientSecret", "Authorization", "Client-ID", "oauth2"]) {
      if (source.includes(word)) offenders.push(`${rel(file)} mentions ${word}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("IGDB modules never use RAWG ids and never log", () => {
  const offenders = [];
  for (const file of walk(IGDB)) {
    const source = readFileSync(file, "utf8").replace(/\/\/.*$/gm, "");
    if (/rawgId|rawg:/i.test(source)) offenders.push(`${rel(file)} uses a RAWG id`);
    if (/\bconsole\./.test(source)) offenders.push(`${rel(file)} logs`);
  }
  assert.deepEqual(offenders, []);
});

test("the dev check script never prints credentials or tokens", () => {
  const source = readFileSync(join(ROOT, "scripts", "igdb-dev-check.mjs"), "utf8");
  const logLines = source
    .split("\n")
    .filter((line) => /console\.(log|error|warn|info)|\blog\(/.test(line));
  assert.ok(logLines.length > 10, "expected to find the script's output lines");
  for (const line of logLines) {
    assert.ok(
      !/process\.env|clientSecret|getToken|access_token|Authorization|Bearer/i.test(line),
      line,
    );
  }
  assert.ok(
    !/writeFileSync|appendFileSync|createWriteStream|writeFile\(/.test(source),
    "no file output",
  );
  assert.ok(!/stack|\.cause/.test(source), "never prints raw errors");
});
