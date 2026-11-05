// @ts-nocheck -- Node's test modules are not included in the application tsconfig.
// Stage 2 regression tests: provider-qualified game ids, and proof that saved
// RAWG data reads, writes, syncs and merges exactly as it did before.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  gameIdOf,
  isGameId,
  parseGameId,
  providerOf,
  rawgIdOf,
} from "../src/lib/game-discovery/game-id.ts";
import { gameIdOfRef, toGameRef } from "../src/lib/game-discovery/types.ts";
import { parseLibraryBlob, serializeLibraryBlob } from "../src/lib/game-library/backup-state.ts";
import {
  entryToRow,
  recordToRow,
  rowToEntry,
  rowToRecord,
} from "../src/lib/game-library/cloud/rows.ts";
import { mergeLibrary } from "../src/lib/game-library/merge.ts";
import { addMember, saveCollection, saveGame } from "../src/lib/game-library/rules.ts";
import {
  sanitizeEntry,
  sanitizeLibrary,
  sanitizeRecord,
} from "../src/lib/game-library/sanitize.ts";
import { snapshotSummary } from "../src/lib/game-library/snapshot.ts";
import {
  collectionEntryId,
  gameIdFor,
  memberEntryId,
  rootEntryId,
} from "../src/lib/game-library/types.ts";

const LEGACY = readFileSync(
  new URL("./fixtures/game-library-legacy-blob.json", import.meta.url),
  "utf8",
);
const OWNER = { userId: "00000000-0000-0000-0000-000000000001", profileId: "p1" };
const ctx = { now: 1_762_400_000_000, random: () => 0.5 };

const rawgRef = (n, name = `Game ${n}`) => ({
  provider: "rawg",
  rawgId: n,
  slug: `game-${n}`,
  name,
  released: "2020-01-01",
  image: null,
});
const igdbRef = (n, name = `IGDB ${n}`) => ({
  provider: "igdb",
  igdbId: n,
  slug: `igdb-${n}`,
  name,
  released: "2020-01-01",
  image: null,
});

// ── 1. existing RAWG ids are unchanged ─────────────────────────────────────

test("RAWG ids and every id derived from them are spelled exactly as before", () => {
  assert.equal(gameIdFor(3328), "rawg:3328");
  assert.equal(gameIdOf("rawg", 3328), "rawg:3328");
  assert.equal(gameIdOfRef(rawgRef(3328)), "rawg:3328");
  assert.equal(rootEntryId("rawg:3328"), "g:rawg:3328");
  assert.equal(collectionEntryId("the-witcher"), "c:the-witcher");
  assert.equal(memberEntryId("c:the-witcher", "rawg:3328"), "c:the-witcher|rawg:3328");
});

test("a RAWG snapshot reference has exactly the pre-provider shape", () => {
  const ref = toGameRef({
    id: "rawg:3328",
    slug: "the-witcher-3-wild-hunt",
    name: "The Witcher 3",
    released: "2015-05-18",
    image: "https://media.rawg.io/x.jpg",
  });
  assert.equal(
    JSON.stringify(ref),
    JSON.stringify({
      provider: "rawg",
      rawgId: 3328,
      slug: "the-witcher-3-wild-hunt",
      name: "The Witcher 3",
      released: "2015-05-18",
      image: "https://media.rawg.io/x.jpg",
    }),
  );
});

// ── 2. RAWG and IGDB ids never collide ─────────────────────────────────────

