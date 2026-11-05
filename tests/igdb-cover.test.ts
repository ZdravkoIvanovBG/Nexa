// @ts-nocheck -- Node's test modules are not included in the application tsconfig.
// Stage 4B: portrait cover cards for IGDB. Cover selection (art.ts), the data
// it produces, card sizes, and source-shape checks that every IGDB card
// surface uses covers while RAWG keeps its landscape cards. No DOM, no network:
// how the covers look was judged in a rendered comparison, not here.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { coverImage, gameImage } from "../src/lib/game-discovery/game-image.ts";
import { providerFeatures } from "../src/lib/game-discovery/provider.ts";
import { COVER_RULE, coverCandidates, selectCover } from "../src/lib/providers/igdb/art.ts";
import { normalizeIgdbGame } from "../src/lib/providers/igdb/normalize.ts";
import { ART_FIELDS } from "../src/lib/providers/igdb/query.ts";
import { toGameSummary } from "../src/lib/providers/igdb/summary.ts";
import { normalizeGameSummary } from "../src/lib/providers/rawg/normalize.ts";
import { shortGenre } from "../src/views/game-discovery/format.ts";

const src = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
const cover = (image_id, width = 825, height = 1100, extra = {}) => ({
  image_id,
  width,
  height,
  ...extra,
});
const altCover = (image_id, width = 600, height = 800, type = 9) => ({
  image_id,
  width,
  height,
  artwork_type: type,
});
const chosen = (raw) => selectCover(coverCandidates(raw))?.imageId ?? null;

test("the main cover wins when it's sharp and portrait", () => {
  assert.equal(chosen({ cover: cover("main"), artworks: [altCover("alt")] }), "main");
});

test("IGDB's alpha flag doesn't reject a cover (verified opaque box art)", () => {
  assert.equal(chosen({ cover: cover("main", 825, 1100, { alpha_channel: true }) }), "main");
});

test("a low-resolution main cover loses to a sharp alternative or historical cover", () => {
  const soft = cover("soft", 200, 266);
  assert.equal(chosen({ cover: soft, artworks: [altCover("alt")] }), "alt");
  assert.equal(chosen({ cover: soft, artworks: [altCover("hist", 600, 800, 10)] }), "hist");
  // With nothing better, the soft cover still beats no cover at all.
  assert.equal(chosen({ cover: soft }), "soft");
  assert.ok(COVER_RULE.minWidth >= 264, "cover_big is 264 px: smaller would upscale");
});

test("wrong shapes, animated and broken covers are never used", () => {
  for (const bad of [
    cover("square", 1024, 1024),
    cover("wide", 1920, 1080),
    cover("anim", 825, 1100, { animated: true }),
    { image_id: "bad/id", width: 825, height: 1100 },
    { width: 825, height: 1100 },
  ]) {
    assert.equal(chosen({ cover: bad }), null, JSON.stringify(bad));
  }
  // Only cover-type artworks stand in: never key art, logos or square covers.
  const artworks = [
    { image_id: "keyart", width: 1920, height: 1080, artwork_type: 2 },
    { image_id: "logo", width: 600, height: 800, artwork_type: 7 },
    { image_id: "square", width: 720, height: 720, artwork_type: 11 },
  ];
  assert.equal(chosen({ artworks }), null);
});

test("unknown cover size is accepted but ranked below a proven sharp one", () => {
  assert.equal(chosen({ cover: { image_id: "unsized" } }), "unsized");
  assert.equal(chosen({ cover: { image_id: "unsized" }, artworks: [altCover("alt")] }), "alt");
});

test("normalized IGDB games carry the chosen cover; selection doesn't mutate the response", () => {
  const raw = {
    id: 1942,
    name: "The Witcher 3: Wild Hunt",
    slug: "the-witcher-3-wild-hunt",
    cover: cover("soft", 200, 266),
    artworks: [altCover("alt")],
  };
  const before = JSON.stringify(raw);
  const summary = toGameSummary(normalizeIgdbGame(raw));
  assert.equal(summary.cover, "https://images.igdb.com/igdb/image/upload/t_cover_big/alt.jpg");
  assert.equal(JSON.stringify(raw), before);
  const none = toGameSummary(normalizeIgdbGame({ id: 2, name: "B", slug: "b" }));
  assert.equal(none.cover, null, "IGDB without a cover: the card falls back");
});

test("RAWG summaries have no cover field and keep landscape cards", () => {
  const rawg = normalizeGameSummary({
    id: 3328,
    slug: "the-witcher-3-wild-hunt",
    name: "The Witcher 3: Wild Hunt",
    background_image: "https://media.rawg.io/media/games/618/618c.jpg",
  });
  assert.ok(rawg && !("cover" in rawg));
  assert.equal(providerFeatures("rawg").cards, "landscape");
  assert.equal(providerFeatures("igdb").cards, "cover");
  const url = "https://media.rawg.io/media/games/618/618c.jpg";
  assert.deepEqual(coverImage(url, 2), [url], "never resizes another provider's URL");
  assert.deepEqual(
    gameImage(url, 640)[0],
    "https://media.rawg.io/media/resize/640/-/games/618/618c.jpg",
  );
});

test("cover sizes: cover_big normally, the 2x size only on 2x displays", () => {
  const big = "https://images.igdb.com/igdb/image/upload/t_cover_big/co1q1f.jpg";
  assert.deepEqual(coverImage(big, 1), [big]);
  assert.deepEqual(coverImage(big, 1.5), [big]);
  assert.deepEqual(coverImage(big, 2), [
    "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/co1q1f.jpg",
    big,
  ]);
  assert.deepEqual(coverImage(null, 2), []);
  // The cover's size rides on the existing list response: no extra request.
  for (const field of ["cover.width", "cover.height", "cover.animated"]) {
    assert.ok(ART_FIELDS.includes(field), field);
  }
});

