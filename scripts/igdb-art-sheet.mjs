// Dev-only contact sheet of IGDB art candidates (Stage 4A). Not run in CI.
//
//   node --env-file=.env.igdb.local scripts/igdb-art-sheet.mjs [igdb ids…] [--out file.html] [--picks]
//
// --picks shows only the before/after row per game (a quick overview).
// --section <popular|new|upcoming|acclaimed|classics> takes the games from that
// Discovery row (as the app's provider lists it) and shows a compact grid:
// Stage 4 card, new card and new hero per game.
//
// For each game it shows the Stage 4 pick (first artwork, then screenshot,
// then cover), the current hero and card picks (art.ts plus art-overrides.ts),
// and every artwork and screenshot with its type, size, image id and why the
// rules accept or reject it. Each image is shown whole (CDN "720p", which keeps
// the aspect) and as a 16:9 card would crop it, so picks can be judged by eye.
//
// Credentials come from the environment only. The script prints no secret,
// token or header; it writes one HTML file that holds only public image URLs
// and metadata, outside the repository by default.

import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  artCandidates,
  ART_RULES,
  rankArt,
  selectArt,
  suitable,
} from "../src/lib/providers/igdb/art.ts";
import { artOverrideFor } from "../src/lib/providers/igdb/art-overrides.ts";
import { createIgdbClient } from "../src/lib/providers/igdb/client.ts";
import { createIgdbProvider } from "../src/lib/providers/igdb/provider.ts";
import { igdbImage, pickArt } from "../src/lib/providers/igdb/image.ts";
import { ART_FIELDS, idList, where } from "../src/lib/providers/igdb/query.ts";
import { createFetchTransport } from "../src/lib/providers/igdb/server/fetch-transport.ts";
import { createTwitchTokenSource } from "../src/lib/providers/igdb/server/twitch-auth.ts";

// The Discovery heroes and cards the Stage 4A review looked at.
const DEFAULT_IDS = [1020, 119171, 25076, 1877, 1942, 119133, 17269, 225582];

const args = process.argv.slice(2);
const outAt = args.indexOf("--out");
const out = outAt >= 0 ? args[outAt + 1] : join(tmpdir(), "nexa-igdb-art-sheet.html");
const ids = args.filter((a, i) => /^\d+$/.test(a) && i !== outAt + 1).map(Number);
const picksOnly = args.includes("--picks");
const sectionAt = args.indexOf("--section");
const section = sectionAt >= 0 ? args[sectionAt + 1] : null;

const tokens = createTwitchTokenSource({
  clientId: process.env.TWITCH_CLIENT_ID ?? "",
  clientSecret: process.env.TWITCH_CLIENT_SECRET ?? "",
  fetchImpl: (url, init) => fetch(url, init),
});
if (!tokens.configured()) {
  console.error("Set TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET in the environment.");
  process.exit(2);
}
const igdb = createIgdbClient({
  transport: createFetchTransport({ tokens, fetchImpl: (url, init) => fetch(url, init) }),
  isOffline: () => false,
});

const TYPE_NAMES = {
  1: "artwork",
  2: "key art without logo",
  3: "key art with logo",
  4: "concept art",
  5: "logo (white)",
  6: "logo (black)",
  7: "logo (color)",
  8: "infographic",
  9: "alternative cover",
  10: "historical cover",
  11: "square cover",
  12: "icon",
  13: "historical logo",
  14: "historical icon",
  15: "historical artwork",
};

const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

function why(c, use) {
  if (suitable(c, use)) return "ok";
  if (c.alpha) return "transparent";
  if (c.animated) return "animated";
  if (c.kind === "artwork" && [5, 6, 7, 8, 9, 10, 11, 12, 13, 14].includes(c.artworkType))
    return "type";
  if (!c.width || !c.height) return "no size";
  const r = c.width / c.height;
  const rule = ART_RULES[use];
  if (r < rule.minRatio || r > rule.maxRatio) return `ratio ${r.toFixed(2)}`;
  return `width ${c.width}`;
}

function tile(c, labels = []) {
  const whole = igdbImage(c.imageId, "720p");
  const card = igdbImage(c.imageId, "screenshot_med");
  const ratio = c.width && c.height ? (c.width / c.height).toFixed(2) : "?";
  const type =
    c.kind === "screenshot" ? "screenshot" : (TYPE_NAMES[c.artworkType] ?? `type ${c.artworkType}`);
  const tags = labels.map((l) => `<b class="tag">${esc(l)}</b>`).join("");
  return `<figure class="${labels.length ? "picked" : ""}">
    <div class="whole"><img loading="lazy" src="${whole}"></div>
    <div class="card"><img loading="lazy" src="${card}"></div>
    <figcaption>${tags}<span>${esc(type)}</span> · ${c.width ?? "?"}×${c.height ?? "?"} (${ratio})${c.alpha ? " · alpha" : ""}<br>
    <code>${esc(c.kind)}:${esc(c.imageId)}</code> · hero ${esc(why(c, "hero"))} · card ${esc(why(c, "card"))}</figcaption>
  </figure>`;
}

let list;
if (section) {
  const page = await createIgdbProvider(igdb, "sheet").list({ section }, 1, 20);
  list = page.items.map((g) => Number(g.id.slice("igdb:".length)));
} else {
  list = idList(ids.length > 0 ? ids : DEFAULT_IDS);
}
const games = await igdb.query("games", {
  fields: ["name", "cover.image_id", ...ART_FIELDS],
  where: [where.anyOf("id", list)],
  limit: list.length,
});

