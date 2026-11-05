import { useSyncExternalStore } from "react";
import type { GameProvider } from "./game-id";
import { devGamesProvider } from "./igdb-native";

/**
 * The provider Discovery uses right now (RAWG unless the dev switch says IGDB).
 * Reading it sends nothing and reads no credential, so the Game Library uses it
 * to draw its cards in the shape Discovery does.
 */
export function useActiveGameProvider(): GameProvider {
  return useSyncExternalStore(devGamesProvider.subscribe, devGamesProvider.get);
}