test("the same number from two providers is two different games", () => {
  const rawg = gameIdOf("rawg", 1942);
  const igdb = gameIdOf("igdb", 1942);
  assert.notEqual(rawg, igdb);
  assert.equal(providerOf(rawg), "rawg");
  assert.equal(providerOf(igdb), "igdb");
  assert.equal(rawgIdOf(igdb), null, "an IGDB id never yields a RAWG number");
  assert.notEqual(rootEntryId(rawg), rootEntryId(igdb));
  assert.notEqual(memberEntryId("c:x", rawg), memberEntryId("c:x", igdb));

  let data = { records: {}, queue: {} };
  for (const ref of [rawgRef(1942), igdbRef(1942)]) {
    const patch = saveGame(data, ref, ctx);
    data = {
      records: { ...data.records, ...Object.fromEntries(patch.records.map((r) => [r.gameId, r])) },
      queue: { ...data.queue, ...Object.fromEntries(patch.queue.map((e) => [e.entryId, e])) },
    };
  }
  assert.deepEqual(Object.keys(data.records).sort(), ["igdb:1942", "rawg:1942"]);
  assert.deepEqual(Object.keys(data.queue).sort(), ["g:igdb:1942", "g:rawg:1942"]);
  assert.equal(data.records["rawg:1942"].rawgId, 1942);
  assert.equal(data.records["igdb:1942"].igdbId, 1942);
  assert.ok(!("rawgId" in data.records["igdb:1942"]), "an IGDB record never carries a rawgId");
  assert.ok(!("igdbId" in data.records["rawg:1942"]));
});

test("an IGDB record reads back with IGDB fields rebuilt from its id", () => {
  const record = sanitizeRecord({
    gameId: "igdb:1942",
    provider: "rawg",
    rawgId: 5,
    name: "X",
    slug: "x",
  });
  assert.equal(record.provider, "igdb", "provider fields always come from the id");
  assert.equal(record.igdbId, 1942);
  assert.ok(!("rawgId" in record));
  assert.equal(snapshotSummary(record).id, "igdb:1942");
});

test("a RAWG record can't be relabelled by stray provider fields", () => {
  const record = sanitizeRecord({ gameId: "rawg:7", provider: "igdb", igdbId: 99, rawgId: 8 });
  assert.equal(record.provider, "rawg");
  assert.equal(record.rawgId, 7);
  assert.ok(!("igdbId" in record));
});

// ── 3. malformed ids are rejected ──────────────────────────────────────────

const BAD_IDS = [
  "rawg:0",
  "rawg:01",
  "rawg:-1",
  "rawg:+1",
  "rawg:1.5",
  "rawg:1e3",
  "rawg: 1",
  " rawg:1",
  "rawg:1 ",
  "RAWG:1",
  "Rawg:1",
  "steam:1",
  "igdb:",
  ":1",
  "rawg:",
  "rawg",
  "igdb:1:2",
  "rawg:１",
  "rawg:9007199254740993",
  "rawg:12345678901234567",
  "",
  1942,
  null,
  undefined,
  {},
  ["rawg:1"],
];

test("parseGameId accepts only the canonical spelling of a positive safe integer", () => {
  for (const bad of BAD_IDS) {
    assert.equal(parseGameId(bad), null, JSON.stringify(bad));
    assert.equal(isGameId(bad), false, JSON.stringify(bad));
  }
  assert.deepEqual(parseGameId("rawg:1"), { provider: "rawg", providerId: 1 });
  assert.deepEqual(parseGameId("igdb:119171"), { provider: "igdb", providerId: 119171 });
  assert.deepEqual(parseGameId("rawg:9007199254740991"), {
    provider: "rawg",
    providerId: 9007199254740991,
  });
});

test("gameIdOf refuses invalid numbers and unknown providers", () => {
  for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, "1"]) {
    assert.throws(() => gameIdOf("rawg", bad), RangeError, String(bad));
  }
  assert.throws(() => gameIdOf("steam", 1), RangeError);
});

test("records and game entries with malformed ids are dropped on read", () => {
  for (const bad of BAD_IDS) {
    assert.equal(sanitizeRecord({ gameId: bad, name: "x" }), null, JSON.stringify(bad));
    assert.equal(
      sanitizeEntry({ entryId: "g:x", kind: "game", gameId: bad, position: "a0" }),
      null,
      JSON.stringify(bad),
    );
  }
  // A collection row has no game id, and an invalid one is ignored rather than kept.
  const collection = sanitizeEntry({ entryId: "c:x", kind: "collection", gameId: "rawg:01" });
  assert.equal(collection.gameId, null);
});

// ── 6. saved Wishlist records and collections survive deserialization ──────

test("a pre-Stage-2 library blob reads and writes back byte for byte", () => {
  const blob = parseLibraryBlob(LEGACY);
  assert.equal(serializeLibraryBlob(blob), JSON.stringify(JSON.parse(LEGACY)));
});

