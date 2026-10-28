// Dev-only RAWG checks. Not run in CI. Never prints the key or a full URL.
//
//   RAWG_API_KEY=... node scripts/rawg-dev-check.mjs endpoints
//     Probes every endpoint Games uses (and the paid ones it deliberately
//     doesn't) with your key, so we know what a free key actually gets.
//
//   RAWG_API_KEY=... node scripts/rawg-dev-check.mjs franchises
//     Validates the curated franchise catalog against RAWG.

const BASE = "https://api.rawg.io/api";
const key = (process.env.RAWG_API_KEY ?? "").trim();
const mode = process.argv[2];

if (!key) {
  console.error("Set RAWG_API_KEY in the environment.");
  process.exit(2);
}

async function get(path, params = {}) {
  const search = new URLSearchParams({ ...params, key });
  try {
    const res = await fetch(`${BASE}${path}?${search}`, { redirect: "manual" });
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  } catch {
    // The error text can contain the URL (and so the key): don't print it.
    return { status: null, body: null };
  }
}

function describe(result) {
  if (result.status === null) return "network error";
  const count = Array.isArray(result.body?.results)
    ? ` · ${result.body.results.length} results`
    : "";
  return `HTTP ${result.status}${count}`;
}

async function endpoints() {
  const game = "3328"; // The Witcher 3: Wild Hunt
  const addition = "the-witcher-3-wild-hunt-blood-and-wine";
  const used = [
    ["/genres", { page_size: 1 }],
    ["/games", { page_size: 1, ordering: "-added" }],
    ["/games", { page_size: 1, search: "witcher", search_precise: true }],
    [`/games/${game}`, {}],
    [`/games/${game}/screenshots`, { page_size: 1 }],
    [`/games/${game}/game-series`, { page_size: 1 }],
    [`/games/${game}/additions`, { page_size: 1 }],
    [`/games/${addition}/parent-games`, { page_size: 1 }],
  ];
  const notUsed = [
    [`/games/${game}/stores`, {}, "Business plan per RAWG pricing ('Where to buy links')"],
    [`/games/${game}/suggested`, {}, "Business plan ('Similar games')"],
    [`/games/${game}/movies`, {}, "Business plan (videos)"],
  ];
  let failures = 0;
  console.log("Endpoints used by Games:");
  for (const [path, params] of used) {
    const result = await get(path, params);
    const ok = result.status === 200;
    if (!ok) failures++;
    console.log(`  ${ok ? "OK  " : "FAIL"} ${path.padEnd(52)} ${describe(result)}`);
  }
  console.log("\nNot used (reported for reference only):");
  for (const [path, params, note] of notUsed) {
    const result = await get(path, params);
    console.log(`  --   ${path.padEnd(52)} ${describe(result)}  (${note})`);
  }
  const detail = await get(`/games/${game}`);
  if (detail.status === 200) {
    const b = detail.body ?? {};
    console.log("\nDetail fields present:");
    for (const field of [
      "description_raw",
      "background_image_additional",
      "metacritic",
      "esrb_rating",
      "developers",
      "publishers",
      "game_series_count",
      "additions_count",
      "parents_count",
      "screenshots_count",
    ]) {
      console.log(`  ${field.padEnd(30)} ${field in b ? "yes" : "MISSING"}`);
    }
  }
  if (failures) {
    console.log(`\n${failures} used endpoint(s) failed: hide those sections for free keys.`);
    process.exitCode = 1;
  }
}

async function franchises() {
  const { FRANCHISES } = await import("../src/lib/game-discovery/franchises.ts");
  const EDITION_HINT =
    /\b(edition|remaster(ed)?|definitive|goty|complete|collection|bundle|pack|dlc|season pass|soundtrack|demo|expansion)\b/i;
  let problems = 0;
  for (const franchise of FRANCHISES) {
    console.log(`\n${franchise.name} (${franchise.id})`);
    const curated = new Set([
      franchise.artwork,
      ...franchise.mainline,
      ...Object.keys(franchise.variants ?? {}),
    ]);
    const resolved = new Map();
    for (const slug of curated) {
      const result = await get(`/games/${slug}`);
      if (result.status === 200 && result.body?.redirect) {
        console.log(`  REDIRECT ${slug} -> ${result.body.slug}`);
        problems++;
      } else if (result.status !== 200) {
        console.log(`  MISSING  ${slug} (${describe(result)})`);
        problems++;
      } else {
        resolved.set(slug, result.body);
      }
    }
    const anchor = franchise.seriesAnchor ?? franchise.artwork;
    const seriesSlugs = new Set([anchor]);
    const series = [];
    for (let page = 1; page <= 3; page++) {
      const result = await get(`/games/${anchor}/game-series`, { page, page_size: 40 });
      if (result.status !== 200) {
        console.log(`  SERIES   ${anchor}: ${describe(result)}`);
        problems++;
        break;
      }
      for (const game of result.body.results ?? []) {
        seriesSlugs.add(game.slug);
        series.push(game);
      }
      if (!result.body.next) break;
    }
    for (const slug of franchise.mainline) {
      if (!seriesSlugs.has(slug))
        console.log(`  EXTRA    ${slug} not in RAWG series (costs 1 request at runtime)`);
    }
    const known = new Set([...curated, ...(franchise.exclude ?? [])]);
    for (const game of series) {
      if (known.has(game.slug)) continue;
      const hint = EDITION_HINT.test(game.name) ? "  <- looks like an edition/DLC" : "";
      console.log(`  UNCLASSIFIED ${game.slug} (${game.released ?? "TBA"})${hint}`);
    }
  }
  console.log(problems ? `\n${problems} problem(s) found.` : "\nCatalog OK.");
  if (problems) process.exitCode = 1;
}

if (mode === "endpoints") await endpoints();
else if (mode === "franchises") await franchises();
else {
  console.error("Usage: node scripts/rawg-dev-check.mjs <endpoints|franchises>");
  process.exit(2);
}
