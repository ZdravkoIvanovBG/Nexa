// Curated franchise catalog. Names and classification are ours; all game data
// comes from RAWG at runtime. Entries are RAWG slugs used purely as lookup ids.
//
// Verify after any edit (needs a RAWG key, prints no secrets):
//   RAWG_API_KEY=... node scripts/rawg-dev-check.mjs franchises
// For every curated slug it prints the RAWG id, name and release year it
// resolves to (following redirects) and flags years that don't match `years`
// -- which is how a slug pointing at the wrong same-named game is caught.
// It also lists series members we haven't classified.
//
// Mainline lists are in release order. Same-named games (God of War 2005 vs
// 2018, Tomb Raider 1996 vs 2013, Modern Warfare 2007 vs 2019) are distinct
// RAWG ids; the resolver never merges by name. `chronology` is only set when a
// reliable story order has been curated; none ship yet.

export type FranchiseVariant = "remake" | "remaster" | "spinoff" | "edition";

export type FranchiseDef = {
  /** Stable id; future wishlist/library entries key on it. */
  id: string;
  name: string;
  /** RAWG slug whose background image is the franchise art; default series anchor. */
  artwork: string;
  /** RAWG slug used for /game-series lookups (defaults to `artwork`). */
  seriesAnchor?: string;
  mainline: string[];
  variants?: Record<string, FranchiseVariant>;
  /**
   * Expected first-release year of every curated slug. Not used at runtime:
   * the dev check compares it with RAWG to confirm each slug is the intended game.
   */
  years: Record<string, number>;
  /** RAWG slugs to hide: DLC, unrelated games RAWG lists in the series, duplicate records. */
  exclude?: string[];
  chronology?: string[];
  description?: string;
};

