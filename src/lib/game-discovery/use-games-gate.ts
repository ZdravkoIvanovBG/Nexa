import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { GameProvider } from "./game-id";
import { igdbConfigState, type GamesConfigState } from "./gates";
import { igdbNativeAvailable, igdbStatus } from "./igdb-native";
import { useActiveGameProvider } from "./use-active-provider";
import { useRawgGate, type RawgGateState } from "./use-rawg";

/**
 * The request gate for the active Games provider. Views receive it from
 * GamesFrame and pass it to every query hook; only `ready` lets a request go.
 */
export type GamesGate = {
  provider: GameProvider;
  featureEnabled: boolean;
  /** "ready", or why the active provider can't serve requests yet. */
  config: GamesConfigState | "ready";
  ready: boolean;
  /** Query-cache scope for the active provider. Never contains a credential. */
  scope: string;
  /** RAWG credentials, passed to RAWG requests only. */
  auth: RawgGateState["auth"];
  /** The RAWG gate, kept for RAWG-specific bookkeeping. */
  rawg: RawgGateState;
};

export { useActiveGameProvider };

/**
 * The IGDB credential status, read from the device store the first time it's
 * needed. `needed` false (Games off, or RAWG active) reads nothing at all.
 */
export function useIgdbStatus(needed: boolean) {
  const snapshot = useSyncExternalStore(igdbStatus.subscribe, igdbStatus.get);
  useEffect(() => {
    if (needed && igdbNativeAvailable) igdbStatus.ensure();
  }, [needed]);
  return snapshot;
}

/**
 * The active provider and its cache scope, without reading anything: the
 * app-wide cache cleanup uses this, so it never triggers a credential read.
 */
export function useGamesCacheScope(): {
  featureEnabled: boolean;
  provider: GameProvider;
  scope: string;
} {
  const rawg = useRawgGate();
  const provider = useActiveGameProvider();
  const { generation } = useIgdbStatus(false);
  return {
    featureEnabled: rawg.featureEnabled,
    provider,
    scope: provider === "rawg" ? rawg.fingerprint : `g${generation}`,
  };
}

export function useGamesGate(): GamesGate {
  const rawg = useRawgGate();
  const provider = useActiveGameProvider();
  const igdb = useIgdbStatus(provider === "igdb" && rawg.featureEnabled);
  return useMemo(() => {
    if (provider === "rawg") {
      return {
        provider,
        featureEnabled: rawg.featureEnabled,
        config: rawg.config,
        ready: rawg.ready,
        scope: rawg.fingerprint,
        auth: rawg.auth,
        rawg,
      };
    }
    const config = igdbConfigState(igdb.status, igdbNativeAvailable);
    return {
      provider,
      featureEnabled: rawg.featureEnabled,
      config,
      ready: config === "ready",
      scope: `g${igdb.generation}`,
      auth: rawg.auth,
      rawg,
    };
  }, [provider, rawg, igdb]);
}
