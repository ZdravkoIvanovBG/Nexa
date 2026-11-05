// IGDB Discovery wiring (Stage 4): one IGDB client for the app and one
// provider per cache scope. Imported only by the Games query hooks, so it loads
// with the Games views and never runs while Games is off.

import { invoke } from "@tauri-apps/api/core";
import type { IgdbRequestInfo } from "@/lib/providers/igdb/client";
import { createNativeIgdbClient } from "@/lib/providers/igdb/native";
import { createIgdbProvider } from "@/lib/providers/igdb/provider";
import { igdbNativeAvailable, igdbStatus } from "./igdb-native";
import type { GameMetadataProvider } from "./provider";

type IgdbDevStats = {
  total: number;
  byEndpoint: Record<string, number>;
  log: IgdbRequestInfo[];
};

declare global {
  interface Window {
    /** Dev builds only: IGDB request counts (endpoint names only, never bodies). */
    __harborIgdbStats?: (() => IgdbDevStats) & { reset: () => void };
  }
}

function createDevRecorder(): (info: IgdbRequestInfo) => void {
  let log: IgdbRequestInfo[] = [];
  const stats = Object.assign(
    (): IgdbDevStats => {
      const byEndpoint: Record<string, number> = {};
      for (const entry of log) byEndpoint[entry.endpoint] = (byEndpoint[entry.endpoint] ?? 0) + 1;
      return { total: log.length, byEndpoint, log: [...log] };
    },
    {
      reset: () => {
        log = [];
      },
    },
  );
  if (typeof window !== "undefined") window.__harborIgdbStats = stats;
  return (info) => {
    log.push(info);
    if (log.length > 500) log = log.slice(-500);
  };
}

// One client for the app, created on first use: its in-flight dedupe and
// rate gate must see every IGDB request (Rust enforces the hard limits).
let client: ReturnType<typeof createNativeIgdbClient> | null = null;
function igdbClient() {
  client ??= createNativeIgdbClient((command, args) => invoke(command, args), {
    onRequest: import.meta.env.DEV ? createDevRecorder() : undefined,
    onCredentialError: () => void igdbStatus.refresh(),
  });
  return client;
}

// One provider per cache scope, so its popularity ranking is shared by every
// hook instead of being rebuilt per component.
let provider: GameMetadataProvider | null = null;
export function igdbProviderFor(scope: string): GameMetadataProvider {
  if (!igdbNativeAvailable) throw new Error("IGDB needs the desktop app");
  if (provider?.scope !== scope) provider = createIgdbProvider(igdbClient(), scope);
  return provider;
}
