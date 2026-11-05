// IGDB ids for the curated franchise catalog (Stage 5). The catalog in
// franchises.ts stays the source of truth: its slugs, groups (mainline,
// remakes, spin-offs, editions) and order are unchanged, and this file only
// says which IGDB game(s) each curated slug is. Nothing here is matched at
// runtime: every id was chosen once, reviewed against the live IGDB record
// (name, year, game type, parent), and is fixed.
//
// Regenerate the review report with:
//   node --env-file=.env.igdb.local scripts/igdb-dev-check.mjs franchises --json
//
// - 149 entries are the matcher's exact title + year + type matches.
// - 23 were mapped by hand: RAWG-specific slugs, year differences and the
//   decisions recorded in the IGDB plan (comment above each).
// - One curated slug may name several IGDB games (Assassin's Creed
//   Chronicles is three games on IGDB); they all take that slug's group.
// - No curated entry lacks an IGDB record, so there are no exceptions; an
//   entry missing from the response at runtime is simply left out.
//
// `artwork` is the game whose art fronts the franchise card and page header
// (the IGDB id of the catalog's `artwork` slug).

export type IgdbFranchiseMap = {
  artwork: number;
  entries: Readonly<Record<string, number | readonly number[]>>;
};

export const IGDB_FRANCHISES: Readonly<Record<string, IgdbFranchiseMap>> = {
  "assassins-creed": {
    artwork: 133004,
    entries: {
      "assassins-creed": 128, // Assassin's Creed (2007)
      "assassins-creed-ii": 127, // Assassin's Creed II (2009)
      "assassins-creed-brotherhood-2": 113, // Assassin's Creed Brotherhood (2010)
      "assassins-creed-revelations": 537, // Assassin's Creed Revelations (2011)
      "assassins-creed-iii-2": 1266, // Assassin's Creed III (2012)
      "assassins-creed-iv-black-flag": 1970, // Assassin's Creed IV Black Flag (2013)
      "assassins-creed-unity-2": 5606, // Assassin's Creed Unity (2014)
      "assassins-creed-rogue-2": 7570, // Assassin's Creed Rogue (2014)
      "assassins-creed-syndicate-2": 8263, // Assassin's Creed Syndicate (2015)
      "assassins-creed-origins": 28540, // Assassin's Creed Origins (2017)
      "assassins-creed-odyssey": 103054, // Assassin's Creed Odyssey (2018)
      "assassins-creed-valhalla": 133004, // Assassin's Creed Valhalla (2020)
      "assassins-creed-mirage": 215060, // Assassin's Creed Mirage (2023)
      "assassins-creed-shadows": 300976, // Assassin's Creed Shadows (2025)
      "assassins-creed-bloodlines": 10661, // Assassin's Creed: Bloodlines (2009)
      "assassins-creed-iii-liberation": 3195, // Assassin's Creed III: Liberation (2012)
      "assassins-creed-pirates": 20077, // Assassin's Creed: Pirates (2013)
      // China, India, Russia as separate games (decision 2026-11-05); the Trilogy Pack 52416 is a bundle and isn't listed
      "assassins-creed-chronicles": [8223, 14902, 14903],
      "assassins-creed-rebellion": 41030, // Assassin's Creed: Rebellion (2018)
      "assassins-creed-nexus-vr": 251568, // Assassin's Creed Nexus VR (2023)
      // Assassin's Creed: Liberation HD; IGDB dates it 2014 (curated 2013) and calls it a Port of 3195
      "assassins-creed-liberation-hd": 20864,
      "assassins-creed-the-ezio-collection": 23954, // Assassin's Creed: The Ezio Collection (2016), Bundle
      "assassins-creed-rogue-remastered-2": 81205, // Assassin's Creed: Rogue Remastered (2018), Remaster
      "assassins-creed-iii-remastered": 109532, // Assassin's Creed III Remastered (2019), Remaster
      // Assassin's Creed Black Flag Resynced (2026), IGDB Remake of 1970
      "assassins-creed-back-flag-resynced": 337738,
    },
  },
  "far-cry": {
    artwork: 28552,
    entries: {
      "far-cry": 306, // Far Cry (2004)
      // Far Cry 2 (2008). IGDB's Fortune's Edition (46633) is an edition of it;
      // the curated entry is the base game (RAWG keeps Far Cry 2 under this slug).
      "far-cry-2-fortunes-edition": 361,
      "far-cry-3": 529, // Far Cry 3 (2012)
      "far-cry-4": 6801, // Far Cry 4 (2014)
      "far-cry-5": 28552, // Far Cry 5 (2018)
      "far-cry-6": 126290, // Far Cry 6 (2021)
      "far-cry-3-blood-dragon-2": 2001, // Far Cry 3: Blood Dragon (2013), Standalone Expansion
      "far-cry-primal": 13182, // Far Cry: Primal (2016)
      "far-cry-new-dawn": 113111, // Far Cry New Dawn (2019)
    },
  },
  "grand-theft-auto": {
    artwork: 1020,
    entries: {
      "grand-theft-auto-1998": 980, // Grand Theft Auto (1997)
      "grand-theft-auto-2-1999": 819, // Grand Theft Auto 2 (1999)
      "grand-theft-auto-iii": 730, // Grand Theft Auto III (2001)
      "grand-theft-auto-vice-city": 733, // Grand Theft Auto: Vice City (2002)
      "grand-theft-auto-san-andreas": 732, // Grand Theft Auto: San Andreas (2004)
      "grand-theft-auto-iv": 731, // Grand Theft Auto IV (2008)
      "grand-theft-auto-v": 1020, // Grand Theft Auto V (2013)
      // Grand Theft Auto VI (2026); RAWG's slug has a typo
      "grand-theft-aito-vi": 52189,
      "grand-theft-auto-advance": 3266, // Grand Theft Auto Advance (2004)
      // Grand Theft Auto: Liberty City Stories (2005)
      "gta-liberty-city-stories": 3263,
      "grand-theft-auto-vice-city-stories": 3262, // Grand Theft Auto: Vice City Stories (2006)
      // Grand Theft Auto: Chinatown Wars (2009)
      "gta-chinatown-wars": 3270,
    },
  },
  "red-dead": {
    artwork: 25076,
    entries: {
      "red-dead-revolver": 1969, // Red Dead Revolver (2004)
      "red-dead-redemption": 434, // Red Dead Redemption (2010)
      "red-dead-redemption-2": 25076, // Red Dead Redemption 2 (2018)
      // Red Dead Online; IGDB dates the standalone release 2019 (curated 2018)
      "red-dead-online": 141338,
    },
  },
  "the-witcher": {
    artwork: 1942,
    entries: {
      "the-witcher": 80, // The Witcher (2007)
      "the-witcher-2-assassins-of-kings": 478, // The Witcher 2: Assassins of Kings (2011)
      "the-witcher-3-wild-hunt": 1942, // The Witcher 3: Wild Hunt (2015)
      "the-witcher-4": 194662, // The Witcher IV (2028)
      "the-witcher-remake": 220277, // The Witcher Remake (TBA), Remake
      "the-witcher-adventure-game": 8765, // The Witcher: Adventure Game (2014)
      "gwent-the-witcher-card-game": 19474, // Gwent: The Witcher Card Game (2018)
      // Thronebreaker: The Witcher Tales (2018), IGDB Standalone Expansion of Gwent
      "gwent-thronebreaker": 107300,
      "gwent-rogue-mage": 208307, // Gwent: Rogue Mage (2022), Standalone Expansion
    },
  },
  "resident-evil": {
    artwork: 55163,
    entries: {
      "resident-evil": 424, // Resident Evil (1996)
      "resident-evil-2": 880, // Resident Evil 2 (1998)
      "resident-evil-3-nemesis": 966, // Resident Evil 3: Nemesis (1999)
      "resident-evil-code-veronica": 968, // Resident Evil Code: Veronica (2000)
      "resident-evil-zero": 970, // Resident Evil Zero (2002)
      "resident-evil-4": 974, // Resident Evil 4 (2005)
      // Resident Evil 5 (2009), not the Gold Edition bundle 24347
      "resident-evil-5-biohazard-5": 847,
      "resident-evil-6": 1082, // Resident Evil 6 (2012)
      "resident-evil-7-biohazard": 19562, // Resident Evil 7: Biohazard (2017)
      "resident-evil-village": 55163, // Resident Evil Village (2021)
      // Resident Evil Requiem (2026)
      "resident-evil-9-requiem": 347668,
      "resident-evil-2-2019": 19686, // Resident Evil 2 (2019), Remake
      "resident-evil-3": 115115, // Resident Evil 3 (2020), Remake
      "resident-evil-4-2023": 132181, // Resident Evil 4 (2023), Remake
      "resident-evil-0": 15108, // Resident Evil 0 (2016), Remaster
      "resident-evil-directors-cut": 23377, // Resident Evil: Director's Cut (1997), Expanded Game
      // Resident Evil Survivor (2000): RAWG's "-2" is its duplicate-slug suffix
      // (curated year 2000); Survivor 2 Code: Veronica is the entry below.
      "resident-evil-survivor-2": 967,
      "resident-evil-gaiden": 969, // Resident Evil Gaiden (2001)
      // Resident Evil Survivor 2 Code: Veronica; IGDB dates the arcade release 2001 (curated 2002)
      "resident-evil-survivor-2-code-veronica": 19886,
      "resident-evil-dead-aim": 971, // Resident Evil: Dead Aim (2003)
      "resident-evil-outbreak": 972, // Resident Evil Outbreak (2003)
      "resident-evil-outbreak-file-2": 973, // Resident Evil Outbreak File #2 (2004), Standalone Expansion
      "resident-evil-the-umbrella-chronicles-2": 975, // Resident Evil: The Umbrella Chronicles (2007)
      "resident-evil-the-darkside-chronicles-2": 497, // Resident Evil: The Darkside Chronicles (2009)
      "resident-evil-operation-raccoon-city-2": 977, // Resident Evil: Operation Raccoon City (2012)
      // Resident Evil: Revelations (2012), not the 2013 HD remaster 150045
      "resident-evil-revelations-biohazard-revelations": 978,
      // Resident Evil: Revelations 2 (2015), not its episodes or Deluxe Edition
      "re-revelations-2": 7725,
      "umbrella-corps": 12530, // Umbrella Corps (2016)
    },
  },
  "tomb-raider": {
    artwork: 37777,
    entries: {
      "tomb-raider-1996": 912, // Tomb Raider (1996)
      "tomb-raider-ii": 1156, // Tomb Raider II (1997)
      "tomb-raider-3-adventures-of-lara-croft": 1157, // Tomb Raider III: Adventures of Lara Croft (1998)
      "tomb-raider-the-last-revelation": 1158, // Tomb Raider: The Last Revelation (1999)
      "tomb-raider-chronicles": 1160, // Tomb Raider: Chronicles (2000)
      "tomb-raider-the-angel-of-darkness": 1159, // Tomb Raider: The Angel of Darkness (2003)
      "tomb-raider-legend": 1161, // Tomb Raider: Legend (2006)
      "tomb-raider-underworld": 1163, // Tomb Raider: Underworld (2008)
      "tomb-raider": 1164, // Tomb Raider (2013)
      "rise-of-the-tomb-raider": 7323, // Rise of the Tomb Raider (2015)
      "shadow-of-the-tomb-raider": 37777, // Shadow of the Tomb Raider (2018)
      "tomb-raider-anniversary": 1162, // Tomb Raider: Anniversary (2007), Remake
      // Tomb Raider Starring Lara Croft (2000, Game Boy Color)
      "tomb-raider-gbc": 36878,
      "tomb-raider-curse-of-the-sword": 49993, // Tomb Raider: Curse of the Sword (2001)
      "tomb-raider-the-prophecy": 18809, // Tomb Raider: The Prophecy (2002)
      // Lara Croft and the Guardian of Light (2010), not its DLC packs
      "lara-croft-gol": 769,
      "lara-croft-and-the-temple-of-osiris": 7325, // Lara Croft and the Temple of Osiris (2014)
      "lara-croft-relic-run": 15384, // Lara Croft: Relic Run (2015)
      "lara-croft-go": 11592, // Lara Croft Go (2015)
    },
  },
  "god-of-war": {
    artwork: 19560,
    entries: {
      "god-of-war": 549, // God of War (2005)
      "god-of-war-ii": 551, // God of War II (2007)
      "god-of-war-iii": 499, // God of War III (2010)
      "god-of-war-ascension": 1291, // God of War: Ascension (2013)
      "god-of-war-2": 19560, // God of War (2018)
      "god-of-war-ragnarok": 112875, // God of War Ragnarök (2022)
      "god-of-war-betrayal": 21233, // God of War: Betrayal (2007)
      "god-of-war-chains-of-olympus": 552, // God of War: Chains of Olympus (2008)
      "god-of-war-ghost-of-sparta": 550, // God of War: Ghost of Sparta (2010)
      "god-of-war-collection": 20068, // God of War Collection (2009), Bundle
      "god-of-war-origins-collection": 20579, // God of War: Origins Collection (2011), Bundle
      "god-of-war-iii-remastered": 19959, // God of War III: Remastered (2015), Remaster
      "god-of-war-saga": 23827, // God of War Saga (2012), Bundle
    },
  },
  battlefield: {
    artwork: 18320,
    entries: {
      "battlefield-1942": 240, // Battlefield 1942 (2002)
      "battlefield-vietnam": 335, // Battlefield Vietnam (2004)
      "battlefield-2": 277, // Battlefield 2 (2005)
      "battlefield-2142": 349, // Battlefield 2142 (2006)
      "battlefield-3": 343, // Battlefield 3 (2011)
      "battlefield-4": 1979, // Battlefield 4 (2013)
      "battlefield-1": 18320, // Battlefield 1 (2016)
      "battlefield-v": 83728, // Battlefield V (2018)
      // Battlefield 2042 (2021): RAWG's old battlefield-6 slug; the 2025 Battlefield 6 (317407) isn't in the catalog
      "battlefield-6": 125166,
      "battlefield-6-2": 317407, // Battlefield 6 (2025)
      // Battlefield 2: Modern Combat (2005)
      "battlefield-2-mc": 348,
      // Battlefield: Bad Company (2008), not Bad Company 2 (352)
      "battlefield-bad-co": 473,
      "battlefield-heroes": 350, // Battlefield Heroes (2009)
      "battlefield-1943": 351, // Battlefield 1943 (2009)
      "battlefield-bad-company-2": 352, // Battlefield: Bad Company 2 (2010)
      "battlefield-online": 353, // Battlefield Online (2010), Port
      "battlefield-play4free": 354, // Battlefield Play4Free (2011)
      "battlefield-hardline": 7081, // Battlefield Hardline (2015)
    },
  },
  "call-of-duty": {
    artwork: 119177,
    entries: {
      "call-of-duty": 621, // Call of Duty (2003)
      "call-of-duty-2": 622, // Call of Duty 2 (2005)
      "call-of-duty-3": 949, // Call of Duty 3 (2006)
      // Call of Duty 4: Modern Warfare (2007)
      "modern-warfare": 623,
      "call-of-duty-world-at-war": 625, // Call of Duty: World at War (2008)
      // Call of Duty: Modern Warfare 2 (2009), not the 2022 Modern Warfare II (200165)
      "modern-warfare-2": 559,
      "call-of-duty-black-ops": 545, // Call of Duty: Black Ops (2010)
      "call-of-duty-modern-warfare-3": 979, // Call of Duty: Modern Warfare 3 (2011)
      // Call of Duty: Black Ops II (2012)
      "cod-black-ops-ii": 1122,
      "call-of-duty-ghosts": 2033, // Call of Duty: Ghosts (2013)
      "call-of-duty-advanced-warfare": 6632, // Call of Duty: Advanced Warfare (2014)
      // Call of Duty: Black Ops III (2015)
      "cod-black-ops-iii": 9509,
      "call-of-duty-infinite-warfare": 18968, // Call of Duty: Infinite Warfare (2016)
      "call-of-duty-wwii": 28204, // Call of Duty: WWII (2017)
      "call-of-duty-black-ops-4": 83727, // Call of Duty: Black Ops 4 (2018)
      "call-of-duty-modern-warfare": 119177, // Call of Duty: Modern Warfare (2019)
      "call-of-duty-black-ops-cold-war": 137001, // Call of Duty: Black Ops Cold War (2020)
      "call-of-duty-vanguard": 165067, // Call of Duty: Vanguard (2021)
      "call-of-duty-modern-warfare-ii": 200165, // Call of Duty: Modern Warfare II (2022)
      "call-of-duty-modern-warfare-iii": 260780, // Call of Duty: Modern Warfare III (2023)
      "call-of-duty-black-ops-6": 302156, // Call of Duty: Black Ops 6 (2024)
      "call-of-duty-black-ops-7": 348220, // Call of Duty: Black Ops 7 (2025)
      "call-of-duty-finest-hour": 3761, // Call of Duty: Finest Hour (2004)
      "call-of-duty-2-big-red-one": 3845, // Call of Duty 2: Big Red One (2005)
      "call-of-duty-roads-to-victory": 3120, // Call of Duty: Roads to Victory (2007)
      "call-of-duty-mobile": 106805, // Call of Duty: Mobile (2019)
      "call-of-duty-warzone": 131800, // Call of Duty: Warzone (2020), Standalone Expansion
      "call-of-duty-warzone-20": 217815, // Call of Duty: Warzone (2022)
      "call-of-duty-modern-warfare-remastered": 24920, // Call of Duty: Modern Warfare Remastered (2016), Remaster
      "call-of-duty-modern-warfare-2-campaign-remastered": 95062, // Call of Duty: Modern Warfare 2 Campaign Remastered (2020), Remaster
    },
  },
  "dark-souls": {
    artwork: 11133,
    entries: {
      "dark-souls": 2155, // Dark Souls (2011)
      "dark-souls-ii": 2368, // Dark Souls II (2014)
      "dark-souls-iii": 11133, // Dark Souls III (2016)
      // Dark Souls: Remastered (2018); RAWG dated its record 2021
      "dark-souls-remastered": 81085,
      "dark-souls-ii-scholar-of-the-first-sin": 8222, // Dark Souls II: Scholar of the First Sin (2015), Expanded Game
    },
  },
};