test("a pre-Stage-2 blob keeps order, membership, notes, progress, status and tier", () => {
  const { records, queue, unsynced } = parseLibraryBlob(LEGACY);
  assert.equal(unsynced, true);
  assert.deepEqual(Object.keys(records), ["rawg:3328", "rawg:58175", "rawg:4291"]);
  assert.equal(records["rawg:3328"].notes, "Velen done. Next: Novigrad.");
  assert.equal(records["rawg:3328"].progress, 40);
  assert.equal(records["rawg:3328"].status, "playing");
  assert.equal(records["rawg:58175"].tier, "S");
  assert.equal(records["rawg:58175"].tierPosition, "a0");
  assert.equal(queue["c:the-witcher|rawg:3328"].parentId, "c:the-witcher");
  assert.deepEqual(
    Object.values(queue)
      .filter((e) => e.parentId === "" && e.deletedAt === null)
      .sort((a, b) => (a.position < b.position ? -1 : 1))
      .map((e) => e.entryId),
    ["c:the-witcher", "g:rawg:4291"],
  );
  assert.equal(queue["g:rawg:58175"].deletedAt, 1762100000000, "soft deletes are kept");
  assert.deepEqual(queue["c:the-witcher"].catalogSeen.length, 4);
});

test("saving again or adding a member never duplicates a legacy RAWG entry", () => {
  const data = parseLibraryBlob(LEGACY);
  assert.deepEqual(saveGame(data, rawgRef(4291, "Counter-Strike"), ctx), {
    records: [],
    queue: [],
  });
  assert.deepEqual(addMember(data, "c:the-witcher", rawgRef(3328), ctx), {
    records: [],
    queue: [],
  });
  assert.deepEqual(
    saveCollection(
      data,
      { franchiseId: "the-witcher", title: "The Witcher", image: null },
      [rawgRef(3328)],
      [],
      ctx,
    ),
    { records: [], queue: [] },
  );
});

// ── 7. cloud rows and merging preserve existing records ────────────────────

test("cloud rows round-trip legacy RAWG records and entries unchanged", () => {
  const { records, queue } = parseLibraryBlob(LEGACY);
  for (const record of Object.values(records)) {
    const row = recordToRow(OWNER, record);
    assert.equal(row.game_id, record.gameId, "game_id is the same text as before");
    assert.equal(JSON.stringify(rowToRecord(row)), JSON.stringify(record));
  }
  for (const entry of Object.values(queue)) {
    const row = entryToRow(OWNER, entry);
    assert.equal(row.entry_id, entry.entryId);
    assert.equal(JSON.stringify(rowToEntry(row)), JSON.stringify(entry));
  }
});

test("cloud rows round-trip an IGDB record without touching RAWG fields", () => {
  const igdb = sanitizeRecord({
    gameId: "igdb:119171",
    name: "Baldur's Gate III",
    slug: "baldurs-gate-iii",
  });
  const back = rowToRecord(recordToRow(OWNER, igdb));
  assert.deepEqual(back, igdb);
  assert.equal(back.igdbId, 119171);
});

test("merging a legacy library with itself changes nothing and uploads nothing", () => {
  const local = sanitizeLibrary(JSON.parse(LEGACY));
  const remote = sanitizeLibrary(JSON.parse(LEGACY));
  const result = mergeLibrary(local, remote, ctx.now);
  assert.equal(result.changed, false);
  assert.deepEqual(result.uploads, { records: [], queue: [] });
  assert.equal(JSON.stringify(result.data), JSON.stringify(local));
});

test("merge keeps a rawg: and an igdb: record with the same number apart", () => {
  const local = sanitizeLibrary({ records: { a: { gameId: "rawg:5", name: "Old", metaAt: 1 } } });
  const remote = sanitizeLibrary({ records: { b: { gameId: "igdb:5", name: "New", metaAt: 2 } } });
  const { data } = mergeLibrary(local, remote, ctx.now);
  assert.deepEqual(Object.keys(data.records).sort(), ["igdb:5", "rawg:5"]);
  assert.equal(data.records["rawg:5"].name, "Old");
  assert.equal(data.records["igdb:5"].name, "New");
});
