import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { isStaleGamesQuery, type ActiveGamesCache } from "./query-root";
import { useGamesCacheScope } from "./use-games-gate";

/**
 * Mounted once by the app. Turning Games off, switching provider or changing
 * credentials cancels and drops every Games query that no longer applies, so
 * no list, detail or image URL from another provider can be shown, and their
 * memory is released immediately rather than at garbage collection.
 */
export function useGamesCacheIsolation(): void {
  const qc = useQueryClient();
  const games = useGamesCacheScope();
  const provider = games.featureEnabled ? games.provider : null;
  const scope = games.scope;
  useEffect(() => {
    const active: ActiveGamesCache = provider ? { provider, scope } : null;
    const predicate = (query: { queryKey: readonly unknown[] }) =>
      isStaleGamesQuery(query.queryKey, active);
    void qc.cancelQueries({ predicate });
    qc.removeQueries({ predicate });
  }, [qc, provider, scope]);
}
