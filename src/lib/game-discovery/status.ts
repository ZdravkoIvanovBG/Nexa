// Session-scoped RAWG state that must not live in persisted settings: keys
// RAWG rejected mid-session (by fingerprint) and sub-endpoints the user's plan
// refuses. Pure module so the client and tests can share it without React.

export type RawgCapability = "screenshots" | "series" | "additions" | "parents";

export type RawgSessionStatus = {
  isRejected(fingerprint: string): boolean;
  markRejected(fingerprint: string): void;
  clearRejected(fingerprint: string): void;
  isCapabilityUnavailable(capability: RawgCapability): boolean;
  markCapabilityUnavailable(capability: RawgCapability): void;
  subscribe(listener: () => void): () => void;
  getVersion(): number;
};

export function createRawgSessionStatus(): RawgSessionStatus {
  const rejected = new Set<string>();
  const unavailable = new Set<RawgCapability>();
  const listeners = new Set<() => void>();
  let version = 0;

  const emit = () => {
    version += 1;
    for (const listener of listeners) listener();
  };

  return {
    isRejected: (fingerprint) => fingerprint !== "" && rejected.has(fingerprint),
    markRejected(fingerprint) {
      if (!fingerprint || rejected.has(fingerprint)) return;
      rejected.add(fingerprint);
      emit();
    },
    clearRejected(fingerprint) {
      if (!rejected.delete(fingerprint)) return;
      emit();
    },
    isCapabilityUnavailable: (capability) => unavailable.has(capability),
    markCapabilityUnavailable(capability) {
      if (unavailable.has(capability)) return;
      unavailable.add(capability);
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getVersion: () => version,
  };
}

export const rawgSessionStatus = createRawgSessionStatus();
