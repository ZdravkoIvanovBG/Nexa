// @ts-nocheck -- Node's test modules are not included in the application tsconfig.
import assert from "node:assert/strict";
import test from "node:test";
import { getGameDetailRaw, redirectTarget } from "../src/lib/providers/rawg/detail.ts";

test("redirectTarget recognises only RAWG's redirect body", () => {
  assert.equal(
    redirectTarget({ redirect: true, slug: "far-cry-2-fortunes-edition" }, "far-cry-2"),
    "far-cry-2-fortunes-edition",
  );
  assert.equal(redirectTarget({ id: 1, slug: "far-cry-2", name: "Far Cry 2" }, "far-cry-2"), null);
  assert.equal(redirectTarget({ redirect: false, slug: "x" }, "y"), null);
  assert.equal(redirectTarget({ redirect: true, slug: "  " }, "y"), null);
  assert.equal(redirectTarget({ redirect: true, slug: "same" }, "same"), null);
  assert.equal(redirectTarget(null, "y"), null);
});

test("a normal detail response costs one request", async () => {
  const paths = [];
  const body = { id: 3328, slug: "the-witcher-3-wild-hunt", name: "The Witcher 3" };
  const result = await getGameDetailRaw(async (path) => {
    paths.push(path);
    return body;
  }, 3328);
  assert.equal(result, body);
  assert.deepEqual(paths, ["/games/3328"]);
});

test("a slug redirect is followed exactly once", async () => {
  const paths = [];
  const target = {
    id: 42,
    slug: "far-cry-2-fortunes-edition",
    name: "Far Cry 2: Fortune's Edition",
  };
  const result = await getGameDetailRaw(async (path) => {
    paths.push(path);
    return path === "/games/far-cry-2" ? { redirect: true, slug: target.slug } : target;
  }, "far-cry-2");
  assert.equal(result, target);
  assert.deepEqual(paths, ["/games/far-cry-2", "/games/far-cry-2-fortunes-edition"]);
});

test("redirect chains are not followed", async () => {
  const paths = [];
  const result = await getGameDetailRaw(async (path) => {
    paths.push(path);
    return { redirect: true, slug: `${path.split("/").pop()}-next` };
  }, "a");
  assert.equal(result, null);
  assert.equal(paths.length, 2);
});
