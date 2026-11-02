// @ts-nocheck -- Node's test modules are not included in the application tsconfig.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { rawgImage } from "../src/lib/providers/rawg/image.ts";
import {
  normalizeGameDetail,
  normalizeGamePage,
  normalizeGameSummary,
  normalizeScreenshots,
  stripHtml,
  webUrl,
} from "../src/lib/providers/rawg/normalize.ts";

test("summaries without id, slug or name are dropped", () => {
  assert.equal(normalizeGameSummary(null), null);
  assert.equal(normalizeGameSummary({ slug: "x", name: "X" }), null);
  assert.equal(normalizeGameSummary({ id: 1, name: "X" }), null);
  assert.equal(normalizeGameSummary({ id: 1, slug: "x", name: "  " }), null);
});

test("missing and placeholder metadata normalize to null, not zero", () => {
  const game = normalizeGameSummary({
    id: 7,
    slug: "seven",
    name: "Seven",
    released: "",
    tba: true,
    background_image: null,
    rating: 0,
    metacritic: 0,
    genres: [null, { id: 4, slug: "action", name: "Action" }, { name: "no id" }],
    parent_platforms: [
      { platform: { slug: "pc" } },
      { platform: { slug: "pc" } },
      { platform: { slug: "atari" } },
      null,
    ],
    esrb_rating: null,
    short_screenshots: null,
  });
  assert.equal(game.released, null);
  assert.equal(game.tba, true);
  assert.equal(game.image, null);
  assert.equal(game.rating, null);
  assert.equal(game.metacritic, null);
  assert.equal(game.esrb, null);
  assert.deepEqual(game.genres, [{ id: 4, slug: "action", name: "Action" }]);
  assert.deepEqual(game.platformFamilies, ["pc", "other"]);
  assert.deepEqual(game.shortScreenshots, []);
  assert.equal(game.ratingsCount, 0);
});

test("invalid dates are dropped and the background image is not repeated as a screenshot", () => {
  const game = normalizeGameSummary({
    id: 1,
    slug: "a",
    name: "A",
    released: "2020-13-45x",
    background_image: "https://media.rawg.io/media/games/a/bg.jpg",
    short_screenshots: [
      { image: "https://media.rawg.io/media/games/a/bg.jpg" },
      { image: "https://media.rawg.io/media/screenshots/a/1.jpg" },
      { image: null },
    ],
  });
  assert.equal(game.released, null);
  assert.deepEqual(game.shortScreenshots, ["https://media.rawg.io/media/screenshots/a/1.jpg"]);
});

test("detail prefers description_raw and falls back to stripped HTML", () => {
  const raw = normalizeGameDetail({ id: 1, slug: "a", name: "A", description_raw: "Plain text." });
  assert.equal(raw.description, "Plain text.");
  const html = normalizeGameDetail({
    id: 1,
    slug: "a",
    name: "A",
    description: "<p>First &amp; best.</p><p>Second<br/>line</p>",
  });
  assert.equal(html.description, "First & best.\n\nSecond\nline");
  const none = normalizeGameDetail({ id: 1, slug: "a", name: "A" });
  assert.equal(none.description, null);
  assert.equal(none.playtime, null);
  assert.deepEqual(none.counts, { screenshots: 0, series: 0, additions: 0, parents: 0 });
});

test("detail keeps English tags only and tolerates partial platform data", () => {
  const detail = normalizeGameDetail({
    id: 1,
    slug: "a",
    name: "A",
    tags: [
      { id: 1, slug: "singleplayer", name: "Singleplayer", language: "eng" },
      { id: 2, slug: "x", name: "Одиночная", language: "rus" },
    ],
    platforms: [{ platform: { name: "PC" }, released_at: "2015-05-18" }, { platform: null }],
    playtime: 0,
    game_series_count: 4,
  });
  assert.deepEqual(
    detail.tags.map((t) => t.slug),
    ["singleplayer"],
  );
  assert.deepEqual(detail.platforms, [{ name: "PC", releasedAt: "2015-05-18" }]);
  assert.equal(detail.playtime, null);
  assert.equal(detail.counts.series, 4);
});

test("pages drop broken entries and duplicates and report hasMore from next", () => {
  const page = normalizeGamePage({
    count: 999,
    next: "https://api.rawg.io/api/games?page=2",
    results: [
      { id: 1, slug: "a", name: "A" },
      { id: 1, slug: "a", name: "A" },
      { name: "broken" },
      null,
    ],
  });
  assert.equal(page.items.length, 1);
  assert.equal(page.count, 999);
  assert.equal(page.hasMore, true);
  const last = normalizeGamePage({ results: [], next: null });
  assert.equal(last.hasMore, false);
  assert.deepEqual(normalizeGamePage(undefined).items, []);
});

