import { readResumeEntry } from "@/lib/resume";

/**
 * A row in the user's library.
 *
 * The shape originated with the Stremio API but is now Harbor's own: local
 * Continue Watching, Trakt and Simkl all synthesize these, so it outlives the
 * account layer it came from.
 */
export type LibraryItem = {
  _id: string;
  type: string;
  name: string;
  poster?: string;
  background?: string;
  state?: {
    timeOffset: number;
    duration: number;
    season?: number;
    episode?: number;
    timeWatched?: number;
    flaggedWatched?: number;
    watched?: string;
    video_id?: string;
    lastWatched?: string;
  };
  removed: boolean;
  temp: boolean;
  _ctime: string;
  _mtime: string;
  external?: "simkl";
  upNext?: boolean;
  local?: boolean;
  manualWatched?: boolean;
};

const CW_FINISHED_RATIO = 0.9;

export function libraryMetaType(t: string): import("@/lib/cinemeta").MetaType {
  return t === "series" || t === "channel" || t === "tv" || t === "anime" || t === "other"
    ? t
    : "movie";
}

export function episodeFromVideoId(
  videoId: string | undefined | null,
): { season: number; episode: number } | null {
  if (!videoId) return null;
  const parts = videoId.split(":");
  if (parts.length < 3) return null;
  const season = Number(parts[parts.length - 2]);
  const episode = Number(parts[parts.length - 1]);
  if (!Number.isInteger(season) || !Number.isInteger(episode) || season < 0 || episode < 0) {
    return null;
  }
  return { season, episode };
}

function resumeForItem(i: LibraryItem): { ms: number; t: number } | null {
  const vid = i.state?.video_id ?? "";
  const kitsuThreeSeg = /^(kitsu|mal|anilist|anidb):/.test(i._id) && vid.split(":").length === 3;
  const se = kitsuThreeSeg ? null : episodeFromVideoId(i.state?.video_id);
  const season = i.state?.season ?? (kitsuThreeSeg ? 1 : se?.season);
  const episode = i.state?.episode ?? (kitsuThreeSeg ? Number(vid.split(":")[2]) : se?.episode);
  return readResumeEntry(i._id, season, episode);
}

export function cwSortKey(i: LibraryItem): number {
  const fromState = Date.parse(i.state?.lastWatched ?? i._mtime ?? "");
  if (Number.isFinite(fromState)) return fromState;
  return resumeForItem(i)?.t ?? 0;
}

export function isCwMember(i: LibraryItem): boolean {
  if (i.removed && !i.temp) return false;
  if (!i.state) {
    const local = resumeForItem(i)?.ms ?? 0;
    return local > 0;
  }
  if (i.state.timeOffset > 0) return true;
  if ((i.state.flaggedWatched ?? 0) > 0) return false;
  const local = resumeForItem(i)?.ms ?? 0;
  if (local <= 0) return false;
  const duration = i.state.duration ?? 0;
  if (duration > 0 && local / duration >= CW_FINISHED_RATIO) return false;
  return true;
}
