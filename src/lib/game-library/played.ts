// Whether a game shown in Discovery is Played (the Completed status) in the
// library, for the green tick on its card. Pure, so node --test can check it.
import { savedEquivalent, type GameIdentity } from "./identity.ts";
import type { GameLibraryData } from "./types.ts";

/**
 * The record decides, found the way the game page finds it: the same game
 * saved from the other provider (by the curated catalog) when that is what's
 * in the library, else the game's own record. So a RAWG card shows the tick
 * for a game played under its IGDB id, and the other way round.
 */
export function isGamePlayed(data: GameLibraryData, game: GameIdentity): boolean {
  const record = savedEquivalent(data, game) ?? data.records[game.gameId];
  return record?.status === "completed";
}
