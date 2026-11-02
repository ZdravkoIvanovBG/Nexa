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
const VERIFY = read("supabase/tests/game_library_verify.sql");
const README = read("supabase/README.md");

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
  liveAt: 0,
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
  const own = new Set(["game_library", "game_queue", "game_library_merge", "game_queue_merge"]);
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

/** The columns a trigger block restores when its stamp is older, keyed by stamp. */
function triggerGroups() {
  const groups = {};
  for (const block of MIGRATION.matchAll(/if new\.(\w+) < old\.\1 then([\s\S]*?)end if;/g)) {
    groups[block[1]] = [...block[2].matchAll(/new\.(\w+) := old\.\1;/g)].map((m) => m[1]);
  }
  return groups;
}

test("every column of both tables is covered by exactly one trigger group", () => {
  const groups = triggerGroups();
  assert.deepEqual(Object.keys(groups).sort(), [
    "live_at",
    "meta_at",
    "notes_at",
    "progress_at",
    "state_at",
    "tier_at",
    "updated_at",
  ]);
  for (const [table, stamps, exempt] of [
    [
      "game_library",
      ["meta_at", "state_at", "progress_at", "notes_at", "tier_at"],
      ["user_id", "profile_id", "game_id", "created_at"],
    ],
    ["game_queue", ["updated_at", "live_at"], ["user_id", "profile_id", "entry_id"]],
  ]) {
    const covered = stamps.flatMap((stamp) => groups[stamp]);
    assert.equal(new Set(covered).size, covered.length, `${table}: a column is in two groups`);
    const expected = columnsOf(table).filter((column) => !exempt.includes(column));
    assert.deepEqual([...covered].sort(), expected.sort(), table);
  }
});

test("the merge groups match the client's", () => {
  const groups = triggerGroups();
  const merge = read("src/lib/game-library/merge.ts");
  const camel = (column) => column.replace(/_(\w)/g, (_, c) => c.toUpperCase());
  for (const stamp of ["meta_at", "state_at", "progress_at", "notes_at", "tier_at"]) {
    const fields = groups[stamp].map((column) => `"${camel(column)}"`).join(", ");
    assert.ok(merge.includes(`stamp: "${camel(stamp)}", fields: [${fields}]`), stamp);
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
  assert.match(CHECKS, /create or replace function pg_temp\.game_library_checks\(\)/);
  assert.doesNotMatch(withoutComments(CHECKS), /\bcommit\b/i);
});

test("the validation script refuses to run where accounts already exist", () => {
  const body = withoutComments(CHECKS);
  const guard = body.indexOf("if exists (select 1 from auth.users) then");
  const firstWrite = body.indexOf("insert into auth.users");
  assert.ok(guard > 0, "guard present");
  assert.ok(guard < firstWrite, "guard runs before anything is written");
  assert.ok(
    guard < body.indexOf("begin\n    --") ||
      guard < body.lastIndexOf("raise exception using errcode"),
  );
});

test("each script ends in a single result, the only one the SQL Editor shows", () => {
  assert.match(withoutComments(CHECKS).trim(), /select \* from pg_temp\.game_library_checks\(\);$/);
  for (const script of [PREFLIGHT, VERIFY]) {
    const sql = withoutComments(script).trim();
    assert.equal((sql.match(/;/g) ?? []).length, 1, "one statement");
    assert.ok(sql.endsWith(";"));
  }
});

test("the pre-flight and verify scripts only read", () => {
  for (const script of [PREFLIGHT, VERIFY]) {
    const sql = withoutComments(script).replace(/'[^']*'/g, "''");
    assert.doesNotMatch(sql, /\b(create|alter|drop|insert|delete|truncate|grant|revoke)\b/i);
    assert.doesNotMatch(sql, /\bupdate\s+(?!''|public\.)/i);
    assert.match(sql.trim(), /^with\b/);
  }
});

test("the existing schema fingerprint is computed identically before and after", () => {
  const block = (sql) => /with existing_schema \(line\) as \(([\s\S]*?)\n\),/.exec(sql)?.[1];
  assert.ok(block(PREFLIGHT));
  assert.equal(block(VERIFY), block(PREFLIGHT));
});

test("verify checks the exact columns the migration creates, in order", () => {
  const listed = (table) => {
    const literal = new RegExp(`where table_name = '${table}'\\) =\\s+((?:'[^']*'\\s*)+)then`).exec(
      VERIFY,
    )?.[1];
    assert.ok(literal, table);
    return [...literal.matchAll(/'([^']*)'/g)]
      .map((m) => m[1])
      .join("")
      .split(", ")
      .map((column) => column.split(" ")[0]);
  };
  assert.deepEqual(listed("game_library"), columnsOf("game_library"));
  assert.deepEqual(listed("game_queue"), columnsOf("game_queue"));
});

test("the README lists every script, and each file it names exists", () => {
  const listed = [...README.matchAll(/`((?:tests|migrations|rollback)\/[^`]+)`/g)].map((m) => m[1]);
  assert.equal(new Set(listed).size, 5);
  for (const path of listed) {
    assert.ok(existsSync(new URL(`../supabase/${path}`, import.meta.url)), path);
  }
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
    "game_queue_merge",
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
