import type { LibraryItem } from "@/lib/library-item";
import { safeFetch as fetch } from "@/lib/safe-fetch";

const API = "https://api.strem.io/api";

export type User = {
  _id: string;
  email: string;
  fullname?: string;
  avatar?: string;
};

async function call<T>(path: string, body: object): Promise<T> {
  const res = await fetch(`${API}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message ?? "Request failed");
  return json.result as T;
}

export function login(email: string, password: string) {
  return call<{ authKey: string; user: User }>("login", {
    email,
    password,
    facebook: false,
  });
}

export function getUser(authKey: string) {
  return call<User>("getUser", { authKey });
}

export function logout(authKey: string) {
  return call<unknown>("logout", { authKey });
}

export async function library(authKey: string): Promise<LibraryItem[]> {
  const ids = await call<Array<[string, string]>>("datastoreMeta", {
    authKey,
    collection: "libraryItem",
  });
  if (!ids?.length) return [];
  return call<LibraryItem[]>("datastoreGet", {
    authKey,
    collection: "libraryItem",
    ids: ids.map(([id]) => id),
    all: true,
  });
}

export async function libraryGetOne(authKey: string, id: string): Promise<LibraryItem | null> {
  const items = await call<LibraryItem[]>("datastoreGet", {
    authKey,
    collection: "libraryItem",
    ids: [id],
    all: false,
  }).catch(() => [] as LibraryItem[]);
  return items?.find((it) => it._id === id) ?? null;
}

export async function libraryPut(authKey: string, item: LibraryItem): Promise<void> {
  await call<unknown>("datastorePut", {
    authKey,
    collection: "libraryItem",
    changes: [item],
  });
}

export async function removeStremioLibraryItem(authKey: string, id: string): Promise<void> {
  const items = await call<LibraryItem[]>("datastoreGet", {
    authKey,
    collection: "libraryItem",
    ids: [id],
    all: false,
  });
  const item = items?.find((it) => it._id === id);
  if (!item) return;
  await libraryPut(authKey, {
    ...item,
    removed: true,
    temp: false,
    _mtime: new Date().toISOString(),
  });
}

export async function saveStremioBookmark(
  authKey: string,
  id: string,
  input: { type?: string; name?: string; poster?: string },
): Promise<void> {
  const now = new Date().toISOString();
  const existing = await libraryGetOne(authKey, id).catch(() => null);
  if (existing) {
    await libraryPut(authKey, { ...existing, removed: false, temp: false, _mtime: now });
    return;
  }
  const type =
    input.type === "series" || input.type === "tv" || input.type === "channel" ? "series" : "movie";
  const item = {
    _id: id,
    name: input.name ?? "",
    type,
    poster: input.poster ?? null,
    posterShape: "poster",
    removed: false,
    temp: false,
    _ctime: now,
    _mtime: now,
    state: {
      lastWatched: null,
      timeWatched: 0,
      timeOffset: 0,
      overallTimeWatched: 0,
      timesWatched: 0,
      flaggedWatched: 0,
      duration: 0,
      video_id: null,
      watched: null,
      lastVidReleased: null,
      noNotif: false,
    },
    behaviorHints: { defaultVideoId: null, featuredVideoId: null, hasScheduledVideos: false },
  };
  await libraryPut(authKey, item as unknown as LibraryItem);
}

export async function removeStremioBookmark(authKey: string, id: string): Promise<void> {
  const existing = await libraryGetOne(authKey, id).catch(() => null);
  if (!existing) return;
  const hasProgress =
    (existing.state?.timeOffset ?? 0) > 0 || (existing.state?.flaggedWatched ?? 0) > 0;
  await libraryPut(authKey, {
    ...existing,
    removed: true,
    temp: hasProgress,
    _mtime: new Date().toISOString(),
  });
}
