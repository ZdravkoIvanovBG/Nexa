// Session view of the device's IGDB credential status, shared by the Games
// gate and Settings → Games. Reading it is a local credential-store lookup
// through the Rust module: it never makes a network request.
//
// `generation` changes whenever the credentials themselves change (saved,
// replaced or removed in Settings). Query keys include it, so results fetched
// with old credentials are never shown for new ones.
//
// Pure: the status loader is injected, so this runs under `node --test`.

/** The subset of the native status the app relies on (see providers/igdb/native.ts). */
export type IgdbStatusLike = {
  storage: "secure" | "unsupported" | "unavailable";
  state: "not_configured" | "configured" | "verified" | "invalid" | "corrupted" | "unavailable";
  verifying: boolean;
  clientIdHint: string | null;
};

export type IgdbStatusSnapshot = {
  /** Null until the first read finishes. */
  status: IgdbStatusLike | null;
  generation: number;
  /** The last read failed; `status` keeps the previous value. */
  failed: boolean;
};

export type IgdbStatusStore = {
  get(): IgdbStatusSnapshot;
  /** Read the status once if it hasn't been read yet. */
  ensure(): void;
  /** Read it again (after a credential error from IGDB, or "Check again"). */
  refresh(): Promise<void>;
  /** Settings reports the status a command returned. */
  publish(status: IgdbStatusLike, options?: { credentialsChanged?: boolean }): void;
  subscribe(listener: () => void): () => void;
};

export function createIgdbStatusStore(load: () => Promise<IgdbStatusLike>): IgdbStatusStore {
  let snapshot: IgdbStatusSnapshot = { status: null, generation: 0, failed: false };
  let started = false;
  // Bumped by every publish and refresh, so a slow read never overwrites a newer status.
  let seq = 0;
  let inflight: Promise<void> | null = null;
  const listeners = new Set<() => void>();

  const set = (next: IgdbStatusSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };

  const refresh = (): Promise<void> => {
    if (inflight) return inflight;
    started = true;
    const mine = ++seq;
    inflight = load()
      .then(
        (status) => {
          if (mine === seq) set({ ...snapshot, status, failed: false });
        },
        () => {
          if (mine === seq) set({ ...snapshot, failed: true });
        },
      )
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };

  return {
    get: () => snapshot,
    ensure() {
      if (!started) void refresh();
    },
    refresh,
    publish(status, options = {}) {
      started = true;
      seq += 1;
      set({
        status,
        generation: snapshot.generation + (options.credentialsChanged ? 1 : 0),
        failed: false,
      });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
