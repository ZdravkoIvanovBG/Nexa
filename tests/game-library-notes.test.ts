// @ts-nocheck -- Node's test modules are not included in the application tsconfig.
// Note safety: text typed but not saved, and a version replaced by another, must
// survive a close, a profile change, a sign-out and an adoption, without ever
// reaching another profile or account, and without overwriting a newer note.
import assert from "node:assert/strict";
import test from "node:test";
import {
  forgetGameProfile,
  libraryKey,
  prepareGameHold,
  restoreHeldGames,
} from "../src/lib/game-library/backup-state.ts";
import {
  noteSafetyKey,
  parseNoteSafety,
  reconcileNotes,
} from "../src/lib/game-library/note-drafts.ts";
import { startGame } from "../src/lib/game-library/rules.ts";
import { createGameStore } from "../src/lib/game-library/store-core.ts";

const OWNER_KEY = "harbor.local.ownerUserId";

const ref = (rawgId) => ({
  provider: "rawg",
  rawgId,
  slug: `game-${rawgId}`,
  name: `Game ${rawgId}`,
  released: null,
  image: null,
});

function fakeStorage() {
  const map = new Map();
  return {
    map,
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

/** One app session on a storage: a store as the app builds it, with a moving clock. */
function session(storage, { clock = { now: 1000 }, placeholder = () => false } = {}) {
  const store = createGameStore({
    read: (key) => storage.getItem(key),
    write: (key, value) => {
      storage.setItem(key, value);
      return true;
    },
    remove: (key) => storage.removeItem(key),
    now: () => (clock.now += 10),
    random: Math.random,
    isPlaceholderProfile: placeholder,
  });
  const run = (profileId, change, ...args) =>
    store.apply(profileId, (data, ctx) => change(data, ...args, ctx));
  return { store, run, clock };
}

/** wipePortableLocalData, as in game-library-sync.test.ts. */
function wipe(storage) {
  const hold = prepareGameHold(storage.getItem(OWNER_KEY), storage);
  const portable = [...storage.map.keys()].filter(
    (key) => key.startsWith("harbor.") && !key.startsWith("harbor.cloud.") && key !== OWNER_KEY,
  );
  for (const key of portable) storage.removeItem(key);
  hold();
}

function claim(storage, userId) {
  const owner = storage.getItem(OWNER_KEY);
  if (owner && owner !== userId) wipe(storage);
  storage.setItem(OWNER_KEY, userId);
  return restoreHeldGames(userId, storage);
}

const draftOf = (store, profileId, gameId) => store.noteSafety(profileId).drafts[gameId];

test("note drafts are filed under a portable per-profile key", () => {
  assert.equal(noteSafetyKey("p1"), "harbor.games.notes.v1.p1");
  assert.ok(!noteSafetyKey("p1").startsWith("harbor.cloud."), "wiped with the library");
});

test("typed text survives a restart until it is saved", () => {
  const storage = fakeStorage();
  const first = session(storage);
  first.run("p1", startGame, ref(1));
  first.store.setNoteDraft("p1", "rawg:1", "Halfway through the");

  const second = session(storage);
  const draft = draftOf(second.store, "p1", "rawg:1");
  assert.equal(draft.text, "Halfway through the");
  assert.equal(draft.reason, "unsaved");

  const base = second.store.snapshot("p1").records["rawg:1"].notesAt;
  second.store.saveNotes("p1", "rawg:1", "Halfway through the desert", base);
  assert.equal(second.store.snapshot("p1").records["rawg:1"].notes, "Halfway through the desert");
  // The draft held older text than what was saved, so it stays to be decided on.
  assert.equal(draftOf(second.store, "p1", "rawg:1").text, "Halfway through the");
  second.store.setNoteDraft("p1", "rawg:1", "Halfway through the desert");
  assert.equal(draftOf(second.store, "p1", "rawg:1"), undefined, "matching text clears it");
});

test("saving the typed text clears its draft", () => {
  const { store, run } = session(fakeStorage());
  run("p1", startGame, ref(1));
  store.setNoteDraft("p1", "rawg:1", "Find the last relic");
  store.saveNotes("p1", "rawg:1", "Find the last relic", 0);
  assert.equal(draftOf(store, "p1", "rawg:1"), undefined);
  assert.equal(store.snapshot("p1").records["rawg:1"].notes, "Find the last relic");
});

test("drafts stay with the profile they were typed in", () => {
  const storage = fakeStorage();
  const { store, run } = session(storage);
  run("p1", startGame, ref(1));
  run("p2", startGame, ref(1));
  store.setNoteDraft("p1", "rawg:1", "Profile one's secret");
  assert.equal(draftOf(store, "p2", "rawg:1"), undefined);
  assert.equal(storage.getItem(noteSafetyKey("p2")), null);
  assert.match(storage.getItem(noteSafetyKey("p1")), /Profile one's secret/);
});

test("a note typed while another version arrived keeps that version as a draft", () => {
  const { store, run } = session(fakeStorage());
  run("p1", startGame, ref(1));
  store.saveNotes("p1", "rawg:1", "Old note", 0);
  const base = store.snapshot("p1").records["rawg:1"].notesAt;

  // A pull brings another device's newer note while the editor is open.
  const remote = structuredClone(store.snapshot("p1"));
  remote.records["rawg:1"] = {
    ...remote.records["rawg:1"],
    notes: "Phone note",
    notesAt: base + 500,
  };
  store.merge("p1", { records: remote.records, queue: {} });
  assert.equal(store.snapshot("p1").records["rawg:1"].notes, "Phone note");

  store.saveNotes("p1", "rawg:1", "Typed on the PC", base);
  assert.equal(store.snapshot("p1").records["rawg:1"].notes, "Typed on the PC");
  const draft = draftOf(store, "p1", "rawg:1");
  assert.equal(draft.text, "Phone note");
  assert.equal(draft.reason, "replaced");
});

test("an unchanged base replaces nothing worth keeping", () => {
  const { store, run } = session(fakeStorage());
  run("p1", startGame, ref(1));
  store.saveNotes("p1", "rawg:1", "First", 0);
  const base = store.snapshot("p1").records["rawg:1"].notesAt;
  store.saveNotes("p1", "rawg:1", "First, then more", base);
  assert.equal(draftOf(store, "p1", "rawg:1"), undefined);
});

// ── cloud merge ─────────────────────────────────────────────────────────────

function cloudCopy(store, profileId, gameId, fields) {
  const data = structuredClone(store.snapshot(profileId));
  data.records[gameId] = { ...data.records[gameId], ...fields };
  return { records: data.records, queue: {} };
}

test("a newer cloud note that replaces this device's save keeps the local text", () => {
  const { store, run } = session(fakeStorage());
  run("p1", startGame, ref(1));
  store.saveNotes("p1", "rawg:1", "Typed offline on the PC", 0);
  const savedAt = store.snapshot("p1").records["rawg:1"].notesAt;
  assert.equal(store.noteSafety("p1").pending["rawg:1"], savedAt);

  store.merge(
    "p1",
    cloudCopy(store, "p1", "rawg:1", {
      notes: "Typed later on the laptop",
      notesAt: savedAt + 100,
    }),
  );
  // The newer cloud note is what the library shows: nothing overwrote it.
  assert.equal(store.snapshot("p1").records["rawg:1"].notes, "Typed later on the laptop");
  const draft = draftOf(store, "p1", "rawg:1");
  assert.equal(draft.text, "Typed offline on the PC");
  assert.equal(draft.reason, "replaced");
  assert.deepEqual(store.noteSafety("p1").pending, {});
});

test("a pull that confirms this device's save leaves nothing to recover", () => {
  const { store, run } = session(fakeStorage());
  run("p1", startGame, ref(1));
  store.saveNotes("p1", "rawg:1", "Mine", 0);
  const savedAt = store.snapshot("p1").records["rawg:1"].notesAt;

  // The cloud hasn't got it yet: still pending.
  store.merge("p1", cloudCopy(store, "p1", "rawg:1", { notes: "", notesAt: 0 }));
  assert.equal(store.noteSafety("p1").pending["rawg:1"], savedAt);
  assert.equal(store.snapshot("p1").records["rawg:1"].notes, "Mine");

  store.merge("p1", cloudCopy(store, "p1", "rawg:1", {}));
  assert.deepEqual(store.noteSafety("p1").pending, {});
  assert.equal(draftOf(store, "p1", "rawg:1"), undefined);
});

test("a note that was only ever synced is never offered back", () => {
  const local = { records: { "rawg:1": { notes: "Old", notesAt: 5 } }, queue: {} };
  const remote = { records: { "rawg:1": { notes: "New", notesAt: 9 } }, queue: {} };
  const safety = { drafts: {}, pending: {} };
  assert.deepEqual(reconcileNotes(safety, local, remote), safety);
});

// ── account and profile lifecycle ───────────────────────────────────────────

test("sign-out holds drafts for the same account, and only it gets them back", () => {
  const storage = fakeStorage();
  claim(storage, "alice");
  const alice = session(storage);
  alice.run("p1", startGame, ref(1));
  alice.store.setNoteDraft("p1", "rawg:1", "Alice was typing this");

  wipe(storage); // a normal sign-out
  assert.equal(storage.getItem(noteSafetyKey("p1")), null, "nothing left under the profile");
  for (const key of storage.map.keys()) {
    if (storage.map.get(key).includes("Alice was typing")) {
      assert.match(key, /^harbor\.cloud\.games\.notes-held\.v1\.alice\.p1$/);
    }
  }

  claim(storage, "bob");
  const bob = session(storage);
  assert.deepEqual(bob.store.noteSafety("p1"), { drafts: {}, pending: {} });
  assert.equal(storage.getItem(noteSafetyKey("p1")), null);

  claim(storage, "alice");
  const back = session(storage);
  assert.equal(draftOf(back.store, "p1", "rawg:1").text, "Alice was typing this");
});

test("another account signing in holds the previous account's drafts away from it", () => {
  const storage = fakeStorage();
  claim(storage, "alice");
  const alice = session(storage);
  alice.run("p1", startGame, ref(1));
  alice.store.setNoteDraft("p1", "rawg:1", "Private");

  assert.equal(claim(storage, "bob"), false);
  const bob = session(storage);
  assert.equal(draftOf(bob.store, "p1", "rawg:1"), undefined);
  assert.ok(
    [...storage.map.keys()].every(
      (key) => !storage.map.get(key).includes("Private") || key.includes(".alice."),
    ),
  );
});

test("deleting a profile removes its drafts and held drafts", () => {
  const storage = fakeStorage();
  claim(storage, "alice");
  const app = session(storage);
  app.run("p1", startGame, ref(1));
  app.store.setNoteDraft("p1", "rawg:1", "Gone with the profile");
  wipe(storage);
  claim(storage, "alice");
  session(storage).store.setNoteDraft("p1", "rawg:1", "Typed again");
  wipe(storage);
  storage.setItem(noteSafetyKey("p1"), JSON.stringify({ drafts: {}, pending: { x: 1 } }));

  forgetGameProfile("p1", storage);
  assert.ok(
    [...storage.map.keys()].every((key) => !key.endsWith(".p1")),
    [...storage.map.keys()].join(", "),
  );
});

test("forgetting a profile in a running store drops its drafts too", () => {
  const storage = fakeStorage();
  const { store, run } = session(storage);
  run("p1", startGame, ref(1));
  store.setNoteDraft("p1", "rawg:1", "Draft");
  store.forget("p1");
  assert.equal(storage.getItem(noteSafetyKey("p1")), null);
  assert.equal(storage.getItem(libraryKey("p1")), null);
  assert.deepEqual(store.noteSafety("p1"), { drafts: {}, pending: {} });
});

test("adopting a placeholder profile moves its drafts to the real profile", () => {
  const storage = fakeStorage();
  const { store, run } = session(storage, { placeholder: (id) => id === "local" });
  run("local", startGame, ref(1));
  store.setNoteDraft("local", "rawg:1", "Typed before signing in");
  run("real", startGame, ref(2));
  store.setNoteDraft("real", "rawg:2", "Already here");

  store.adopt("local", "real");
  assert.equal(draftOf(store, "real", "rawg:1").text, "Typed before signing in");
  assert.equal(draftOf(store, "real", "rawg:2").text, "Already here");
  assert.equal(storage.getItem(noteSafetyKey("local")), null);
  const onDisk = parseNoteSafety(storage.getItem(noteSafetyKey("real")));
  assert.equal(onDisk.drafts["rawg:1"].text, "Typed before signing in");
});

test("unreadable draft storage offers nothing and breaks nothing", () => {
  assert.deepEqual(parseNoteSafety("{not json"), { drafts: {}, pending: {} });
  assert.deepEqual(
    parseNoteSafety(JSON.stringify({ drafts: { a: { text: 5 } }, pending: { b: "x" } })),
    {
      drafts: {},
      pending: {},
    },
  );
  const long = "x".repeat(5000);
  const parsed = parseNoteSafety(JSON.stringify({ drafts: { a: { text: long, at: 1 } } }));
  assert.equal(parsed.drafts.a.text.length, 4000);
});

test("a draft is never written into the synced library", () => {
  const { store, run } = session(fakeStorage());
  run("p1", startGame, ref(1));
  const before = store.snapshot("p1");
  store.setNoteDraft("p1", "rawg:1", "Not saved yet");
  assert.equal(store.snapshot("p1"), before, "the library is untouched");
  assert.equal(store.snapshot("p1").records["rawg:1"].notes, "");
});

test("using a kept version swaps it with the note, so neither is lost", () => {
  const { store, run } = session(fakeStorage());
  run("p1", startGame, ref(1));
  store.saveNotes("p1", "rawg:1", "Typed offline", 0);
  const savedAt = store.snapshot("p1").records["rawg:1"].notesAt;
  store.merge("p1", cloudCopy(store, "p1", "rawg:1", { notes: "Laptop", notesAt: savedAt + 100 }));

  const patch = store.restoreNoteDraft("p1", "rawg:1");
  assert.equal(patch.records.length, 1, "one upload, like any edit");
  assert.equal(store.snapshot("p1").records["rawg:1"].notes, "Typed offline");
  assert.equal(draftOf(store, "p1", "rawg:1").text, "Laptop");

  store.restoreNoteDraft("p1", "rawg:1");
  assert.equal(store.snapshot("p1").records["rawg:1"].notes, "Laptop");
  assert.equal(draftOf(store, "p1", "rawg:1").text, "Typed offline");

  store.discardNoteDraft("p1", "rawg:1");
  assert.equal(draftOf(store, "p1", "rawg:1"), undefined);
  assert.equal(store.snapshot("p1").records["rawg:1"].notes, "Laptop");
});
