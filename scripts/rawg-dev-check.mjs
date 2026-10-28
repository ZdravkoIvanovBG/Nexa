// Dev-only RAWG checks. Not run in CI. Never prints the key or a full URL.
//
//   RAWG_API_KEY=... node scripts/rawg-dev-check.mjs endpoints
//     Probes every endpoint Games uses (and the paid ones it deliberately
//     doesn't) with your key, so we know what a free key actually gets.
//
//   RAWG_API_KEY=... node scripts/rawg-dev-check.mjs franchises
//     Validates the curated franchise catalog against RAWG: what each curated
//     slug resolves to (id, name, year; redirects followed), year mismatches,
//     duplicates and unclassified series members. Options: --franchise <id>,
//     --verbose (also print slugs that check out).

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

let requestCount = 0;

async function counted(path, params) {
  requestCount++;
  return get(path, params);
}

function yearOf(released) {
  return typeof released === "string" && /^\d{4}/.test(released)
    ? Number(released.slice(0, 4))
    : null;
}

function label(game) {
  return `[${game.id}] ${game.name} (${game.released ?? "TBA"})`;
}

/** Resolve one curated slug, following RAWG's slug redirect once (as the app does). */
async function resolveSlug(slug) {
  const first = await counted(`/games/${slug}`);
  if (
    first.status === 200 &&
    first.body?.redirect === true &&
    typeof first.body.slug === "string"
  ) {
    const target = first.body.slug;
    const second = await counted(`/games/${target}`);
    if (second.status === 200 && second.body?.id)
      return { kind: "redirect", target, game: second.body };
    return { kind: "missing", detail: `redirects to ${target}, which is ${describe(second)}` };
  }
  if (first.status === 200 && first.body?.id) return { kind: "ok", game: first.body };
  return { kind: "missing", detail: describe(first) };
}

async function franchises() {
  const { FRANCHISES, curatedSlugs } = await import("../src/lib/game-discovery/franchises.ts");
  const only = process.argv.includes("--franchise")
    ? process.argv[process.argv.indexOf("--franchise") + 1]
    : null;
  const verbose = process.argv.includes("--verbose");
  const EDITION_HINT =
    /\b(edition|remaster(ed)?|definitive|goty|complete|collection|bundle|pack|dlc|season pass|soundtrack|demo|expansion|chapter|episode)\b/i;
  let problems = 0;
  const problem = (line) => {
    problems++;
    console.log(line);
  };

  for (const franchise of FRANCHISES) {
    if (only && franchise.id !== only) continue;
    console.log(`\n== ${franchise.name} (${franchise.id})`);
    const variants = franchise.variants ?? {};
    const curated = [...new Set([franchise.artwork, ...curatedSlugs(franchise)])];
    const resolvedIds = new Map(); // rawg id -> curated slug
    let anchorId = null;
    for (const slug of curated) {
      const role = franchise.mainline.includes(slug) ? "main" : (variants[slug] ?? "artwork");
      const expected = franchise.years[slug];
      const r = await resolveSlug(slug);
      if (r.kind === "missing") {
        problem(`  MISSING    ${slug} [${role}] -> ${r.detail}; expected ${expected ?? "?"}`);
        continue;
      }
      const year = yearOf(r.game.released);
      const yearOk =
        expected === undefined ? null : year !== null && Math.abs(year - expected) <= 1;
      const yearNote =
        expected === undefined
          ? "NO EXPECTED YEAR"
          : yearOk
            ? "year ok"
            : `YEAR MISMATCH, expected ${expected}`;
      if (r.kind === "redirect") {
        problem(`  REDIRECT   ${slug} [${role}] -> ${r.target} ${label(r.game)}  ${yearNote}`);
      } else if (expected === undefined || !yearOk) {
        problem(`  CHECK      ${slug} [${role}] ${label(r.game)}  ${yearNote}`);
      } else if (verbose) {
        console.log(`  ok         ${slug} [${role}] ${label(r.game)}`);
      }
      const dup = resolvedIds.get(r.game.id);
      if (dup && dup !== slug)
        problem(`  DUPLICATE  ${slug} and ${dup} are the same RAWG game ${label(r.game)}`);
      resolvedIds.set(r.game.id, slug);
      if (slug === (franchise.seriesAnchor ?? franchise.artwork)) anchorId = r.game.id;
    }

    if (anchorId === null) {
      problem("  SERIES     anchor did not resolve; series not checked");
      continue;
    }
    const series = [];
    for (let page = 1; page <= 3; page++) {
      const result = await counted(`/games/${anchorId}/game-series`, { page, page_size: 40 });
      if (result.status !== 200) {
        problem(`  SERIES     ${describe(result)}`);
        break;
      }
      series.push(...(result.body.results ?? []));
      if (!result.body.next) break;
    }
    const seriesSlugs = new Set(series.map((g) => g.slug));
    const seriesIds = new Set(series.map((g) => g.id));
    for (const slug of curatedSlugs(franchise)) {
      // The anchor is fetched directly; RAWG never lists it in its own series.
      if (seriesSlugs.has(slug) || slug === (franchise.seriesAnchor ?? franchise.artwork)) continue;
      const id = [...resolvedIds].find(([, s]) => s === slug)?.[0];
      if (id !== undefined && seriesIds.has(id)) {
        const canonical = series.find((g) => g.id === id).slug;
        console.log(
          `  EXTRA      ${slug}: in RAWG's series as "${canonical}"; use that slug to save a lookup`,
        );
      } else if (id !== undefined) {
        console.log(`  EXTRA      ${slug}: not in RAWG's series; costs 1 lookup at runtime`);
      }
    }
    const excluded = new Set(franchise.exclude ?? []);
    for (const game of series) {
      if (resolvedIds.has(game.id) || excluded.has(game.slug)) continue;
      const hint = EDITION_HINT.test(game.name) ? "  <- edition/DLC?" : "";
      console.log(`  UNCLASSIFIED ${game.slug} ${label(game)}${hint}`);
    }
    for (const slug of excluded) {
      if (!seriesSlugs.has(slug))
        console.log(`  EXCLUDE    ${slug} is not in RAWG's series (no effect)`);
    }
  }
  console.log(
    `\n${problems ? `${problems} problem(s) found.` : "Catalog OK."} ${requestCount} RAWG requests used.`,
  );
  if (problems) process.exitCode = 1;
}

if (mode === "endpoints") await endpoints();
else if (mode === "franchises") await franchises();
else {
  console.error(
    "Usage: node scripts/rawg-dev-check.mjs endpoints | franchises [--franchise <id>] [--verbose]",
  );
  process.exit(2);
}
