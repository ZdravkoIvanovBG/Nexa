// Curated franchise catalog. Names and classification are ours; all game data
// comes from RAWG at runtime. Entries are RAWG slugs used purely as lookup ids.
//
// Verify after any edit (needs a RAWG key, prints no secrets):
//   RAWG_API_KEY=... node scripts/rawg-dev-check.mjs franchises
// It reports unresolved/redirected slugs, curated games missing from RAWG's
// series data, and unclassified series members to curate.
//
// Mainline lists are in release order. Same-named games (e.g. God of War 2005
// vs 2018) are distinct RAWG ids and are kept apart by the resolver, which
// never merges by name. `chronology` is only set when a reliable story order
// has been curated; none ship yet.

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
  /** RAWG slugs to hide (DLC, soundtracks, store duplicates RAWG lists as games). */
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
      "assassins-creed-rogue": "spinoff",
      "assassins-creed-iii-liberation": "spinoff",
      "assassins-creed-iii-remastered": "remaster",
    },
  },
  {
    id: "far-cry",
    name: "Far Cry",
    artwork: "far-cry-5",
    mainline: ["far-cry", "far-cry-2", "far-cry-3", "far-cry-4", "far-cry-5", "far-cry-6"],
    variants: {
      "far-cry-3-blood-dragon": "spinoff",
      "far-cry-primal": "spinoff",
      "far-cry-new-dawn": "spinoff",
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
    variants: {
      "grand-theft-auto-liberty-city-stories": "spinoff",
      "grand-theft-auto-vice-city-stories": "spinoff",
      "grand-theft-auto-chinatown-wars": "spinoff",
      "grand-theft-auto-the-trilogy-the-definitive-edition": "remaster",
    },
  },
  {
    id: "red-dead",
    name: "Red Dead Redemption",
    artwork: "red-dead-redemption-2",
    mainline: ["red-dead-revolver", "red-dead-redemption", "red-dead-redemption-2"],
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
    variants: {
      "resident-evil-revelations": "spinoff",
      "resident-evil-revelations-2": "spinoff",
    },
  },
  {
    id: "tomb-raider",
    name: "Tomb Raider",
    artwork: "shadow-of-the-tomb-raider",
    mainline: [
      "tomb-raider-1996",
      "tomb-raider-ii",
      "tomb-raider-iii-adventures-of-lara-croft",
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
  },
  {
    id: "god-of-war",
    name: "God of War",
    artwork: "god-of-war-2",
    mainline: [
      "god-of-war-2005",
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
  },
  {
    id: "battlefield",
    name: "Battlefield",
    artwork: "battlefield-1",
    mainline: [
      "battlefield-1942",
      "battlefield-2",
      "battlefield-2142",
      "battlefield-3",
      "battlefield-4",
      "battlefield-1",
      "battlefield-v",
      "battlefield-2042",
    ],
    variants: {
      "battlefield-vietnam": "spinoff",
      "battlefield-bad-company": "spinoff",
      "battlefield-bad-company-2": "spinoff",
      "battlefield-hardline": "spinoff",
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
  },
];

const BY_ID = new Map(FRANCHISES.map((f) => [f.id, f]));

export function franchiseById(id: string): FranchiseDef | null {
  return BY_ID.get(id) ?? null;
}

/** Franchise a game belongs to by curated slug, for the detail-page link. */
export function franchiseForSlug(slug: string): FranchiseDef | null {
  for (const franchise of FRANCHISES) {
    if (franchise.mainline.includes(slug) || franchise.variants?.[slug]) return franchise;
  }
  return null;
}
