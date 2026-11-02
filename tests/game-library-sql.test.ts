// @ts-nocheck -- Node's test modules are not included in the application tsconfig.
// Postgres isn't available in CI, so these guard what can drift silently: the
// columns the client writes, and the cases the validation script runs.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { entryToRow, recordToRow } from "../src/lib/game-library/cloud/rows.ts";
import { newRecord } from "../src/lib/game-library/rules.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const MIGRATION = read("supabase/migrations/20261102120000_game_library.sql");
const ROLLBACK = read("supabase/rollback/20261102120000_game_library_down.sql");
const CHECKS = read("supabase/tests/game_library_checks.sql");
const PREFLIGHT = read("supabase/tests/game_library_preflight.sql");

const withoutComments = (sql) => sql.replace(/--.*$/gm, "");

function columnsOf(table) {
  const body = new RegExp(`create table public\\.${table} \\(([\\s\\S]*?)\\n\\);`).exec(
    withoutComments(MIGRATION),
  )?.[1];
  assert.ok(body, `create table ${table}`);
  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("primary key"))
    .flatMap((line) => line.split(/,\s+(?=[a-z_]+ (?:text|bigint|jsonb|uuid|boolean|smallint))/))
    .map((part) => part.split(/\s+/)[0]);
}

const owner = { userId: "u", profileId: "p" };
const record = newRecord(
  { provider: "rawg", rawgId: 1, slug: "s", name: "n", released: null, image: null },
  1,
);
const entry = {
  entryId: "e",
  parentId: "",
  kind: "game",
  gameId: "rawg:1",
  franchiseId: null,
  title: "",
  image: null,
  catalogSeen: [],
  position: "U",
  addedAt: 0,
  updatedAt: 0,
  deletedAt: null,
};

test("the client writes exactly the columns game_library has", () => {
  assert.deepEqual(
    Object.keys(recordToRow(owner, record)).sort(),
    columnsOf("game_library").sort(),
  );
});

test("the client writes exactly the columns game_queue has", () => {
  assert.deepEqual(Object.keys(entryToRow(owner, entry)).sort(), columnsOf("game_queue").sort());
});

test("every mapper writes every column, so a batch can't blank stored fields", () => {
  for (const row of [recordToRow(owner, record), entryToRow(owner, entry)]) {
    for (const [column, value] of Object.entries(row)) {
      assert.notEqual(value, undefined, column);
    }
  }
});

test("the migration only creates its own objects", () => {
  const sql = withoutComments(MIGRATION);
  const touched = [
    ...sql.matchAll(
      /\b(?:create table|alter table|drop table|on|from|table|function|update on)\s+public\.([a-z_]+)/g,
    ),
  ].map((m) => m[1]);
  const own = new Set([
    "game_library",
    "game_queue",
    "game_library_merge",
    "game_queue_keep_newest",
  ]);
  assert.ok(touched.length > 10);
  assert.deepEqual(
    [...new Set(touched)].filter((name) => !own.has(name)),
    [],
  );
  assert.doesNotMatch(sql, /\b(drop|truncate|delete from|insert into|update public)\b/i);
});

test("every table has RLS and all four policies", () => {
  for (const table of ["game_library", "game_queue"]) {
    assert.match(MIGRATION, new RegExp(`alter table public\\.${table} enable row level security`));
    for (const command of ["select", "insert", "update", "delete"]) {
      assert.match(
        MIGRATION,
        new RegExp(
          `"${table}_${command}_own" on public\\.${table}\\s+for ${command} to authenticated`,
        ),
      );
    }
    assert.match(MIGRATION, new RegExp(`revoke all on table public\\.${table} from public, anon`));
  }
  assert.doesNotMatch(MIGRATION, /security definer/i);
});

test("the migration runs as one transaction", () => {
  const sql = withoutComments(MIGRATION).trim();
  assert.match(sql, /^begin;/);
  assert.match(sql, /commit;\s+notify pgrst, 'reload schema';$/);
});

test("the trigger keeps every column of each field group", () => {
  const groups = {
    state_at: ["status", "started_at", "completed_at", "progress_enabled", "progress"],
    notes_at: ["notes"],
    tier_at: ["tier", "tier_position"],
  };
  for (const [stamp, fields] of Object.entries(groups)) {
    assert.match(MIGRATION, new RegExp(`if new\\.${stamp} < old\\.${stamp} then`));
    for (const field of [...fields, stamp]) {
      assert.match(MIGRATION, new RegExp(`new\\.${field} := old\\.${field};`), field);
    }
  }
});

test("the validation script runs the same merge cases as the unit tests", () => {
  const snake = (key) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
  const toColumns = (value) =>
    Object.fromEntries(Object.entries(value).map(([k, v]) => [snake(k), v]));
  const fixture = JSON.parse(read("tests/fixtures/game-merge-cases.json"));
  const expected = Object.fromEntries(
    Object.entries(fixture).map(([group, list]) => [
      group,
      list.map((c) => ({
        name: c.name,
        stored: toColumns(c.stored),
        incoming: toColumns(c.incoming),
        expected: toColumns(c.expected),
      })),
    ]),
  );
  const embedded = /\$cases\$([\s\S]*?)\$cases\$/.exec(CHECKS)?.[1];
  assert.ok(embedded);
  assert.deepEqual(JSON.parse(embedded), expected);
});

test("the validation script can't leave anything behind", () => {
  assert.match(CHECKS, /raise exception using errcode = 'GL000'/);
  assert.match(CHECKS, /exception when sqlstate 'GL000' then/);
  assert.match(CHECKS, /create function pg_temp\.game_library_checks\(\)/);
  assert.doesNotMatch(withoutComments(CHECKS), /\bcommit\b/i);
});

test("the pre-flight script only reads", () => {
  const sql = withoutComments(PREFLIGHT).replace(/'[^']*'/g, "''");
  assert.doesNotMatch(sql, /\b(create|alter|drop|insert|update|delete|truncate|grant|revoke)\b/i);
});

test("the rollback touches only the game objects", () => {
  const sql = withoutComments(ROLLBACK);
  const drops = [...sql.matchAll(/drop (?:table|function) if exists public\.([a-z_]+)/g)].map(
    (m) => m[1],
  );
  assert.deepEqual(drops.sort(), [
    "game_library",
    "game_library_merge",
    "game_queue",
    "game_queue_keep_newest",
  ]);
  assert.doesNotMatch(sql, /\bcascade\b/i);
  assert.equal((sql.match(/\bdrop\b/gi) ?? []).length, 4);
});

test("the rollback lives outside the migrations folder, so no tool can run it by accident", () => {
  const inMigrations = new URL(
    "../supabase/migrations/20261102120000_game_library_down.sql",
    import.meta.url,
  );
  assert.equal(existsSync(inMigrations), false);
});
