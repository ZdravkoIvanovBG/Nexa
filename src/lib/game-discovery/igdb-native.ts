// The app's handle on the Rust IGDB module. Desktop only: the web build has
// no secure credential store, so every call there reports "desktop_only".
//
// IGDB credentials are device-local. They don't depend on the active Nexa
// profile or account, aren't part of Settings, cloud sync or backups, and are
// shared by every profile on this device (kid profiles can't open Settings).
//
// Stage 3: nothing here is used by Games Discovery, which stays on RAWG.

import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  createIgdbNative,
  DESKTOP_ONLY_STATUS,
  IgdbNativeError,
  type IgdbNative,
} from "@/lib/providers/igdb/native";

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