test("screenshots skip null images", () => {
  assert.deepEqual(normalizeScreenshots({ results: [{ image: "u1" }, { image: null }, null] }), [
    "u1",
  ]);
});

test("stripHtml decodes common entities", () => {
  assert.equal(stripHtml("<b>Tom&#39;s</b> &quot;game&quot; &lt;3"), `Tom's "game" <3`);
});

test("rawgImage rewrites RAWG media to a resized URL with the original as fallback", () => {
  const url = "https://media.rawg.io/media/games/618/618c2031a07bbff6b4f611f10b6bcdbc.jpg";
  assert.deepEqual(rawgImage(url, 640), [
    "https://media.rawg.io/media/resize/640/-/games/618/618c2031a07bbff6b4f611f10b6bcdbc.jpg",
    url,
  ]);
  const shot = "https://media.rawg.io/media/screenshots/a/b.jpg";
  assert.equal(
    rawgImage(shot, 420)[0],
    "https://media.rawg.io/media/resize/420/-/screenshots/a/b.jpg",
  );
  assert.deepEqual(rawgImage(url, null), [url]);
  assert.deepEqual(rawgImage("https://example.com/x.jpg", 640), ["https://example.com/x.jpg"]);
  assert.deepEqual(rawgImage(null, 640), []);
});

test("webUrl accepts http and https URLs, returning the parsed form", () => {
  assert.equal(webUrl("https://www.thewitcher.com/en"), "https://www.thewitcher.com/en");
  assert.equal(webUrl("http://example.com/game?id=1#top"), "http://example.com/game?id=1#top");
  assert.equal(webUrl("  https://example.com  "), "https://example.com/");
  assert.equal(webUrl("HTTPS://EXAMPLE.COM/Path"), "https://example.com/Path");
});

test("webUrl rejects every other scheme, including obfuscated ones", () => {
  for (const value of [
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "  javascript:alert(1)",
    "java\nscript:alert(1)",
    "java\tscript:alert(1)",
    "\u0001javascript:alert(1)",
    "file:///C:/Windows/System32/calc.exe",
    "file://server/share/secret.txt",
    "data:text/html,<script>alert(1)</script>",
    "blob:https://example.com/1234",
    "about:blank",
    "vbscript:msgbox(1)",
    "ftp://example.com/file",
    "mailto:someone@example.com",
    "ms-msdt:/id",
    "steam://run/1234",
    "stremio://install",
    "tauri://localhost",
    "http+unix://%2Fvar%2Frun/x",
  ]) {
    assert.equal(webUrl(value), null, JSON.stringify(value));
  }
});

test("webUrl rejects malformed values and non-strings", () => {
  for (const value of [
    "",
    "   ",
    "not a url",
    "www.example.com",
    "//example.com/path",
    "/relative/path",
    "https://",
    "http://",
    null,
    undefined,
    42,
    {},
  ]) {
    assert.equal(webUrl(value), null, JSON.stringify(value));
  }
});

test("detail keeps a safe website and drops an unsafe one", () => {
  const detail = (website) => normalizeGameDetail({ id: 1, slug: "a", name: "A", website });
  assert.equal(
    detail("https://www.rockstargames.com/gta-v").website,
    "https://www.rockstargames.com/gta-v",
  );
  for (const unsafe of ["javascript:alert(1)", "file:///C:/secret.txt", "data:text/html,x", "x"]) {
    assert.equal(detail(unsafe).website, null, unsafe);
  }
});

// openUrl falls back to browser_open, which has no scheme check, so the game
// page must never hand it anything that didn't pass webUrl.
test("the game page only opens RAWG's own page or the validated website", () => {
  const view = readFileSync(
    new URL("../src/views/game-discovery/game-detail.tsx", import.meta.url),
    "utf8",
  );
  const opened = [...view.matchAll(/openUrl\(([^)]*)\)/g)].map((m) => m[1]).sort();
  assert.deepEqual(opened, ["`https://rawg.io/games/${game.slug}`", "detail.website!"]);
  const normalize = readFileSync(
    new URL("../src/lib/providers/rawg/normalize.ts", import.meta.url),
    "utf8",
  );
  assert.match(normalize, /website: webUrl\(raw\.website\)/);
});
