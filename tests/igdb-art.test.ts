// @ts-nocheck -- Node's test modules are not included in the application tsconfig.
// Stage 4A: IGDB art selection (art.ts), curated overrides and their wiring.
// Pure; no network. Visual quality itself was judged in the contact sheet
// (scripts/igdb-art-sheet.mjs), which these tests can't replace.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { gameImage } from "../src/lib/game-discovery/game-image.ts";
import {
  ART_RULES,
  artCandidates,
  rankArt,
  selectArt,
  suitable,
} from "../src/lib/providers/igdb/art.ts";
import { ART_OVERRIDES, artOverrideFor } from "../src/lib/providers/igdb/art-overrides.ts";
import { validImageId } from "../src/lib/providers/igdb/image.ts";
import { normalizeIgdbDetail, normalizeIgdbGame } from "../src/lib/providers/igdb/normalize.ts";
import { ART_FIELDS, DETAIL_FIELDS, SUMMARY_FIELDS } from "../src/lib/providers/igdb/query.ts";
import { toGameSummary } from "../src/lib/providers/igdb/summary.ts";
import { rawgImage } from "../src/lib/providers/rawg/image.ts";
import { heroImageOf } from "../src/views/game-discovery/format.ts";

const art = (image_id, width, height, artwork_type, extra = {}) => ({
  image_id,
  width,
  height,
  artwork_type,
  ...extra,
});
const shot = (image_id, width = 1920, height = 1080) => ({ image_id, width, height });
const pick = (raw, use, override) => selectArt(artCandidates(raw), use, override)?.imageId ?? null;

test("logos, icons, covers, infographics, transparent and animated images are never art", () => {
  const rejected = [
    art("logo1", 1106, 956, 7, { alpha_channel: true }), // GTA V's first artwork
    art("logo2", 1920, 640, 5),
    art("logo3", 1920, 640, 6),
    art("info1", 1920, 1080, 8),
    art("alt1", 600, 900, 9),
    art("hist1", 600, 800, 10),
    art("sq1", 1024, 1024, 11),
    art("icon1", 256, 256, 12),
    art("hlogo", 1920, 1080, 13),
    art("hicon", 256, 256, 14),
    art("alpha", 3840, 2160, 1, { alpha_channel: true }),
    art("anim", 1920, 1080, 1, { animated: true }),
  ];
  for (const use of ["card", "hero"]) {
    assert.deepEqual(rankArt(artCandidates({ artworks: rejected }), use), [], use);
  }
  // With nothing usable, normalization falls back to the portrait cover on
  // cards (shown whole on a blurred fill) and to no hero at all.
  const game = normalizeIgdbGame({
    id: 1,
    name: "A",
    slug: "a",
    artworks: rejected,
    cover: { image_id: "cov" },
  });
  assert.equal(game.art.kind, "cover");
  assert.equal(game.art.blur, true);
  assert.equal(game.heroArt, null);
});

test("hero order: key art without logo, then screenshots, then generic art, key art with logo last", () => {
  const raw = {
    artworks: [
      art("withlogo", 3840, 2160, 3),
      art("generic", 3840, 2160, 1),
      art("concept", 3840, 2160, 4),
      art("nologo", 3840, 2160, 2),
    ],
    screenshots: [shot("s1")],
  };
  assert.deepEqual(
    rankArt(artCandidates(raw), "hero").map((c) => c.imageId),
    ["nologo", "s1", "generic", "concept", "withlogo"],
  );
});

test("card order: key art (no logo, then with logo) before screenshots", () => {
  const raw = {
    artworks: [
      art("generic", 1920, 1080, 1),
      art("withlogo", 1920, 1080, 3),
      art("nologo", 1920, 1080, 2),
    ],
    screenshots: [shot("s1")],
  };
  assert.deepEqual(
    rankArt(artCandidates(raw), "card").map((c) => c.imageId),
    ["nologo", "withlogo", "s1", "generic"],
  );
});

test("aspect ratio: portrait and square never; wide key-art banners only after images that fit", () => {
  const raw = {
    artworks: [
      art("portrait", 1000, 1400, 1),
      art("square", 1200, 1200, 1),
      art("banner", 3840, 1240, 2), // 3.10, IGDB's common banner size
      art("toowide", 3840, 1000, 2), // 3.84
      art("fits", 1920, 1080, 2),
    ],
  };
  assert.deepEqual(
    rankArt(artCandidates(raw), "card").map((c) => c.imageId),
    ["fits", "banner"],
  );
  // A screenshot can't be a banner: screenshots must fit the frame.
  assert.equal(
    suitable(artCandidates({ screenshots: [shot("wide", 3834, 1278)] })[0], "card"),
    false,
  );
  for (const use of ["card", "hero"]) {
    const { minRatio, maxRatio, bannerMaxRatio } = ART_RULES[use];
    assert.ok(minRatio >= 1.3 && maxRatio <= 2.5 && bannerMaxRatio <= 3.2, use);
  }
});

