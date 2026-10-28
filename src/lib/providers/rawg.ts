import { safeFetch } from "@/lib/safe-fetch";
import { rawgSessionStatus } from "@/lib/game-discovery/status";
import { createRawgClient, type RawgRequestInfo } from "./rawg/client";

export {
  RawgError,
  isRawgError,
  type RawgAuth,
  type RawgErrorKind,
  type RawgKeyCheck,
  type RawgParams,
} from "./rawg/client";

type RawgDevStats = { total: number; byPath: Record<string, number>; log: RawgRequestInfo[] };

declare global {
  interface Window {
    /** Dev builds only: RAWG request counts (paths only, no query strings). */
    __harborRawgStats?: (() => RawgDevStats) & { reset: () => void };
  }
}

function createDevRecorder(): (info: RawgRequestInfo) => void {
  let log: RawgRequestInfo[] = [];
  const stats = Object.assign(
    (): RawgDevStats => {
      const byPath: Record<string, number> = {};
      for (const entry of log) byPath[entry.path] = (byPath[entry.path] ?? 0) + 1;
      return { total: log.length, byPath, log: [...log] };
    },
    {
      reset: () => {
        log = [];
      },
    },
  );
  if (typeof window !== "undefined") window.__harborRawgStats = stats;
  return (info) => {
    log.push(info);
    if (log.length > 500) log = log.slice(-500);
  };
}

export const rawg = createRawgClient({
  fetchImpl: (url, init) => safeFetch(url, init),
  status: rawgSessionStatus,
  onRequest: import.meta.env.DEV ? createDevRecorder() : undefined,
});
