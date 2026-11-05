// Curated art for high-visibility IGDB games (Stage 4A).
//
// Metadata can reject logos, icons, covers, transparent and badly sized
// images, but it can't tell a cinematic scene from busy key art. For the few
// games where that matters, an entry here names one of the game's own IGDB
// images, chosen by looking at the candidates in the contact sheet:
//
//   node --env-file=.env.igdb.local scripts/igdb-art-sheet.mjs <igdb ids…>
//
// Rules:
// - Keys are provider-qualified ids ("igdb:N"); values name an IGDB image by
//   kind and image id, never a URL.
// - An entry applies only when that image is in the game's own artworks or
//   screenshots in the response and passes the same suitability rules
//   (art.ts); otherwise selection falls back to the automatic choice. So an
//   override can never show another game's image or a removed one.
// - `hero` is the Discovery hero and the game page backdrop; `card` the 16:9
//   cards. Either may be omitted.

import type { ArtRef } from "./art.ts";

export type ArtOverride = { hero?: ArtRef; card?: ArtRef; note: string };

// Reviewed in the contact sheet on 2026-11-05 (Resident Evil Village and Far
// Cry 5 added in Stage 5 for the franchise banners). Games whose automatic picks
// looked right (The Witcher 3, Elden Ring, Control Resonant, Roblox) have no
// entry: they follow the rules.
export const ART_OVERRIDES: Readonly<Record<`igdb:${number}`, ArtOverride>> = {
  "igdb:1020": {
    // The automatic card is a dark night shot; the hero's desert scene with
    // Michael reads far better at card size too.
    card: { kind: "screenshot", imageId: "sc10f95" },
    note: "Grand Theft Auto V: Michael in the desert on cards as well as the hero",
  },
  "igdb:119171": {
    // Every artwork is a logo, an icon, transparent or 3:1 key art; the
    // automatic screenshots are dark or show the gameplay HUD.
    hero: { kind: "screenshot", imageId: "scxvxn" },
    card: { kind: "screenshot", imageId: "scxvy1" },
    note: "Baldur's Gate III: the mind flayer (hero) and Shadowheart casting (cards), no HUD",
  },
  "igdb:25076": {
    // The type-1 artworks are character posters full of quote text. The key
    // art without logo is flagged alpha by IGDB but is fully opaque.
    hero: { kind: "artwork", imageId: "ar3qmt" },
    card: { kind: "screenshot", imageId: "kcfpf8wa8esalk0qkpo5" },
    note: "Red Dead Redemption 2: Arthur at sunset key art (hero), riders in the forest (cards)",
  },
  "igdb:298915": {
    // The logo-free 3840×1240 banner centre-crops to an empty tower; this
    // banner's centre is the soldier.
    hero: { kind: "artwork", imageId: "ar51tu" },
    card: { kind: "artwork", imageId: "ar51tu" },
    note: "Arena Breakout: Infinite: the soldier banner, whose centre crop keeps the subject",
  },
  "igdb:12517": {
    // Landscape screenshots are dialogue boxes; the old pick was a portrait
    // cover cropped to 16:9. The cast artwork is the one landscape image.
    card: { kind: "artwork", imageId: "ar4vc" },
    note: "Undertale: the cast artwork on cards",
  },
  "igdb:55163": {
    // The automatic screenshot is a near-black close-up; it also fronts the
    // Resident Evil franchise banner (Stage 5).
    hero: { kind: "screenshot", imageId: "sc8zrh" },
    card: { kind: "screenshot", imageId: "sc8zrh" },
    note: "Resident Evil Village: Lady Dimitrescu in the castle hall",
  },
  "igdb:28552": {
    // The automatic screenshot is a bull in a farmyard; it also fronts the
    // Far Cry franchise banner (Stage 5).
    hero: { kind: "artwork", imageId: "ar7yi" },
    card: { kind: "artwork", imageId: "ar7yi" },
    note: 'Far Cry 5: the cult\'s "last supper" key art',
  },
  "igdb:1877": {
    // The automatic screenshot is a dark bar; these logo-free artworks are
    // the game's neon look. Avoids the artworks with a logo bottom-left,
    // where the hero title sits.
    hero: { kind: "artwork", imageId: "c6gonpyuhueh0eq38n8l" },
    card: { kind: "artwork", imageId: "pgrmxtckblxm3pfdu5hu" },
    note: "Cyberpunk 2077: neon street crew (hero), Jackie firing (cards)",
  },
};

export function artOverrideFor(id: string): ArtOverride | null {
  return Object.hasOwn(ART_OVERRIDES, id) ? ART_OVERRIDES[id as `igdb:${number}`] : null;
}
