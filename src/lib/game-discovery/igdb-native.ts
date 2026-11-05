// The app's handle on the Rust IGDB module. Desktop only: the web build has
// no secure credential store, so every call there reports "desktop_only" and
// IGDB Discovery stays closed.
//
// IGDB credentials are device-local. They don't depend on the active Nexa
// profile or account, aren't part of Settings, cloud sync or backups, and are
// shared by every profile on this device (kid profiles can't open Settings).
//
// Stage 4: Games Discovery uses IGDB only when the development switch selects
// it (see dev-provider.ts); production builds stay on RAWG. The IGDB client and
// provider live in igdb-discovery.ts, loaded with the Games views.

import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  createIgdbNative,
  DESKTOP_ONLY_STATUS,
  IgdbNativeError,
  type IgdbNative,
} from "@/lib/providers/igdb/native";
import { createDevProviderStore } from "./dev-provider";
import { createIgdbStatusStore } from "./igdb-status";

export const igdbNativeAvailable = isTauri();

const desktopOnly: IgdbNative = {
  status: async () => ({ ...DESKTOP_ONLY_STATUS }),
  setCredentials: async () => {
    throw new IgdbNativeError("desktop_only");
  },
  verify: async () => {
    throw new IgdbNativeError("desktop_only");
  },
  clear: async () => {
    throw new IgdbNativeError("desktop_only");
  },
};

export const igdbNative: IgdbNative = igdbNativeAvailable
  ? createIgdbNative((command, args) => invoke(command, args))
  : desktopOnly;

/** Credential status shared by the Games gate and Settings → Games. */
export const igdbStatus = createIgdbStatusStore(() => igdbNative.status());

function devStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** The active Games provider: RAWG in production, switchable in development. */
export const devGamesProvider = createDevProviderStore({
  dev: import.meta.env.DEV,
  storage: import.meta.env.DEV ? devStorage() : null,
});
