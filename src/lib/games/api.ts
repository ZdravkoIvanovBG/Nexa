import { invoke } from "@tauri-apps/api/core";
import type {
  ActiveGameSession,
  Achievement,
  ArtworkCandidate,
  GameEntry,
  GameLibraryQuery,
  GameSession,
  GameUpdateInput,
  ManualGameInput,
} from "./types";

export function gamesAddManual(input: ManualGameInput): Promise<GameEntry> {
  return invoke("games_add_manual", { input });
}

export function gamesLibraryList(query: GameLibraryQuery): Promise<GameEntry[]> {
  return invoke("games_library_list", { query });
}

export function gamesGet(id: string): Promise<GameEntry> {
  return invoke("games_get", { id });
}

export function gamesUpdate(id: string, patch: GameUpdateInput): Promise<GameEntry> {
  return invoke("games_update", { id, patch });
}

export function gamesDelete(id: string): Promise<void> {
  return invoke("games_delete", { id });
}

export function gamesSessionsList(gameId: string): Promise<GameSession[]> {
  return invoke("games_sessions_list", { gameId });
}

export function gamesLaunch(gameId: string): Promise<string> {
  return invoke("games_launch", { gameId });
}

export function gamesActiveSessions(): Promise<ActiveGameSession[]> {
  return invoke("games_active_sessions");
}

export function gamesForceStop(sessionId: string): Promise<void> {
  return invoke("games_force_stop", { sessionId });
}

export function gamesSteamScanStart(): Promise<string> {
  return invoke("games_steam_scan_start");
}

export function gamesEpicScanStart(): Promise<string> {
  return invoke("games_epic_scan_start");
}

export function gamesArtworkSearch(
  gameTitle: string,
  platformHint?: string,
  externalId?: string,
  steamgriddbApiKey?: string,
): Promise<ArtworkCandidate[]> {
  return invoke("games_artwork_search", {
    gameTitle,
    platformHint,
    externalId,
    steamgriddbApiKey,
  });
}

export function gamesArtworkFetch(gameId: string, kind: string, url: string): Promise<string> {
  return invoke("games_artwork_fetch", { gameId, kind, url });
}

export function gamesArtworkUpload(
  gameId: string,
  kind: string,
  sourcePath: string,
): Promise<string> {
  return invoke("games_artwork_upload", { gameId, kind, sourcePath });
}

export function gamesSteamVerifyKey(steamApiKey: string, steamId64: string): Promise<boolean> {
  return invoke("games_steam_verify_key", { steamApiKey, steamId64 });
}

export function gamesAchievementsFetch(
  gameId: string,
  steamApiKey: string,
  steamId64: string,
): Promise<Achievement[]> {
  return invoke("games_achievements_fetch", { gameId, steamApiKey, steamId64 });
}

export function gamesAchievementsList(gameId: string): Promise<Achievement[]> {
  return invoke("games_achievements_list", { gameId });
}
