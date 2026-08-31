// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import { isSvpActive } from "../src/lib/player/svp-policy.ts";

test("requires both SVP enablement and a VapourSynth script", () => {
  assert.equal(isSvpActive({ playerSvp: true, svpVpyPath: "C:/svp/script.vpy" }), true);
  assert.equal(isSvpActive({ playerSvp: false, svpVpyPath: "C:/svp/script.vpy" }), false);
  assert.equal(isSvpActive({ playerSvp: true, svpVpyPath: "" }), false);
});