export const FRANCHISES: FranchiseDef[] = [
  {
    id: "assassins-creed",
    name: "Assassin's Creed",
    artwork: "assassins-creed-valhalla",
    mainline: [
      "assassins-creed",
      "assassins-creed-ii",
      "assassins-creed-brotherhood",
      "assassins-creed-revelations",
      "assassins-creed-iii",
      "assassins-creed-iv-black-flag",
      "assassins-creed-unity",
      "assassins-creed-syndicate",
      "assassins-creed-origins",
      "assassins-creed-odyssey",
      "assassins-creed-valhalla",
      "assassins-creed-mirage",
      "assassins-creed-shadows",
    ],
    variants: {
      "assassins-creed-iii-liberation": "spinoff",
      "assassins-creed-rogue": "spinoff",
      "assassins-creed-iii-remastered": "remaster",
    },
    years: {
      "assassins-creed": 2007,
      "assassins-creed-ii": 2009,
      "assassins-creed-brotherhood": 2010,
      "assassins-creed-revelations": 2011,
      "assassins-creed-iii": 2012,
      "assassins-creed-iv-black-flag": 2013,
      "assassins-creed-unity": 2014,
      "assassins-creed-syndicate": 2015,
      "assassins-creed-origins": 2017,
      "assassins-creed-odyssey": 2018,
      "assassins-creed-valhalla": 2020,
      "assassins-creed-mirage": 2023,
      "assassins-creed-shadows": 2025,
      "assassins-creed-iii-liberation": 2012,
      "assassins-creed-rogue": 2014,
      "assassins-creed-iii-remastered": 2019,
    },
  },
  {
    id: "far-cry",
    name: "Far Cry",
    artwork: "far-cry-5",
    // far-cry-2 redirects to RAWG's Fortune's Edition record (the same game
    // re-released with its DLC). Runtime follows the redirect; switch to the
    // canonical slug once the dev check confirms its id and year.
    mainline: ["far-cry", "far-cry-2", "far-cry-3", "far-cry-4", "far-cry-5", "far-cry-6"],
    variants: {
      "far-cry-3-blood-dragon": "spinoff",
      "far-cry-primal": "spinoff",
      "far-cry-new-dawn": "spinoff",
    },
    years: {
      "far-cry": 2004,
      "far-cry-2": 2008,
      "far-cry-3": 2012,
      "far-cry-4": 2014,
      "far-cry-5": 2018,
      "far-cry-6": 2021,
      "far-cry-3-blood-dragon": 2013,
      "far-cry-primal": 2016,
      "far-cry-new-dawn": 2019,
    },
  },
  {
    id: "grand-theft-auto",
    name: "Grand Theft Auto",
    artwork: "grand-theft-auto-v",
    mainline: [
      "grand-theft-auto",
      "grand-theft-auto-2",
      "grand-theft-auto-iii",
      "grand-theft-auto-vice-city",
      "grand-theft-auto-san-andreas",
      "grand-theft-auto-iv",
      "grand-theft-auto-v",
    ],
    // The Trilogy – Definitive Edition slug returned 404; re-add with its real
    // slug once the dev check lists it.
    variants: {
      "grand-theft-auto-liberty-city-stories": "spinoff",
      "grand-theft-auto-vice-city-stories": "spinoff",
      "grand-theft-auto-chinatown-wars": "spinoff",
    },
    years: {
      "grand-theft-auto": 1997,
      "grand-theft-auto-2": 1999,
      "grand-theft-auto-iii": 2001,
      "grand-theft-auto-vice-city": 2002,
      "grand-theft-auto-san-andreas": 2004,
      "grand-theft-auto-iv": 2008,
      "grand-theft-auto-v": 2013,
      "grand-theft-auto-liberty-city-stories": 2005,
      "grand-theft-auto-vice-city-stories": 2006,
      "grand-theft-auto-chinatown-wars": 2009,
    },
  },
  {
    id: "red-dead",
    name: "Red Dead Redemption",
    artwork: "red-dead-redemption-2",
    mainline: ["red-dead-revolver", "red-dead-redemption", "red-dead-redemption-2"],
    years: {
      "red-dead-revolver": 2004,
      "red-dead-redemption": 2010,
      "red-dead-redemption-2": 2018,
    },
  },
  {
    id: "the-witcher",
    name: "The Witcher",
    artwork: "the-witcher-3-wild-hunt",
    mainline: [
      "the-witcher-enhanced-edition-directors-cut",
      "the-witcher-2-assassins-of-kings-enhanced-edition",
      "the-witcher-3-wild-hunt",
    ],
    variants: {
      "thronebreaker-the-witcher-tales": "spinoff",
    },
    years: {
      "the-witcher-enhanced-edition-directors-cut": 2007,
      "the-witcher-2-assassins-of-kings-enhanced-edition": 2011,
      "the-witcher-3-wild-hunt": 2015,
      "thronebreaker-the-witcher-tales": 2018,
    },
  },
  {
    id: "resident-evil",
    name: "Resident Evil",
    artwork: "resident-evil-village",
    mainline: [
      "resident-evil",
      "resident-evil-2",
      "resident-evil-3-nemesis",
      "resident-evil-code-veronica",
      "resident-evil-4",
      "resident-evil-5",
      "resident-evil-6",
      "resident-evil-7-biohazard",
      "resident-evil-village",
    ],
    // resident-evil-revelations-2 resolved to Resident Evil (2002), not
    // Revelations 2, so it is removed until its real slug is confirmed.
    variants: {
      "resident-evil-revelations": "spinoff",
    },
    years: {
      "resident-evil": 1996,
      "resident-evil-2": 1998,
      "resident-evil-3-nemesis": 1999,
      "resident-evil-code-veronica": 2000,
      "resident-evil-4": 2005,
      "resident-evil-5": 2009,
      "resident-evil-6": 2012,
      "resident-evil-7-biohazard": 2017,
      "resident-evil-village": 2021,
      "resident-evil-revelations": 2012,
    },
  },
  {
    id: "tomb-raider",
    name: "Tomb Raider",
    artwork: "shadow-of-the-tomb-raider",
    // Tomb Raider III's slug returned 404; re-add with the slug of the
    // alternative record once the dev check confirms it is the 1998 game.
    mainline: [
      "tomb-raider-1996",
      "tomb-raider-ii",
      "tomb-raider-the-last-revelation",
      "tomb-raider-chronicles",
      "tomb-raider-the-angel-of-darkness",
      "tomb-raider-legend",
      "tomb-raider-underworld",
      "tomb-raider",
      "rise-of-the-tomb-raider",
      "shadow-of-the-tomb-raider",
    ],
    variants: {
      "tomb-raider-anniversary": "remake",
      "lara-croft-and-the-guardian-of-light": "spinoff",
      "lara-croft-and-the-temple-of-osiris": "spinoff",
    },
    years: {
      "tomb-raider-1996": 1996,
      "tomb-raider-ii": 1997,
      "tomb-raider-the-last-revelation": 1999,
      "tomb-raider-chronicles": 2000,
      "tomb-raider-the-angel-of-darkness": 2003,
      "tomb-raider-legend": 2006,
      "tomb-raider-underworld": 2008,
      "tomb-raider": 2013,
      "rise-of-the-tomb-raider": 2015,
      "shadow-of-the-tomb-raider": 2018,
      "tomb-raider-anniversary": 2007,
      "lara-croft-and-the-guardian-of-light": 2010,
      "lara-croft-and-the-temple-of-osiris": 2014,
    },
  },
  {
    id: "god-of-war",
    name: "God of War",
    artwork: "god-of-war-2",
    // `god-of-war` resolves to the 2005 original (dev check: 2005 release date);
    // `god-of-war-2` is expected to be the 2018 game and `god-of-war-ii` the
    // 2007 sequel -- `years` lets the dev check confirm that.
    mainline: [
      "god-of-war",
      "god-of-war-ii",
      "god-of-war-iii",
      "god-of-war-ascension",
      "god-of-war-2",
      "god-of-war-ragnarok",
    ],
    variants: {
      "god-of-war-chains-of-olympus": "spinoff",
      "god-of-war-ghost-of-sparta": "spinoff",
      "god-of-war-iii-remastered": "remaster",
    },
    years: {
      "god-of-war": 2005,
      "god-of-war-ii": 2007,
      "god-of-war-iii": 2010,
      "god-of-war-ascension": 2013,
      "god-of-war-2": 2018,
      "god-of-war-ragnarok": 2022,
      "god-of-war-chains-of-olympus": 2008,
      "god-of-war-ghost-of-sparta": 2010,
      "god-of-war-iii-remastered": 2015,
    },
  },
  {
    id: "battlefield",
    name: "Battlefield",
    artwork: "battlefield-1",
    // battlefield-2042 redirects to `battlefield-6`, a record released in 2021
    // (Battlefield 2042's year); the 2025 Battlefield 6 is `battlefield-6-2`.
    // `years` lets the dev check confirm both by name and date.
    mainline: [
      "battlefield-1942",
      "battlefield-2",
      "battlefield-2142",
      "battlefield-3",
      "battlefield-4",
      "battlefield-1",
      "battlefield-v",
      "battlefield-6",
      "battlefield-6-2",
    ],
    variants: {
      "battlefield-vietnam": "spinoff",
      "battlefield-bad-company": "spinoff",
      "battlefield-bad-company-2": "spinoff",
      "battlefield-hardline": "spinoff",
    },
    years: {
      "battlefield-1942": 2002,
      "battlefield-2": 2005,
      "battlefield-2142": 2006,
      "battlefield-3": 2011,
      "battlefield-4": 2013,
      "battlefield-1": 2016,
      "battlefield-v": 2018,
      "battlefield-6": 2021,
      "battlefield-6-2": 2025,
      "battlefield-vietnam": 2004,
      "battlefield-bad-company": 2008,
      "battlefield-bad-company-2": 2010,
      "battlefield-hardline": 2015,
    },
  },
  {
    id: "call-of-duty",
    name: "Call of Duty",
    artwork: "call-of-duty-modern-warfare",
    mainline: [
      "call-of-duty",
      "call-of-duty-2",
      "call-of-duty-3",
      "call-of-duty-4-modern-warfare",
      "call-of-duty-world-at-war",
      "call-of-duty-modern-warfare-2",
      "call-of-duty-black-ops",
      "call-of-duty-modern-warfare-3",
      "call-of-duty-black-ops-ii",
      "call-of-duty-ghosts",
      "call-of-duty-advanced-warfare",
      "call-of-duty-black-ops-iii",
      "call-of-duty-infinite-warfare",
      "call-of-duty-wwii",
      "call-of-duty-black-ops-4",
      "call-of-duty-modern-warfare",
      "call-of-duty-black-ops-cold-war",
      "call-of-duty-vanguard",
      "call-of-duty-modern-warfare-ii",
      "call-of-duty-modern-warfare-iii",
      "call-of-duty-black-ops-6",
    ],
    variants: {
      "call-of-duty-modern-warfare-remastered": "remaster",
      "call-of-duty-modern-warfare-2-campaign-remastered": "remaster",
    },
    years: {
      "call-of-duty": 2003,
      "call-of-duty-2": 2005,
      "call-of-duty-3": 2006,
      "call-of-duty-4-modern-warfare": 2007,
      "call-of-duty-world-at-war": 2008,
      "call-of-duty-modern-warfare-2": 2009,
      "call-of-duty-black-ops": 2010,
      "call-of-duty-modern-warfare-3": 2011,
      "call-of-duty-black-ops-ii": 2012,
      "call-of-duty-ghosts": 2013,
      "call-of-duty-advanced-warfare": 2014,
      "call-of-duty-black-ops-iii": 2015,
      "call-of-duty-infinite-warfare": 2016,
      "call-of-duty-wwii": 2017,
      "call-of-duty-black-ops-4": 2018,
      "call-of-duty-modern-warfare": 2019,
      "call-of-duty-black-ops-cold-war": 2020,
      "call-of-duty-vanguard": 2021,
      "call-of-duty-modern-warfare-ii": 2022,
      "call-of-duty-modern-warfare-iii": 2023,
      "call-of-duty-black-ops-6": 2024,
      "call-of-duty-modern-warfare-remastered": 2016,
      "call-of-duty-modern-warfare-2-campaign-remastered": 2020,
    },
    // RAWG lists Little Nightmares in this series; it is unrelated.
    exclude: ["little-nightmares"],
  },
  {
    id: "dark-souls",
    name: "Dark Souls",
    artwork: "dark-souls-iii",
    mainline: ["dark-souls-prepare-to-die-edition", "dark-souls-ii", "dark-souls-iii"],
    variants: {
      "dark-souls-remastered": "remaster",
      "dark-souls-ii-scholar-of-the-first-sin": "edition",
      "demons-souls": "spinoff",
    },
    years: {
      "dark-souls-prepare-to-die-edition": 2011,
      "dark-souls-ii": 2014,
      "dark-souls-iii": 2016,
      "dark-souls-remastered": 2018,
      "dark-souls-ii-scholar-of-the-first-sin": 2015,
      "demons-souls": 2009,
    },
    // RAWG's series groups FromSoftware's other soulslikes here; they are
    // separate franchises, not Dark Souls games.
    exclude: ["bloodborne", "sekiro-shadows-die-twice"],
  },
];

const BY_ID = new Map(FRANCHISES.map((f) => [f.id, f]));

export function franchiseById(id: string): FranchiseDef | null {
  return BY_ID.get(id) ?? null;
}

/** Every curated slug: mainline first, then variants. */
export function curatedSlugs(def: FranchiseDef): string[] {
  return [...def.mainline, ...Object.keys(def.variants ?? {})];
}

/** Franchise a game belongs to by curated slug, for the detail-page link. */
export function franchiseForSlug(slug: string): FranchiseDef | null {
  for (const franchise of FRANCHISES) {
    if (franchise.mainline.includes(slug) || franchise.variants?.[slug]) return franchise;
  }
  return null;
}
