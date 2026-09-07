export type GamePlatform = "steam" | "epic" | "custom";
export type GameSourceKind = "direct_exe" | "steam_uri" | "epic_uri";

export type GameEntry = {
  id: string;
  title: string;
  developer?: string;
  publisher?: string;
  platform: GamePlatform;
  sourceKind: GameSourceKind;
  exePath?: string;
  workingDir?: string;
  launchArgs?: string;
  externalId?: string;
  installDir?: string;
  coverPath?: string;
  heroPath?: string;
  logoPath?: string;
  totalPlaytimeMinutes: number;
  lastPlayedAt?: number;
  addedAt: number;
  hidden: boolean;
};

export type GameSession = {
  id: string;
  gameId: string;
  startedAt: number;
  endedAt?: number;
  durationSec?: number;
  launchKind: GameSourceKind;
};

export type Achievement = {
  id: string;
  gameId: string;
  apiName: string;
  displayName: string;
  description?: string;
  iconUrl?: string;
  iconGrayUrl?: string;
  unlocked: boolean;
  unlockedAt?: number;
  globalPercent?: number;
  fetchedAt: number;
};

export type LauncherSource = {
  id: "steam" | "epic";
  enabled: boolean;
  lastScanAt?: number;
  rootPaths: string[];
};

export type ArtworkKind = "cover" | "hero" | "logo";
export type ArtworkCandidate = {
  source: "steamgriddb" | "rawg" | "steam_cdn";
  url: string;
  kind: ArtworkKind;
  width?: number;
  height?: number;
};

export type GameSort = "recent" | "playtime" | "alpha";
export type GameLibraryQuery = {
  platform?: GamePlatform | "all";
  search?: string;
  sort: GameSort;
};

export type ManualGameInput = {
  title: string;
  developer?: string;
  exePath: string;
  workingDir?: string;
  launchArgs?: string;
  coverSourcePath?: string;
};

export type GameUpdateInput = {
  title?: string;
  developer?: string;
  publisher?: string;
  exePath?: string;
  workingDir?: string;
  launchArgs?: string;
  hidden?: boolean;
};

export type ActiveGameSession = {
  sessionId: string;
  gameId: string;
  startedAtMs: number;
  launchKind: GameSourceKind;
};

export type ScanProgress = {
  found: number;
  total?: number;
  currentTitle: string;
};
