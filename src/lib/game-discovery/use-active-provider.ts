import { useSyncExternalStore } from "react";
import type { GameProvider } from "./game-id";
import { gamesProviderChoice } from "./igdb-native";

/**
 * The provider Discovery uses right now (IGDB unless this device chose RAWG
 * legacy). Reading it sends nothing and reads no credential, so the Game
 * Library uses it to draw its cards in the shape Discovery does.
 */
export function useActiveGameProvider(): GameProvider {
  return useSyncExternalStore(gamesProviderChoice.subscribe, gamesProviderChoice.get);
}