/** The IGDB ids of a franchise, each with the curated slug it stands for. */
export function igdbFranchiseIds(franchiseId: string): Map<number, string> {
  const map = Object.hasOwn(IGDB_FRANCHISES, franchiseId) ? IGDB_FRANCHISES[franchiseId] : null;
  const out = new Map<number, string>();
  for (const [slug, value] of Object.entries(map?.entries ?? {})) {
    for (const id of typeof value === "number" ? [value] : value) out.set(id, slug);
  }
  return out;
}

/** The IGDB id of a franchise's artwork game, or null for an unknown franchise. */
export function igdbFranchiseArtwork(franchiseId: string): number | null {
  return Object.hasOwn(IGDB_FRANCHISES, franchiseId) ? IGDB_FRANCHISES[franchiseId].artwork : null;
}

let reverse: Map<number, { franchiseId: string; slug: string }> | null = null;

/** The curated franchise an IGDB game belongs to, by its exact id; never by name. */
export function igdbFranchiseOf(igdbId: number): { franchiseId: string; slug: string } | null {
  if (!reverse) {
    reverse = new Map();
    for (const franchiseId of Object.keys(IGDB_FRANCHISES)) {
      for (const [id, slug] of igdbFranchiseIds(franchiseId))
        reverse.set(id, { franchiseId, slug });
    }
  }
  return reverse.get(igdbId) ?? null;
}
