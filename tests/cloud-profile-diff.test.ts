// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import { diffProfiles } from "../src/lib/cloud/diff.ts";

type Profile = Parameters<typeof diffProfiles>[0][number];

function profile(over: Partial<Profile> & { id: string }): Profile {
  return {
    name: "Zdravko",
    avatar: null,
    color: "#7dd3fc",
    isPrimary: true,
    passwordHash: null,
    hideContent: null,
    lockedTabs: null,
    kid: null,
    settingsLinked: true,
    createdAt: 1000,
    updatedAt: 1000,
    ...over,
  } as Profile;
}

test("renaming a profile queues exactly one upsert", () => {
  const before = profile({ id: "p_1" });
  const after = { ...before, name: "Zed", updatedAt: 2000 };
  const d = diffProfiles([before], [after]);
  assert.equal(d.upserts.length, 1);
  assert.equal(d.upserts[0].name, "Zed");
  assert.deepEqual(d.deletes, []);
});

test("a new avatar queues an upsert", () => {
  const before = profile({ id: "p_1" });
  const after = { ...before, avatar: "data:image/webp;base64,AAAA", updatedAt: 2000 };
  assert.equal(diffProfiles([before], [after]).upserts.length, 1);
});

test("per-profile settings scope and PIN changes each queue an upsert", () => {
  const base = profile({ id: "p_1" });
  assert.equal(diffProfiles([base], [{ ...base, settingsLinked: false }]).upserts.length, 1);
  assert.equal(diffProfiles([base], [{ ...base, passwordHash: "hash" }]).upserts.length, 1);
});

test("kid settings are compared by value, not identity", () => {
  const base = profile({ id: "p_1", kid: { age: 7, curfewMinutes: null, parentPinHash: null } });
  const sameValue = {
    ...base,
    kid: { age: 7, curfewMinutes: null, parentPinHash: null },
  } as Profile;
  const changed = {
    ...base,
    kid: { age: 9, curfewMinutes: null, parentPinHash: null },
  } as Profile;
  assert.equal(diffProfiles([base], [sameValue]).upserts.length, 0);
  assert.equal(diffProfiles([base], [changed]).upserts.length, 1);
});

test("an untouched roster queues nothing, so selecting a profile is not a write", () => {
  const a = profile({ id: "p_1" });
  const b = profile({ id: "p_2", name: "Kid", isPrimary: false });
  const d = diffProfiles([a, b], [a, b]);
  assert.equal(d.upserts.length, 0);
  assert.deepEqual(d.deletes, []);
});

test("a deleted profile becomes a delete keyed by profile id", () => {
  const a = profile({ id: "p_1" });
  const b = profile({ id: "p_2", name: "Kid", isPrimary: false });
  const d = diffProfiles([a, b], [a]);
  assert.deepEqual(d.deletes, ["p_2"]);
  assert.equal(d.upserts.length, 0);
});

test("absent settingsLinked is treated as linked, so it is not a spurious upsert", () => {
  const withFlag = profile({ id: "p_1", settingsLinked: true });
  const without = profile({ id: "p_1" });
  delete (without as { settingsLinked?: boolean }).settingsLinked;
  assert.equal(diffProfiles([without], [withFlag]).upserts.length, 0);
});