test("resolution: hero art must be big enough not to be blown up; cards need less", () => {
  const raw = { screenshots: [shot("small", 1280, 720), shot("short", 1920, 620)] };
  assert.equal(pick(raw, "hero"), null, "1280 wide or 620 tall would be upscaled on a hero");
  assert.equal(pick(raw, "card"), "small");
  const tiny = { screenshots: [shot("tiny", 600, 338)] };
  assert.equal(pick(tiny, "card"), null);
  // Among equals, more pixels win (capped at what the use displays).
  const sizes = {
    screenshots: [shot("s1280", 1280, 720), shot("s1920"), shot("s3840", 3840, 2160)],
  };
  assert.equal(pick(sizes, "hero"), "s1920", "anything over 1920 ties; IGDB order breaks it");
  assert.equal(pick(sizes, "card"), "s1280", "cards show ~600 px: 1280 and up tie");
});

test("missing dimensions: a screenshot may be a card, never a hero; unsized artwork is skipped", () => {
  const raw = {
    artworks: [{ image_id: "a1", artwork_type: 2 }],
    screenshots: [{ image_id: "s1" }],
  };
  assert.equal(pick(raw, "card"), "s1");
  assert.equal(pick(raw, "hero"), null);
  assert.equal(pick({ artworks: [{ image_id: "a1" }] }, "card"), null);
});

test("selection is deterministic and never mutates its input", () => {
  const raw = {
    artworks: [art("a", 1920, 1080, 2), art("b", 1920, 1080, 2)],
    screenshots: [shot("c"), shot("c"), { image_id: "bad/id" }],
  };
  const before = JSON.stringify(raw);
  const candidates = artCandidates(raw);
  assert.deepEqual(
    candidates.map((c) => c.imageId),
    ["a", "b", "c"],
    "deduped, invalid ids dropped",
  );
  const frozen = Object.freeze(candidates.map((c) => Object.freeze({ ...c })));
  assert.deepEqual(
    rankArt(frozen, "card").map((c) => c.imageId),
    ["a", "b", "c"],
  );
  assert.equal(rankArt(frozen, "card")[0].imageId, rankArt(frozen, "card")[0].imageId);
  assert.equal(JSON.stringify(raw), before);
  normalizeIgdbGame({ id: 9, name: "N", slug: "n", ...raw });
  assert.equal(JSON.stringify(raw), before, "normalizing leaves the response untouched");
});

test("an override wins only with one of the game's own, usable images", () => {
  const raw = {
    artworks: [art("good", 3840, 2160, 2), art("opaque", 3840, 2160, 2, { alpha_channel: true })],
    screenshots: [shot("s1"), shot("small", 1280, 720)],
  };
  assert.equal(pick(raw, "hero"), "good");
  assert.equal(pick(raw, "hero", { kind: "screenshot", imageId: "s1" }), "s1");
  // Another game's image, a removed image, or the wrong kind: automatic choice.
  assert.equal(pick(raw, "hero", { kind: "screenshot", imageId: "elsewhere" }), "good");
  assert.equal(pick(raw, "hero", { kind: "artwork", imageId: "s1" }), "good");
  // An override never revives a rejected image (too small for a hero)...
  assert.equal(pick(raw, "hero", { kind: "screenshot", imageId: "small" }), "good");
  // ...except IGDB's alpha flag, which a reviewer can see is wrong.
  assert.equal(pick(raw, "hero", { kind: "artwork", imageId: "opaque" }), "opaque");
  assert.equal(pick(raw, "hero"), "good", "automatic selection still rejects alpha");
});

test("override entries are well-formed: igdb ids, valid image ids, a note", () => {
  const entries = Object.entries(ART_OVERRIDES);
  assert.ok(entries.length >= 5 && entries.length <= 30, "a small, curated set");
  for (const [id, entry] of entries) {
    assert.match(id, /^igdb:[1-9]\d*$/);
    assert.ok(entry.hero || entry.card, id);
    assert.ok(entry.note.length > 10, id);
    for (const ref of [entry.hero, entry.card].filter(Boolean)) {
      assert.ok(ref.kind === "artwork" || ref.kind === "screenshot", id);
      assert.ok(validImageId(ref.imageId), id);
      assert.ok(!/[/:]/.test(ref.imageId), "an image id, never a URL");
    }
  }
  assert.equal(artOverrideFor("rawg:1020"), null, "keyed by IGDB ids only");
  assert.equal(artOverrideFor("toString"), null);
  assert.equal(artOverrideFor("igdb:1020").card.imageId, "sc10f95");
});

