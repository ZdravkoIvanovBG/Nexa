// Which metadata provider Games uses on this device (IGDB Stage 7).
//
// The policy, the same in development and release builds:
// - IGDB (DEFAULT_GAME_PROVIDER) unless this device has explicitly chosen the
//   RAWG legacy provider in Settings → Games. Only the exact stored value
//   "rawg" selects RAWG; anything else, including nothing, is IGDB.
// - A stored RAWG key, a synced `gamesEnabled`, saved RAWG games or a RAWG
//   outage never change the choice, and a failing provider never hands over to
//   the other one. Switching is always the user's action.
// - The choice is one device-local key outside the `harbor.` namespace, so
//   backups, cloud side-stores and sign-out wipes never see it, and it isn't
//   part of Settings, so it never reaches Supabase. That matches the IGDB
//   credentials, which are device-local too.
//
// Development builds (http://localhost:1420) and release builds
// (http://tauri.localhost) have separate localStorage, so nothing carries
// over between them: each starts on IGDB. The Stage 4 development switch key
// (`nexa.dev.gamesProvider`) is no longer read and is removed on first start.
//
// No runtime imports, so it runs under `node --test`.

import type { GameProvider } from "./game-id.ts";
import { DEFAULT_GAME_PROVIDER } from "./provider.ts";

export const PROVIDER_CHOICE_KEY = "nexa.gamesProvider";
/** Stage 4's development-only switch. Read by no build any more. */
export const LEGACY_DEV_PROVIDER_KEY = "nexa.dev.gamesProvider";

type KeyStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function resolveGameProvider(stored: unknown): GameProvider {
  return stored === "rawg" ? "rawg" : DEFAULT_GAME_PROVIDER;
}

export type ProviderChoiceStore = {
  get(): GameProvider;
  set(provider: GameProvider): void;
  subscribe(listener: () => void): () => void;
};

export function createProviderChoiceStore(storage: KeyStore | null): ProviderChoiceStore {
  const read = (): GameProvider => {
    if (!storage) return DEFAULT_GAME_PROVIDER;
    try {
      storage.removeItem(LEGACY_DEV_PROVIDER_KEY);
    } catch {
      // Harmless: nothing reads the old key.
    }
    try {
      return resolveGameProvider(storage.getItem(PROVIDER_CHOICE_KEY));
    } catch {
      return DEFAULT_GAME_PROVIDER;
    }
  };
  let current = read();
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set(provider) {
      const next = resolveGameProvider(provider);
      if (next === current) return;
      try {
        if (next === DEFAULT_GAME_PROVIDER) storage?.removeItem(PROVIDER_CHOICE_KEY);
        else storage?.setItem(PROVIDER_CHOICE_KEY, next);
      } catch {
        // Unwritable storage: the choice lasts for this session only.
      }
      current = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
