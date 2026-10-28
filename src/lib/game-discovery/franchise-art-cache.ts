// Device-local cache of franchise card art: { franchiseId -> image URL + RAWG
// id }. Holds only what one card needs so the franchise row doesn't cost one
// RAWG request per card on every launch. Never synced or bundled.

export const FRANCHISE_ART_KEY = "harbor.games.franchiseArt.v1";
export const FRANCHISE_ART_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 50;

export type FranchiseArt = { rawgId: number; slug: string; image: string | null; at: number };

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

function readAll(storage: StorageLike | null): Record<string, FranchiseArt> {
  if (!storage) return {};
  try {
    const parsed = JSON.parse(storage.getItem(FRANCHISE_ART_KEY) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function valid(entry: unknown): entry is FranchiseArt {
  if (!entry || typeof entry !== "object") return false;
  const e = entry as FranchiseArt;
  return (
    typeof e.rawgId === "number" &&
    typeof e.slug === "string" &&
    (e.image === null || typeof e.image === "string") &&
    typeof e.at === "number"
  );
}

export function readFranchiseArt(
  franchiseId: string,
  now: number = Date.now(),
  storage: StorageLike | null = defaultStorage(),
): FranchiseArt | null {
  const entry = readAll(storage)[franchiseId];
  if (!valid(entry)) return null;
  if (now - entry.at > FRANCHISE_ART_TTL_MS || entry.at > now) return null;
  return entry;
}

export function writeFranchiseArt(
  franchiseId: string,
  art: Omit<FranchiseArt, "at">,
  now: number = Date.now(),
  storage: StorageLike | null = defaultStorage(),
): void {
  if (!storage) return;
  const all = readAll(storage);
  all[franchiseId] = { ...art, at: now };
  const entries = Object.entries(all)
    .filter(([, e]) => valid(e) && now - e.at <= FRANCHISE_ART_TTL_MS)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, MAX_ENTRIES);
  try {
    storage.setItem(FRANCHISE_ART_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* storage full or blocked: the cache is optional */
  }
}