test("the cover card falls back cover → landscape art (contained) → titled placeholder", () => {
  const card = src("views/game-discovery/game-card.tsx");
  const cover = card.slice(
    card.indexOf("function CoverCard"),
    card.indexOf("function LandscapeCard"),
  );
  assert.match(cover, /const \[src, \.\.\.fallbacks\] = coverImage\(game\.cover\);/);
  assert.match(cover, /!game\.cover && game\.image && game\.imageKind !== "portrait"/);
  assert.match(cover, /gameImage\(game\.image, 420\)/, "a small landscape size for the fallback");
  assert.match(cover, /ratio="cover"/);
  assert.match(cover, /onError=\{\(\) => setFailed\(true\)\}/);
  assert.match(cover, /const titled = failed \|\| \(!src && !landscape\);/);
  assert.match(cover, /\{landscape && !failed && <LandscapeFill src=\{landscape\} \/>\}/);
  // Landscape art is contained in the frame, never cropped to a sliver.
  const fill = card.slice(
    card.indexOf("export function LandscapeFill"),
    card.indexOf("export type GameCardShape"),
  );
  assert.match(fill, /object-contain/);
  // Same lift, ring, shadow, hover and focus treatment as the landscape card.
  assert.match(cover, /<div className=\{CARD_LIFT\}>/);
  assert.match(cover, /className=\{CARD_FRAME\}/);
  assert.match(card, /group-focus-visible:\[transform:translate3d\(0,-0\.5rem,0\)\]/);
  assert.match(cover, /lazy\r?\n/);
});

test("every IGDB card surface uses the provider's card shape", () => {
  const row = src("views/game-discovery/game-row.tsx");
  assert.match(row, /return providerFeatures\(gate\.provider\)\.cards;/);
  assert.match(row, /<GameCard key=\{game\.id\} game=\{game\} shape=\{shape\} \/>/);
  assert.match(row, /shape=\{shape\}\s+min=\{CARD_MIN_WIDTH\[shape\]\}/);
  assert.match(row, /return <GameRowSkeleton title=\{t\(section\.title\)\} shape=\{shape\} \/>;/);
  // Discovery's lazy rows, the detail page's related and developer rows, Browse and search.
  const discovery = src("views/game-discovery.tsx");
  assert.equal(
    (discovery.match(/<GameRowSkeleton title=\{t\(s\.title\)\} shape=\{shape\} \/>/g) ?? []).length,
    2,
  );
  const detail = src("views/game-discovery/game-detail.tsx");
  // Related, developer and (IGDB) series rows, with their skeletons.
  assert.equal((detail.match(/shape=\{cardShapeOf\(gate\)\}/g) ?? []).length, 9);
  const browse = src("views/game-discovery/browse-view.tsx");
  assert.match(browse, /minColumnWidth=\{CARD_MIN_WIDTH\[shape\]\}/);
  assert.match(browse, /renderItem=\{\(game\) => <GameCard game=\{game\} shape=\{shape\} \/>\}/);
  assert.match(browse, /<GameCardSkeleton key=\{i\} shape=\{shape\} \/>/);
});

test("heroes, backdrops and franchise banners stay landscape", () => {
  assert.match(
    src("views/game-discovery/games-hero.tsx"),
    /gameImage\(heroImageOf\(game\), null\)/,
  );
  assert.match(
    src("views/game-discovery/game-detail.tsx"),
    /heroImageOf\(game\) \?\? \(portrait \? null : game\.image\)/,
  );
  const discovery = src("views/game-discovery.tsx");
  assert.match(discovery, /shape="landscape"\s+min=\{300\}\s+scrollKey="games-row-franchises"/);
  assert.doesNotMatch(
    src("views/game-discovery/franchise-card.tsx"),
    /game\.cover|coverImage|ratio="cover"/,
  );
});

test("shared Poster and Row gain a 3:4 option without changing the others", () => {
  const poster = src("components/poster.tsx");
  assert.match(poster, /portrait: "150%", \/\/ 3 \/ 2/);
  assert.match(poster, /landscape: "56\.25%", \/\/ 9 \/ 16/);
  assert.match(poster, /cover: "133\.333%",/);
  const row = src("components/row.tsx");
  assert.match(row, /shape === "cover" \? "aspect-\[3\/4\]" : "aspect-\[2\/3\]"/);
  // Movie-poster hover effects stay limited to the movie "portrait" shape.
  assert.match(
    row,
    /const expandingCards = shape === "portrait" && settings\.posterBackdropExpansion;/,
  );
  assert.match(
    row,
    /const dockEnabled = shape === "portrait" && settings\.posterDockMagnification;/,
  );
});

test("card shape never reaches a query key", () => {
  const queries = src("lib/game-discovery/queries.ts");
  assert.doesNotMatch(queries, /\.cards|coverImage|GameCardShape|cardShapeOf/);
});

test("cover cards show short genre names", () => {
  assert.equal(shortGenre("Role-playing (RPG)"), "RPG");
  assert.equal(shortGenre("Real Time Strategy (RTS)"), "RTS");
  assert.equal(shortGenre("Hack and slash/Beat 'em up"), "Hack and slash");
  assert.equal(shortGenre("Card & Board Game"), "Card & Board Game");
  assert.equal(shortGenre("Shooter"), "Shooter");
  assert.equal(shortGenre("Role-playing games (RPG)"), "RPG");
});