const sections = [];
let warnings = 0;
const compact = [];
for (const id of list) {
  const raw = games.find((g) => g.id === id);
  if (!raw) {
    sections.push(`<section><h2>igdb:${id}</h2><p>Not found.</p></section>`);
    continue;
  }
  const candidates = artCandidates(raw);
  const override = artOverrideFor(`igdb:${id}`);
  const hero = selectArt(candidates, "hero", override?.hero);
  const card = selectArt(candidates, "card", override?.card);
  // Every override must name one of this game's own, usable images.
  for (const use of ["hero", "card"]) {
    const ref = override?.[use];
    const chosen = use === "hero" ? hero : card;
    if (ref && chosen?.imageId !== ref.imageId) {
      console.warn(
        `igdb:${id} ${use} override ${ref.kind}:${ref.imageId} is not applied (not this game's or unusable).`,
      );
      warnings += 1;
    }
  }
  const before = pickArt(raw);
  const beforeTile = before
    ? `<figure class="before"><div class="whole"><img src="${before.url}"></div><div class="card"><img src="${igdbImage(before.url.match(/\/([a-z0-9]+)\.jpg$/)[1], "screenshot_med")}"></div><figcaption><b class="tag old">Stage 4 pick</b> ${esc(before.kind)}</figcaption></figure>`
    : "<p>No Stage 4 pick.</p>";
  const label = (c) => [
    ...(hero && c.imageId === hero.imageId ? ["HERO"] : []),
    ...(card && c.imageId === card.imageId ? ["CARD"] : []),
  ];
  const ranked = new Set(rankArt(candidates, "card").map((c) => c.imageId));
  const small = (imageId) => igdbImage(imageId, "screenshot_med");
  const oldId = before?.url.match(/\/([a-z0-9]+)\.jpg$/)?.[1];
  compact.push(`<figure class="mini"><figcaption><b>${esc(raw.name)}</b> <code>igdb:${id}</code>${override ? " · override" : ""}</figcaption>
    <div class="pair"><div><span>Stage 4</span>${oldId ? `<img src="${small(oldId)}">` : "—"}</div>
    <div><span>card</span>${card ? `<img src="${small(card.imageId)}">` : "cover"}</div>
    <div><span>hero</span>${hero ? `<img src="${small(hero.imageId)}">` : "none"}</div></div></figure>`);
  sections.push(`<section>
    <h2>${esc(raw.name)} <small>igdb:${id} · ${candidates.length} candidates · ${ranked.size} usable on cards${override ? ` · override: ${esc(override.note)}` : ""}</small></h2>
    <div class="row">${beforeTile}${hero ? tile(hero, ["NEW HERO"]) : "<p>No hero-quality image.</p>"}${card ? tile(card, ["NEW CARD"]) : "<p>No card image.</p>"}</div>
    ${
      picksOnly
        ? ""
        : `<h3>Artworks</h3><div class="grid">${
            candidates
              .filter((c) => c.kind === "artwork")
              .map((c) => tile(c, label(c)))
              .join("") || "<p>None.</p>"
          }</div>
    <h3>Screenshots</h3><div class="grid">${
      candidates
        .filter((c) => c.kind === "screenshot")
        .map((c) => tile(c, label(c)))
        .join("") || "<p>None.</p>"
    }</div>`
    }
  </section>`);
}

const html = `<!doctype html><meta charset="utf-8"><title>IGDB art candidates</title>
<style>
body{background:#111;color:#ddd;font:13px system-ui;margin:24px}
section{margin-bottom:48px;border-top:1px solid #333;padding-top:16px}
h2 small{color:#888;font-weight:400;font-size:12px}
.row,.grid{display:flex;flex-wrap:wrap;gap:14px}
figure{margin:0;width:300px;background:#1b1b1b;border-radius:8px;overflow:hidden;border:2px solid transparent}
figure.picked{border-color:#3b82f6}
.whole{height:170px;background:#000;display:flex;align-items:center;justify-content:center}
.whole img{max-width:100%;max-height:100%}
.card{aspect-ratio:16/9;overflow:hidden;border-top:1px solid #333}
.card img{width:100%;height:100%;object-fit:cover}
figcaption{padding:6px 8px;line-height:1.5}
code{color:#9ad}
.tag{background:#3b82f6;color:#fff;border-radius:4px;padding:0 5px;margin-right:4px}
.tag.old{background:#a33}
figure.mini{width:460px}.pair{display:flex;gap:4px;padding:0 4px 6px}.pair div{flex:1;font-size:11px;color:#888}
.pair img{width:100%;aspect-ratio:16/9;object-fit:cover;display:block}
</style>
<h1>IGDB art candidates</h1>
<p>Top image: whole (CDN 720p, aspect kept). Bottom: the 16:9 card crop. Generated ${esc(new Date().toISOString())}.</p>
${section ? `<h2>Row: ${esc(section)}</h2><div class="grid">${compact.join("")}</div>` : sections.join("\n")}`;
writeFileSync(out, html);
console.log(`Wrote ${out} (${list.length} games, ${warnings} override warnings).`);
if (warnings > 0) process.exitCode = 1;
