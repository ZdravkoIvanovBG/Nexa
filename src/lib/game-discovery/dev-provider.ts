// Development-only choice of the Games metadata provider (IGDB Stage 4).
//
// - Production builds always use PRODUCTION_GAME_PROVIDER (RAWG): `dev` is
//   false there, so nothing is read from storage and `set` does nothing.
// - Development builds read one device-local key. It deliberately sits outside
//   the `harbor.` namespace, so backups, cloud side-stores and sign-out wipes
//   never see it, and it isn't part of Settings, so it never reaches Supabase.
// - Any value other than exactly "igdb" means RAWG.
//
// No runtime imports, so it runs under `node --test`.

import type { GameProvider } from "./game-id.ts";
import { PRODUCTION_GAME_PROVIDER } from "./provider.ts";

export const DEV_PROVIDER_KEY = "nexa.dev.gamesProvider";

type KeyStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function resolveActiveGameProvider(dev: boolean, stored: unknown): GameProvider {
  return dev && stored === "igdb" ? "igdb" : PRODUCTION_GAME_PROVIDER;
}

export type DevProviderStore = {
  /** True when this build may switch providers at all. */
  readonly switchable: boolean;
  get(): GameProvider;
  set(provider: GameProvider): void;
  subscribe(listener: () => void): () => void;
};

export function createDevProviderStore(options: {
  dev: boolean;
  storage: KeyStore | null;
}): DevProviderStore {
  const { dev, storage } = options;
  const read = (): GameProvider => {
    if (!dev || !storage) return PRODUCTION_GAME_PROVIDER;
    try {
      return resolveActiveGameProvider(dev, storage.getItem(DEV_PROVIDER_KEY));
    } catch {
      return PRODUCTION_GAME_PROVIDER;
    }
  };
  let current = read();
  const listeners = new Set<() => void>();
  return {
    switchable: dev,
    get: () => current,
    set(provider) {
      if (!dev) return;
      const next = resolveActiveGameProvider(dev, provider);
      if (next === current) return;
      try {
        if (next === PRODUCTION_GAME_PROVIDER) storage?.removeItem(DEV_PROVIDER_KEY);
        else storage?.setItem(DEV_PROVIDER_KEY, next);
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
