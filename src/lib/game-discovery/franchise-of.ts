// The curated franchise a game belongs to, for the game page's "Part of the
// franchise" link and "More in this series" row. Exact identities only:
// a RAWG game by its curated slug (as before), an IGDB game by its id in the
// reviewed mapping. Never by name, so unrelated same-named games stay out.

import { franchiseById, franchiseForSlug, type FranchiseDef } from "./franchises.ts";
import { igdbFranchiseOf } from "./franchises-igdb.ts";
import { parseGameId } from "./game-id.ts";

export function franchiseOfGame(game: { id: string; slug: string }): FranchiseDef | null {
  const parsed = parseGameId(game.id);
  if (!parsed) return null;
  if (parsed.provider === "rawg") return franchiseForSlug(game.slug);
  const hit = igdbFranchiseOf(parsed.providerId);
  return hit ? franchiseById(hit.franchiseId) : null;
}
