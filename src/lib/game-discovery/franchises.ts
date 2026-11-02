// Curated franchise catalog. Names and classification are ours; all game data
// comes from RAWG at runtime. Entries are RAWG slugs used purely as lookup ids,
// checked against RAWG's records (id, name, release date) with the dev check:
//
//   RAWG_API_KEY=... node scripts/rawg-dev-check.mjs franchises [--verbose]
//
// It prints what each curated slug resolves to, following redirects, and flags
// years that don't match `years` -- which is how a slug pointing at the wrong
// same-named game is caught. It also lists series members we haven't classified.
//
// Slugs are RAWG's canonical ones, even when they look odd (`modern-warfare` is
// CoD 4, `grand-theft-aito-vi` is RAWG's own typo): a stale slug costs an extra
// redirect request, and a slug outside RAWG's series list costs a lookup.
//
// Mainline lists are in release order. Same-named games (God of War 2005 vs
// 2018, Resident Evil 2 1998 vs 2019) are distinct RAWG ids; the resolver never
// merges by name. `chronology` is only set when a reliable story order has been
// curated; none ship yet.

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
   * Expected release year of every curated slug on RAWG; null for an unreleased
   * game RAWG lists as TBA. Not used at runtime: the dev check compares it with
   * RAWG to confirm each slug is the intended game.
   */
  years: Record<string, number | null>;
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
      "assassins-creed-brotherhood-2",
      "assassins-creed-revelations",
      "assassins-creed-iii-2",
      "assassins-creed-iv-black-flag",
      "assassins-creed-unity-2",
      "assassins-creed-rogue-2",
      "assassins-creed-syndicate-2",
      "assassins-creed-origins",
      "assassins-creed-odyssey",
      "assassins-creed-valhalla",
      "assassins-creed-mirage",
      "assassins-creed-shadows",
    ],
    variants: {
      "assassins-creed-bloodlines": "spinoff",
      "assassins-creed-iii-liberation": "spinoff",
      "assassins-creed-pirates": "spinoff",
      "assassins-creed-chronicles": "spinoff",
      "assassins-creed-rebellion": "spinoff",
      "assassins-creed-nexus-vr": "spinoff",
      "assassins-creed-liberation-hd": "remaster",
      "assassins-creed-the-ezio-collection": "remaster",
      "assassins-creed-rogue-remastered-2": "remaster",
      "assassins-creed-iii-remastered": "remaster",
      // RAWG's own slug and name both misspell "Black Flag".
      "assassins-creed-back-flag-resynced": "remake",
    },
    years: {
      "assassins-creed": 2007,
      "assassins-creed-ii": 2009,
      "assassins-creed-brotherhood-2": 2010,
      "assassins-creed-revelations": 2011,
      "assassins-creed-iii-2": 2012,
      "assassins-creed-iv-black-flag": 2013,
      "assassins-creed-unity-2": 2014,
      "assassins-creed-rogue-2": 2014,
      "assassins-creed-syndicate-2": 2015,
      "assassins-creed-origins": 2017,
      "assassins-creed-odyssey": 2018,
      "assassins-creed-valhalla": 2020,
      "assassins-creed-mirage": 2023,
      "assassins-creed-shadows": 2025,
      "assassins-creed-bloodlines": 2009,
      "assassins-creed-iii-liberation": 2012,
      "assassins-creed-pirates": 2013,
      "assassins-creed-chronicles": 2016,
      "assassins-creed-rebellion": 2018,
      "assassins-creed-nexus-vr": 2023,
      "assassins-creed-liberation-hd": 2013,
      "assassins-creed-the-ezio-collection": 2016,
      "assassins-creed-rogue-remastered-2": 2018,
      "assassins-creed-iii-remastered": 2019,
      "assassins-creed-back-flag-resynced": 2026,
    },
  },
  {
    id: "far-cry",
    name: "Far Cry",
    artwork: "far-cry-5",
    mainline: [
      "far-cry",
      // RAWG's "Far Cry 2" record, released 2008-10-21, lives under this slug.
      "far-cry-2-fortunes-edition",
      "far-cry-3",
      "far-cry-4",
      "far-cry-5",
      "far-cry-6",
    ],
    variants: {
      "far-cry-3-blood-dragon-2": "spinoff",
      "far-cry-primal": "spinoff",
      "far-cry-new-dawn": "spinoff",
    },
    years: {
      "far-cry": 2004,
      "far-cry-2-fortunes-edition": 2008,
      "far-cry-3": 2012,
      "far-cry-4": 2014,
      "far-cry-5": 2018,
      "far-cry-6": 2021,
      "far-cry-3-blood-dragon-2": 2013,
      "far-cry-primal": 2016,
      "far-cry-new-dawn": 2019,
    },
  },
  {
    id: "grand-theft-auto",
    name: "Grand Theft Auto",
    artwork: "grand-theft-auto-v",
    mainline: [
      "grand-theft-auto-1998",
      "grand-theft-auto-2-1999",
      "grand-theft-auto-iii",
      "grand-theft-auto-vice-city",
      "grand-theft-auto-san-andreas",
      "grand-theft-auto-iv",
      "grand-theft-auto-v",
      "grand-theft-aito-vi",
    ],
    variants: {
      "grand-theft-auto-advance": "spinoff",
      "gta-liberty-city-stories": "spinoff",
      "grand-theft-auto-vice-city-stories": "spinoff",
      "gta-chinatown-wars": "spinoff",
    },
    years: {
      "grand-theft-auto-1998": 1997,
      "grand-theft-auto-2-1999": 1999,
      "grand-theft-auto-iii": 2001,
      "grand-theft-auto-vice-city": 2002,
      "grand-theft-auto-san-andreas": 2004,
      "grand-theft-auto-iv": 2008,
      "grand-theft-auto-v": 2013,
      "grand-theft-aito-vi": 2026,
      "grand-theft-auto-advance": 2004,
      "gta-liberty-city-stories": 2005,
      "grand-theft-auto-vice-city-stories": 2006,
      "gta-chinatown-wars": 2009,
    },
    // A community multiplayer mod, not a Rockstar release.
    exclude: ["san-andreas-multiplayer-sa-mp"],
  },
  {
    id: "red-dead",
    name: "Red Dead Redemption",
    artwork: "red-dead-redemption-2",
    mainline: ["red-dead-revolver", "red-dead-redemption", "red-dead-redemption-2"],
    variants: {
      "red-dead-online": "spinoff",
    },
    years: {
      "red-dead-revolver": 2004,
      "red-dead-redemption": 2010,
      "red-dead-redemption-2": 2018,
      "red-dead-online": 2018,
    },
  },
  {
    id: "the-witcher",
    name: "The Witcher",
    artwork: "the-witcher-3-wild-hunt",
    // RAWG also has separate Enhanced Edition records for the first two games.
    // They aren't in its series list, so these originals avoid two lookups.
    mainline: [
      "the-witcher",
      "the-witcher-2-assassins-of-kings",
      "the-witcher-3-wild-hunt",
      // RAWG names this record "The Witcher (A New Saga Begins)".
      "the-witcher-4",
    ],
    variants: {
      "the-witcher-remake": "remake",
      "the-witcher-adventure-game": "spinoff",
      "gwent-the-witcher-card-game": "spinoff",
      "gwent-thronebreaker": "spinoff",
      "gwent-rogue-mage": "spinoff",
    },
    years: {
      "the-witcher": 2007,
      "the-witcher-2-assassins-of-kings": 2011,
      "the-witcher-3-wild-hunt": 2015,
      "the-witcher-4": null,
      "the-witcher-remake": null,
      "the-witcher-adventure-game": 2014,
      "gwent-the-witcher-card-game": 2018,
      "gwent-thronebreaker": 2018,
      "gwent-rogue-mage": 2022,
    },
    // A console port that was cancelled and never released.
    exclude: ["the-witcher-rise-of-the-white-wolf"],
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
      "resident-evil-zero",
      "resident-evil-4",
      "resident-evil-5-biohazard-5",
      "resident-evil-6",
      "resident-evil-7-biohazard",
      "resident-evil-village",
      "resident-evil-9-requiem",
    ],
    variants: {
      "resident-evil-2-2019": "remake",
      "resident-evil-3": "remake",
      "resident-evil-4-2023": "remake",
      "resident-evil-0": "remaster",
      "resident-evil-directors-cut": "edition",
      "resident-evil-survivor-2": "spinoff",
      "resident-evil-gaiden": "spinoff",
      "resident-evil-survivor-2-code-veronica": "spinoff",
      "resident-evil-dead-aim": "spinoff",
      "resident-evil-outbreak": "spinoff",
      "resident-evil-outbreak-file-2": "spinoff",
      "resident-evil-the-umbrella-chronicles-2": "spinoff",
      "resident-evil-the-darkside-chronicles-2": "spinoff",
      "resident-evil-operation-raccoon-city-2": "spinoff",
      "resident-evil-revelations-biohazard-revelations": "spinoff",
      "re-revelations-2": "spinoff",
      "umbrella-corps": "spinoff",
    },
    years: {
      "resident-evil": 1996,
      "resident-evil-2": 1998,
      "resident-evil-3-nemesis": 1999,
      "resident-evil-code-veronica": 2000,
      "resident-evil-zero": 2002,
      "resident-evil-4": 2005,
      "resident-evil-5-biohazard-5": 2009,
      "resident-evil-6": 2012,
      "resident-evil-7-biohazard": 2017,
      "resident-evil-village": 2021,
      "resident-evil-9-requiem": 2026,
      "resident-evil-2-2019": 2019,
      "resident-evil-3": 2020,
      "resident-evil-4-2023": 2023,
      "resident-evil-0": 2016,
      "resident-evil-directors-cut": 1997,
      "resident-evil-survivor-2": 2000,
      "resident-evil-gaiden": 2001,
      "resident-evil-survivor-2-code-veronica": 2002,
      "resident-evil-dead-aim": 2003,
      "resident-evil-outbreak": 2003,
      "resident-evil-outbreak-file-2": 2004,
      "resident-evil-the-umbrella-chronicles-2": 2007,
      "resident-evil-the-darkside-chronicles-2": 2009,
      "resident-evil-operation-raccoon-city-2": 2012,
      "resident-evil-revelations-biohazard-revelations": 2012,
      "re-revelations-2": 2015,
      "umbrella-corps": 2016,
    },
    // A fan-made demake, not a Capcom release.
    exclude: ["resident-evil-0-demake"],
  },
  {
    id: "tomb-raider",
    name: "Tomb Raider",
    artwork: "shadow-of-the-tomb-raider",
    mainline: [
      "tomb-raider-1996",
      "tomb-raider-ii",
      "tomb-raider-3-adventures-of-lara-croft",
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
      "tomb-raider-gbc": "spinoff",
      "tomb-raider-curse-of-the-sword": "spinoff",
      "tomb-raider-the-prophecy": "spinoff",
      "lara-croft-gol": "spinoff",
      "lara-croft-and-the-temple-of-osiris": "spinoff",
      "lara-croft-relic-run": "spinoff",
      "lara-croft-go": "spinoff",
    },
    years: {
      "tomb-raider-1996": 1996,
      "tomb-raider-ii": 1997,
      "tomb-raider-3-adventures-of-lara-croft": 1998,
      "tomb-raider-the-last-revelation": 1999,
      "tomb-raider-chronicles": 2000,
      "tomb-raider-the-angel-of-darkness": 2003,
      "tomb-raider-legend": 2006,
      "tomb-raider-underworld": 2008,
      "tomb-raider": 2013,
      "rise-of-the-tomb-raider": 2015,
      "shadow-of-the-tomb-raider": 2018,
      "tomb-raider-anniversary": 2007,
      "tomb-raider-gbc": 2000,
      "tomb-raider-curse-of-the-sword": 2001,
      "tomb-raider-the-prophecy": 2002,
      "lara-croft-gol": 2010,
      "lara-croft-and-the-temple-of-osiris": 2014,
      "lara-croft-relic-run": 2015,
      "lara-croft-go": 2015,
    },
    exclude: [
      // Duplicate records of curated games.
      "lara-croft-tomb-raider-legend",
      "tomb-raider-starring-lara-croft",
      // Expansions and a bundle of two curated games.
      "tomb-raider-2-golden-mask",
      "tomb-raider-3-the-lost-artifact",
      "tomb-raider-the-last-revelation-chronicles",
    ],
  },
  {
    id: "god-of-war",
    name: "God of War",
    artwork: "god-of-war-2",
    // `god-of-war` is RAWG's 2005 original, `god-of-war-ii` the 2007 sequel and
    // `god-of-war-2` the 2018 game; `years` keeps those from being confused.
    mainline: [
      "god-of-war",
      "god-of-war-ii",
      "god-of-war-iii",
      "god-of-war-ascension",
      "god-of-war-2",
      "god-of-war-ragnarok",
    ],
    variants: {
      "god-of-war-betrayal": "spinoff",
      "god-of-war-chains-of-olympus": "spinoff",
      "god-of-war-ghost-of-sparta": "spinoff",
      "god-of-war-collection": "remaster",
      "god-of-war-origins-collection": "remaster",
      "god-of-war-iii-remastered": "remaster",
      "god-of-war-saga": "edition",
    },
    years: {
      "god-of-war": 2005,
      "god-of-war-ii": 2007,
      "god-of-war-iii": 2010,
      "god-of-war-ascension": 2013,
      "god-of-war-2": 2018,
      "god-of-war-ragnarok": 2022,
      "god-of-war-betrayal": 2007,
      "god-of-war-chains-of-olympus": 2008,
      "god-of-war-ghost-of-sparta": 2010,
      "god-of-war-collection": 2009,
      "god-of-war-origins-collection": 2011,
      "god-of-war-iii-remastered": 2015,
      "god-of-war-saga": 2012,
    },
    // Ragnarok's Valhalla DLC.
    exclude: ["god-of-war-ragnarok-valhalla"],
  },
  {
    id: "battlefield",
    name: "Battlefield",
    artwork: "battlefield-1",
    // `battlefield-6` is the 2021 record battlefield-2042 redirected to; the 2025
    // Battlefield 6 is `battlefield-6-2`. `years` keeps the two apart.
    mainline: [
      "battlefield-1942",
      "battlefield-vietnam",
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
      "battlefield-2-mc": "spinoff",
      "battlefield-bad-co": "spinoff",
      "battlefield-heroes": "spinoff",
      "battlefield-1943": "spinoff",
      "battlefield-bad-company-2": "spinoff",
      "battlefield-online": "spinoff",
      "battlefield-play4free": "spinoff",
      "battlefield-hardline": "spinoff",
    },
    years: {
      "battlefield-1942": 2002,
      "battlefield-vietnam": 2004,
      "battlefield-2": 2005,
      "battlefield-2142": 2006,
      "battlefield-3": 2011,
      "battlefield-4": 2013,
      "battlefield-1": 2016,
      "battlefield-v": 2018,
      "battlefield-6": 2021,
      "battlefield-6-2": 2025,
      "battlefield-2-mc": 2005,
      "battlefield-bad-co": 2008,
      "battlefield-heroes": 2009,
      "battlefield-1943": 2009,
      "battlefield-bad-company-2": 2010,
      "battlefield-online": 2010,
      "battlefield-play4free": 2011,
      "battlefield-hardline": 2015,
    },
    exclude: [
      // Battlefield 2 expansion and booster packs.
      "battlefield-2-special-forces",
      "battlefield-2-euro-force",
      "battlefield-2-armored-fury",
      // An unrelated 1991 game that shares the name.
      "battlefield",
    ],
  },
  {
    id: "call-of-duty",
    name: "Call of Duty",
    artwork: "call-of-duty-modern-warfare",
    // `modern-warfare` is CoD 4 (2007) and `modern-warfare-2` the 2009 game; the
    // 2019 and 2022 reboots are `call-of-duty-modern-warfare` and `-ii`.
    mainline: [
      "call-of-duty",
      "call-of-duty-2",
      "call-of-duty-3",
      "modern-warfare",
      "call-of-duty-world-at-war",
      "modern-warfare-2",
      "call-of-duty-black-ops",
      "call-of-duty-modern-warfare-3",
      "cod-black-ops-ii",
      "call-of-duty-ghosts",
      "call-of-duty-advanced-warfare",
      "cod-black-ops-iii",
      "call-of-duty-infinite-warfare",
      "call-of-duty-wwii",
      "call-of-duty-black-ops-4",
      "call-of-duty-modern-warfare",
      "call-of-duty-black-ops-cold-war",
      "call-of-duty-vanguard",
      "call-of-duty-modern-warfare-ii",
      "call-of-duty-modern-warfare-iii",
      "call-of-duty-black-ops-6",
      "call-of-duty-black-ops-7",
    ],
    variants: {
      "call-of-duty-finest-hour": "spinoff",
      "call-of-duty-2-big-red-one": "spinoff",
      "call-of-duty-roads-to-victory": "spinoff",
      "call-of-duty-mobile": "spinoff",
      "call-of-duty-warzone": "spinoff",
      "call-of-duty-warzone-20": "spinoff",
      "call-of-duty-modern-warfare-remastered": "remaster",
      "call-of-duty-modern-warfare-2-campaign-remastered": "remaster",
    },
    years: {
      "call-of-duty": 2003,
      "call-of-duty-2": 2005,
      "call-of-duty-3": 2006,
      "modern-warfare": 2007,
      "call-of-duty-world-at-war": 2008,
      "modern-warfare-2": 2009,
      "call-of-duty-black-ops": 2010,
      "call-of-duty-modern-warfare-3": 2011,
      "cod-black-ops-ii": 2012,
      "call-of-duty-ghosts": 2013,
      "call-of-duty-advanced-warfare": 2014,
      "cod-black-ops-iii": 2015,
      "call-of-duty-infinite-warfare": 2016,
      "call-of-duty-wwii": 2017,
      "call-of-duty-black-ops-4": 2018,
      "call-of-duty-modern-warfare": 2019,
      "call-of-duty-black-ops-cold-war": 2020,
      "call-of-duty-vanguard": 2021,
      "call-of-duty-modern-warfare-ii": 2022,
      "call-of-duty-modern-warfare-iii": 2023,
      "call-of-duty-black-ops-6": 2024,
      "call-of-duty-black-ops-7": 2025,
      "call-of-duty-finest-hour": 2004,
      "call-of-duty-2-big-red-one": 2005,
      "call-of-duty-roads-to-victory": 2007,
      "call-of-duty-mobile": 2019,
      "call-of-duty-warzone": 2020,
      "call-of-duty-warzone-20": 2022,
      "call-of-duty-modern-warfare-remastered": 2016,
      "call-of-duty-modern-warfare-2-campaign-remastered": 2020,
    },
    exclude: [
      // United Offensive is an expansion; Little Nightmares is unrelated.
      "call-of-duty-united-offensive",
      "little-nightmares-the-depths",
    ],
  },
  {
    id: "dark-souls",
    name: "Dark Souls",
    artwork: "dark-souls-iii",
    mainline: ["dark-souls", "dark-souls-ii", "dark-souls-iii"],
    variants: {
      "dark-souls-remastered": "remaster",
      "dark-souls-ii-scholar-of-the-first-sin": "edition",
    },
    years: {
      "dark-souls": 2011,
      "dark-souls-ii": 2014,
      "dark-souls-iii": 2016,
      // The game launched in 2018; RAWG dates this record 2021-03-09.
      "dark-souls-remastered": 2021,
      "dark-souls-ii-scholar-of-the-first-sin": 2015,
    },
    exclude: [
      // RAWG's series groups FromSoftware's other games here; they are separate
      // franchises, not Dark Souls games.
      "demons-souls",
      "bloodborne",
      "bloodborne-game-of-the-year-edition",
      "bloodborne-the-old-hunters",
      "shadows-die-twice",
      // Dark Souls DLC.
      "dark-souls-artorias-of-the-abyss",
    ],
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
