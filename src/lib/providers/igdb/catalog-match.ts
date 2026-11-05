// Matches curated catalog entries (RAWG slugs plus expected release years) to
// IGDB candidates, for the Stage 1 data-quality comparison and, later, for
// generating a reviewed IGDB mapping. Pure and deterministic.
//
// A title key alone never decides a match: same-named games (God of War 2005
// and 2018, Resident Evil 2 1998 and 2019) only separate by year. Results are
// advisory. Anything other than `matched` needs a human to look at it.

export type CatalogCandidate = {
  igdbId: number;
  slug: string;
  name: string;
  year: number | null;
  gameType: number | null;
  versionParent: number | null;
};

export type CatalogEntry = {
  slug: string;
  role: "main" | "remake" | "remaster" | "spinoff" | "edition";
  /** Expected year; null means expected unreleased / TBA. */
  expectedYear: number | null | undefined;
};

export type CatalogMatchStatus =
  | "matched"
  | "near_year"
  | "year_mismatch"
  | "ambiguous"
  | "missing";

export type CatalogMatch = {
  entry: CatalogEntry;
  status: CatalogMatchStatus;
  /** The chosen candidate for matched / near_year. */
  match: CatalogCandidate | null;
  /**
   * Same title and year as the match, but a worse fit for the curated role:
   * ports, editions, bundles and similar duplicates IGDB lists separately.
   * Reported so every resolution can be checked by a person.
   */
  passedOver: CatalogCandidate[];
  /** Other candidates worth showing a reviewer. */
  candidates: CatalogCandidate[];
  notes: string[];
};

// IGDB game_type ids (verified live on 2026-11-05; see scripts/igdb-dev-check.mjs fields).
const T = {
  main: 0,
  dlc: 1,
  expansion: 2,
  bundle: 3,
  standalone: 4,
  remake: 8,
  remaster: 9,
  expanded: 10,
  port: 11,
} as const;

/**
 * How well each IGDB game type fits a curated role, best first. Types not
 * listed (DLC, packs, mods, updates, seasons...) never win while a listed
 * type is available. Editions (`version_parent` set) are ranked separately.
 */
const ROLE_TYPE_PREFERENCE: Record<CatalogEntry["role"], readonly number[]> = {
  main: [T.main, T.standalone, T.expanded, T.remake, T.remaster, T.bundle, T.port],
  spinoff: [T.main, T.standalone, T.expanded, T.remake, T.remaster, T.port, T.bundle],
  remake: [T.remake, T.main, T.expanded, T.remaster, T.port, T.bundle],
  remaster: [T.remaster, T.expanded, T.main, T.bundle, T.remake, T.port],
  edition: [T.expanded, T.bundle, T.main, T.remaster, T.port],
};

const UNLISTED_RANK = 50;
const EDITION_PENALTY = 20;

/** Lower is a better fit for the curated role. */
export function roleFit(role: CatalogEntry["role"], candidate: CatalogCandidate): number {
  const isEdition = candidate.versionParent !== null;
  const order = ROLE_TYPE_PREFERENCE[role];
  const index = candidate.gameType === null ? -1 : order.indexOf(candidate.gameType);
  const typeRank = index === -1 ? UNLISTED_RANK : index;
  if (role === "edition") return isEdition ? 0 : typeRank + 1;
  return isEdition ? typeRank + EDITION_PENALTY : typeRank;
}

const ROMAN: Record<string, string> = {
  ii: "2",
  iii: "3",
  iv: "4",
  v: "5",
  vi: "6",
  vii: "7",
  viii: "8",
  ix: "9",
  x: "10",
  xi: "11",
  xii: "12",
  xiii: "13",
};

/** Lowercase dash key with roman numerals II–XIII turned into digits. */
export function titleKey(text: string): string {
  const base = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base
    .split("-")
    .map((token) => ROMAN[token] ?? token)
    .join("-");
}

/**
 * Keys for a curated RAWG slug: tier 1 is the slug itself, tier 2 drops one
 * trailing number (RAWG's "-2" disambiguators and "-1998" year suffixes).
 */
export function curatedKeys(slug: string): { exact: string; loose: string | null } {
  const exact = titleKey(slug);
  const stripped = exact.replace(/-\d+$/, "");
  return { exact, loose: stripped && stripped !== exact ? stripped : null };
}

