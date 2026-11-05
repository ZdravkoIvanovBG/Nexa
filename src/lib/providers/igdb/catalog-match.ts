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
  /** Other candidates worth showing a reviewer. */
  candidates: CatalogCandidate[];
  notes: string[];
};

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
    others: CatalogCandidate[],
  ): CatalogMatch => {
    if (match) {
      if (match.versionParent !== null) notes.push("IGDB lists it as an edition of another game");
      const role = entry.role;
      const t = match.gameType;
      if (role === "main" && t !== null && t !== 0) notes.push(`IGDB game_type is ${typeName(t)}`);
      if (role === "remake" && t !== 8) notes.push(`curated as remake; IGDB says ${typeName(t)}`);
      if (role === "remaster" && t !== 9) {
        notes.push(`curated as remaster; IGDB says ${typeName(t)}`);
      }
    }
    return { entry, status, match, candidates: others, notes };
  };

  if (all.length === 0) return result("missing", null, []);

  const nowYear = options.nowYear;
  for (const tier of [tier1, tier2]) {
    const exact = tier.filter((c) => yearDistance(entry, c, nowYear) === 0);
    // Prefer non-editions when an edition and its base game share a key and year.
    const base = exact.filter((c) => c.versionParent === null);
    const pick = base.length > 0 ? base : exact;
    if (pick.length === 1) {
      return result(
        "matched",
        pick[0],
        all.filter((c) => c !== pick[0]),
      );
    }
    if (pick.length > 1) return result("ambiguous", null, pick);
  }
  for (const tier of [tier1, tier2]) {
    const near = tier.filter((c) => yearDistance(entry, c, nowYear) === 1);
    if (near.length === 1) {
      notes.push(`IGDB year ${near[0].year ?? "TBA"}, curated ${entry.expectedYear ?? "TBA"}`);
      return result(
        "near_year",
        near[0],
        all.filter((c) => c !== near[0]),
      );
    }
    if (near.length > 1) return result("ambiguous", null, near);
  }
  return result("year_mismatch", null, all);
}
