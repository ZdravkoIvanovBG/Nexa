import { useMemo, useSyncExternalStore } from "react";
import { useSettings } from "@/lib/settings";
import {
  gamesFeatureEnabled,
  keyFingerprint,
  rawgConfigState,
  type RawgConfigState,
} from "./gates";
import { rawgSessionStatus } from "./status";

export type RawgGateState = {
  featureEnabled: boolean;
  config: RawgConfigState;
  ready: boolean;
  fingerprint: string;
  /** Pass to RAWG client calls. */
  auth: { key: string; verifiedFor: string };
};

export function useRawgGate(): RawgGateState {
  const { settings } = useSettings();
  const { gamesEnabled, rawgApiKey, rawgKeyVerifiedFor } = settings;
  const fingerprint = keyFingerprint(rawgApiKey);
  const rejected = useSyncExternalStore(rawgSessionStatus.subscribe, () =>
    rawgSessionStatus.isRejected(fingerprint),
  );
  return useMemo(() => {
    const config = rawgConfigState({ rawgApiKey, rawgKeyVerifiedFor }, () => rejected);
    return {
      featureEnabled: gamesFeatureEnabled({ gamesEnabled }),
      config,
      ready: config === "ready",
      fingerprint,
      auth: { key: rawgApiKey, verifiedFor: rawgKeyVerifiedFor },
    };
  }, [gamesEnabled, rawgApiKey, rawgKeyVerifiedFor, fingerprint, rejected]);
}
