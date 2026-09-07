import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as api from "./api";
import type {
  ActiveGameSession,
  GameEntry,
  GameLibraryQuery,
  ManualGameInput,
  ScanProgress,
} from "./types";

const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type ScanState = {
  platform: "steam" | "epic";
  progress: ScanProgress | null;
  error: string | null;
} | null;

type GamesContextValue = {
  games: GameEntry[];
  loading: boolean;
  activeSessions: Map<string, ActiveGameSession>;
  scan: ScanState;
  refresh: (query?: GameLibraryQuery) => Promise<void>;
  addManual: (input: ManualGameInput) => Promise<GameEntry>;
  removeGame: (id: string) => Promise<void>;
  launch: (gameId: string) => Promise<string>;
  startSteamScan: () => Promise<void>;
  startEpicScan: () => Promise<void>;
  dismissScan: () => void;
};

const GamesContext = createContext<GamesContextValue | null>(null);

const DEFAULT_QUERY: GameLibraryQuery = { platform: "all", sort: "recent" };

export function GamesProvider({ children }: { children: ReactNode }) {
  const [games, setGames] = useState<GameEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSessions, setActiveSessions] = useState<Map<string, ActiveGameSession>>(new Map());
  const [scan, setScan] = useState<ScanState>(null);
  const lastQueryRef = useRef<GameLibraryQuery>(DEFAULT_QUERY);

  const refresh = useCallback(async (query?: GameLibraryQuery) => {
    if (!IS_TAURI) return;
    const q = query ?? lastQueryRef.current;
    lastQueryRef.current = q;
    setLoading(true);
    try {
      const list = await api.gamesLibraryList(q);
      setGames(list);
    } catch {
      // leave the previous list in place on a transient failure
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!IS_TAURI) {
      setLoading(false);
      return;
    }
    void refresh(DEFAULT_QUERY);
    api
      .gamesActiveSessions()
      .then((sessions) => {
        setActiveSessions(new Map(sessions.map((s) => [s.sessionId, s])));
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!IS_TAURI) return;
    const unlisteners: UnlistenFn[] = [];

    listen<{ sessionId: string; gameId: string; kind: string }>("games://launch-started", (e) => {
      setActiveSessions((prev) => {
        const next = new Map(prev);
        next.set(e.payload.sessionId, {
          sessionId: e.payload.sessionId,
          gameId: e.payload.gameId,
          startedAtMs: Date.now(),
          launchKind: e.payload.kind as ActiveGameSession["launchKind"],
        });
        return next;
      });
    })
      .then((u) => unlisteners.push(u))
      .catch(() => {});

    listen<{ sessionId: string; gameId: string }>("games://session-ended", (e) => {
      setActiveSessions((prev) => {
        const next = new Map(prev);
        next.delete(e.payload.sessionId);
        return next;
      });
      void refresh();
    })
      .then((u) => unlisteners.push(u))
      .catch(() => {});

    for (const platform of ["steam", "epic"] as const) {
      listen<ScanProgress>(`games://${platform}-scan-progress`, (e) => {
        setScan({ platform, progress: e.payload, error: null });
      })
        .then((u) => unlisteners.push(u))
        .catch(() => {});
      listen<{ games: GameEntry[] }>(`games://${platform}-scan-done`, () => {
        setScan(null);
        void refresh();
      })
        .then((u) => unlisteners.push(u))
        .catch(() => {});
      listen<{ error: string }>(`games://${platform}-scan-error`, (e) => {
        setScan({ platform, progress: null, error: e.payload.error });
      })
        .then((u) => unlisteners.push(u))
        .catch(() => {});
    }

    return () => {
      unlisteners.forEach((u) => u());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addManual = useCallback(
    async (input: ManualGameInput) => {
      const entry = await api.gamesAddManual(input);
      await refresh();
      return entry;
    },
    [refresh],
  );

  const removeGame = useCallback(
    async (id: string) => {
      await api.gamesDelete(id);
      await refresh();
    },
    [refresh],
  );

  const launch = useCallback(async (gameId: string) => {
    return api.gamesLaunch(gameId);
  }, []);

  const startSteamScan = useCallback(async () => {
    setScan({ platform: "steam", progress: null, error: null });
    await api.gamesSteamScanStart();
  }, []);

  const startEpicScan = useCallback(async () => {
    setScan({ platform: "epic", progress: null, error: null });
    await api.gamesEpicScanStart();
  }, []);

  const dismissScan = useCallback(() => setScan(null), []);

  const value = useMemo<GamesContextValue>(
    () => ({
      games,
      loading,
      activeSessions,
      scan,
      refresh,
      addManual,
      removeGame,
      launch,
      startSteamScan,
      startEpicScan,
      dismissScan,
    }),
    [
      games,
      loading,
      activeSessions,
      scan,
      refresh,
      addManual,
      removeGame,
      launch,
      startSteamScan,
      startEpicScan,
      dismissScan,
    ],
  );

  return <GamesContext.Provider value={value}>{children}</GamesContext.Provider>;
}

export function useGames(): GamesContextValue {
  const v = useContext(GamesContext);
  if (!v) throw new Error("useGames must be used within GamesProvider");
  return v;
}