/** Keys for an IGDB candidate: its slug (minus IGDB's "--N" suffix) and its name. */
export function candidateKeys(candidate: Pick<CatalogCandidate, "slug" | "name">): Set<string> {
  const keys = new Set<string>();
  const slug = candidate.slug.replace(/--\d+$/, "");
  keys.add(titleKey(slug));
  keys.add(titleKey(candidate.name));
  return keys;
}

function yearDistance(entry: CatalogEntry, candidate: CatalogCandidate, nowYear: number): number {
  if (entry.expectedYear === undefined) return 0;
  if (entry.expectedYear === null) {
    // Expected unreleased: no date, or a date in the future, counts as exact.
    return candidate.year === null || candidate.year > nowYear ? 0 : 99;
  }
  if (candidate.year === null) return 99;
  return Math.abs(candidate.year - entry.expectedYear);
}

export function describeCandidate(c: CatalogCandidate): string {
  return `[igdb ${c.igdbId}] ${c.name} (${c.year ?? "TBA"}) ${c.slug}`;
}

export function matchCatalogEntry(
  entry: CatalogEntry,
  pool: readonly CatalogCandidate[],
  options: { nowYear: number; typeName?: (id: number | null) => string },
): CatalogMatch {
  const keys = curatedKeys(entry.slug);
  const typeName = options.typeName ?? ((id: number | null) => String(id));
  const tier1: CatalogCandidate[] = [];
  const tier2: CatalogCandidate[] = [];
  const seen = new Set<number>();
  for (const candidate of pool) {
    if (seen.has(candidate.igdbId)) continue;
    const ck = candidateKeys(candidate);
    if (ck.has(keys.exact)) {
      tier1.push(candidate);
      seen.add(candidate.igdbId);
    } else if (keys.loose && ck.has(keys.loose)) {
      tier2.push(candidate);
      seen.add(candidate.igdbId);
    }
  }
  const all = [...tier1, ...tier2];
  const notes: string[] = [];
  const result = (
    status: CatalogMatchStatus,
    match: CatalogCandidate | null,
    group: CatalogCandidate[],
  ): CatalogMatch => {
    if (match) {
      if (match.versionParent !== null) notes.push("IGDB lists it as an edition of another game");
      const role = entry.role;
      const t = match.gameType;
      if ((role === "main" || role === "spinoff") && t !== null && t !== T.main) {
        notes.push(`IGDB game_type is ${typeName(t)}`);
      }
      if (role === "remake" && t !== T.remake) {
        notes.push(`curated as remake; IGDB says ${typeName(t)}`);
      }
      if (role === "remaster" && t !== T.remaster) {
        notes.push(`curated as remaster; IGDB says ${typeName(t)}`);
      }
    }
    const passedOver = match ? group.filter((c) => c !== match) : [];
    const candidates = match ? all.filter((c) => c !== match && !passedOver.includes(c)) : group;
    return { entry, status, match, passedOver, candidates, notes };
  };

  if (all.length === 0) return result("missing", null, []);

  // Among same-title, same-year candidates, pick the one whose game type best
  // fits the curated role. A tie at the best fit is genuine ambiguity: report
  // it rather than choose.
  const choose = (status: "matched" | "near_year", group: CatalogCandidate[]) => {
    const ranked = group.map((c) => ({ c, fit: roleFit(entry.role, c) }));
    const best = Math.min(...ranked.map((r) => r.fit));
    const winners = ranked.filter((r) => r.fit === best).map((r) => r.c);
    if (winners.length > 1) return result("ambiguous", null, winners);
    if (best >= UNLISTED_RANK) notes.push("only DLC, packs or similar records match");
    return result(status, winners[0], group);
  };

  const nowYear = options.nowYear;
  for (const tier of [tier1, tier2]) {
    const exact = tier.filter((c) => yearDistance(entry, c, nowYear) === 0);
    if (exact.length > 0) return choose("matched", exact);
  }
  for (const tier of [tier1, tier2]) {
    const near = tier.filter((c) => yearDistance(entry, c, nowYear) === 1);
    if (near.length > 0) {
      const outcome = choose("near_year", near);
      if (outcome.match) {
        outcome.notes.push(
          `IGDB year ${outcome.match.year ?? "TBA"}, curated ${entry.expectedYear ?? "TBA"}`,
        );
      }
      return outcome;
    }
  }
  return result("year_mismatch", null, all);
}