test("normalization applies overrides, keeping identity and metadata", () => {
  const raw = {
    id: 1020,
    name: "Grand Theft Auto V",
    slug: "grand-theft-auto-v",
    artworks: [art("ar3m56", 1106, 956, 7, { alpha_channel: true })],
    screenshots: [shot("n3t2agwuxlqggp3kryf9", 1280, 720), shot("sc10f95")],
  };
  const summary = toGameSummary(normalizeIgdbGame(raw));
  assert.equal(summary.id, "igdb:1020");
  assert.equal(summary.name, "Grand Theft Auto V");
  assert.match(summary.image, /\/t_1080p\/sc10f95\.jpg$/, "the curated card");
  assert.match(summary.heroImage, /\/t_1080p\/sc10f95\.jpg$/, "the automatic hero");
  // Detail pages choose the same art from the same fields.
  const detail = normalizeIgdbDetail(raw);
  assert.equal(detail.art.url, normalizeIgdbGame(raw).art.url);
});

test("list and detail responses carry the art metadata (no extra request)", () => {
  for (const field of ART_FIELDS) {
    assert.ok(SUMMARY_FIELDS.includes(field), field);
    assert.ok(DETAIL_FIELDS.includes(field), field);
  }
  assert.ok(ART_FIELDS.includes("artworks.artwork_type"));
  assert.ok(ART_FIELDS.includes("artworks.alpha_channel"));
});

test("sizes: cards get a 16:9 thumbnail, heroes the full fitted image", () => {
  const full = "https://images.igdb.com/igdb/image/upload/t_1080p/sc10f95.jpg";
  assert.equal(
    gameImage(full, 640)[0],
    "https://images.igdb.com/igdb/image/upload/t_screenshot_med/sc10f95.jpg",
  );
  assert.deepEqual(gameImage(full, null), [full]);
  const hero = readFileSync(
    new URL("../src/views/game-discovery/games-hero.tsx", import.meta.url),
    "utf8",
  );
  assert.match(hero, /const \[image\] = gameImage\(heroImageOf\(game\), null\);/);
  const card = readFileSync(
    new URL("../src/views/game-discovery/game-card.tsx", import.meta.url),
    "utf8",
  );
  assert.match(card, /gameImage\(game\.image, 640\)/);
});

test("RAWG is untouched: its single image still serves hero and cards", () => {
  const rawg = { image: "https://media.rawg.io/media/games/618/618c.jpg", imageKind: undefined };
  assert.equal(heroImageOf(rawg), rawg.image);
  assert.deepEqual(gameImage(rawg.image, 640), rawgImage(rawg.image, 640));
  assert.equal(heroImageOf({ image: "x", imageKind: "portrait" }), null);
  assert.equal(heroImageOf({ image: "x", heroImage: null }), null, "IGDB game without hero art");
  const rawgNormalize = readFileSync(
    new URL("../src/lib/providers/rawg/normalize.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(rawgNormalize, /heroImage|artwork_type|art\.ts/);
  // IGDB art never comes from anywhere but IGDB's own CDN.
  const artSrc = readFileSync(new URL("../src/lib/providers/igdb/art.ts", import.meta.url), "utf8");
  assert.doesNotMatch(artSrc.replace(/\/\/.*$/gm, ""), /https?:\/\//);
});

test("the art contact sheet never prints credentials and writes only its HTML file", () => {
  const source = readFileSync(new URL("../scripts/igdb-art-sheet.mjs", import.meta.url), "utf8");
  const logLines = source.split("\n").filter((line) => /console\.(log|error|warn|info)/.test(line));
  assert.ok(logLines.length >= 3);
  for (const line of logLines) {
    assert.doesNotMatch(
      line,
      /process\.env|clientSecret|getToken|access_token|Authorization|Bearer/i,
      line,
    );
  }
  assert.equal((source.match(/writeFileSync\(/g) ?? []).length, 1);
  assert.match(source, /writeFileSync\(out, html\);/);
  assert.doesNotMatch(source, /stack|\.cause/, "never prints raw errors");
});
