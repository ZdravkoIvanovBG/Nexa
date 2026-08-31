/** Stable query-key factory so cache entries stay consistent across views. */
export const queryKeys = {
  catalog: {
    // Keyed by profile, not by account: addons are per-profile, so a bare key
    // would serve one profile's catalog rows to another.
    list: (profileId: string | null) =>
      ["harbor", "catalog", "list", profileId ?? "default"] as const,
    rows: (profileId: string | null) =>
      ["harbor", "catalog", "rows", profileId ?? "default"] as const,
    shelf: (base: string, type: string, id: string) =>
      ["harbor", "catalog", "shelf", base, type, id, 1] as const,
  },
  addons: {
    installed: (profileId: string | null) =>
      ["harbor", "addons", "installed", profileId ?? "default"] as const,
    directory: () => ["harbor", "addons", "directory"] as const,
    manifest: (transportUrl: string) => ["harbor", "addons", "manifest", transportUrl] as const,
  },
  detail: {
    data: (id: string, type: string, tmdbKey: string, language: string) =>
      ["harbor", "detail", id, type, tmdbKey ? "tmdb" : "cinemeta", language] as const,
  },
} as const;
