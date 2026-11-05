// Which saved record a game from Discovery means (IGDB Stage 6). Records keep
// the id they were saved with forever, so the same real game can exist once as
// rawg:N and once as igdb:M. Nothing here rewrites, merges or deletes a record.
// It only answers "is this game already in the library under another id?", so
// the save controls can show the existing entry instead of adding a duplicate.
//
// Evidence, strongest first:
// - The same id: always the same game.
// - The curated catalog: a RAWG record whose slug is a curated slug, and the
//   IGDB id reviewed for that slug in franchises-igdb.ts. Only one-to-one
//   entries count. A slug reviewed as several IGDB games (Assassin's Creed
//   Chronicles is three) links none of them, and a slug or id that appears
//   twice links nothing. Remakes, remasters and editions have their own slugs
//   and ids, so they never link to the original.
// - Nothing else is an identity. Outside the catalog, a game with the same
//   title and year is reported as a *possible* match for the user to decide
//   on, and is never treated as saved.
//
// No runtime imports from the app, so this runs under `node --test`.
import { IGDB_FRANCHISES } from "../game-discovery/franchises-igdb.ts";
import { parseGameId, type GameId } from "../game-discovery/game-id.ts";
import type { GameRef } from "../game-discovery/types.ts";
import { titleKey } from "../providers/igdb/catalog-match.ts";
import { ROOT_PARENT, type GameLibraryData, type GameRecord } from "./types.ts";

type CatalogLinks = {
  igdbBySlug: ReadonlyMap<string, number>;
  slugByIgdb: ReadonlyMap<number, string>;
};

let links: CatalogLinks | null = null;

/** The one-to-one part of the reviewed mapping, built on first use. */
function catalogLinks(): CatalogLinks {
  if (links) return links;
  const bySlug = new Map<string, number | null>();
  const byId = new Map<number, string | null>();
  for (const map of Object.values(IGDB_FRANCHISES)) {
    for (const [slug, value] of Object.entries(map.entries)) {
      const ids = typeof value === "number" ? [value] : [...value];
      // Several IGDB games for one slug: the RAWG record is none of them alone.
      const single = ids.length === 1 ? ids[0] : null;
      const seen = bySlug.get(slug);
      bySlug.set(slug, seen === undefined || seen === single ? single : null);
      for (const id of ids) {
        const prior = byId.get(id);
        byId.set(id, ids.length === 1 && (prior === undefined || prior === slug) ? slug : null);
      }
    }
  }
  const igdbBySlug = new Map<string, number>();
  for (const [slug, id] of bySlug)
    if (id !== null && byId.get(id) === slug) igdbBySlug.set(slug, id);
  const slugByIgdb = new Map<number, string>();
  for (const [slug, id] of igdbBySlug) slugByIgdb.set(id, slug);
  links = { igdbBySlug, slugByIgdb };
  return links;
}

export type GameIdentity = { gameId: GameId; slug: string };

/**
 * The reviewed IGDB id that names this game, or null when the catalog doesn't
 * know it one-to-one. A RAWG game is known by its curated slug, an IGDB game
 * by its id. Two games with the same key are the same game.
 */
export function catalogKey(game: GameIdentity): number | null {
  const parsed = parseGameId(game.gameId);
  if (!parsed) return null;
  const { igdbBySlug, slugByIgdb } = catalogLinks();
  if (parsed.provider === "rawg") return igdbBySlug.get(game.slug) ?? null;
  return slugByIgdb.has(parsed.providerId) ? parsed.providerId : null;
}

/** Same game by the catalog. A different id is required: an id always equals itself. */
export function sameCatalogGame(a: GameIdentity, b: GameIdentity): boolean {
  if (a.gameId === b.gameId) return false;
  const key = catalogKey(a);
  return key !== null && key === catalogKey(b);
}

type LibraryIndex = {
  /** Records that are on a list: a live Wishlist row, a live collection's member, or started. */
  present: ReadonlySet<GameId>;
  /** Present records by catalog key. */
  byKey: ReadonlyMap<number, GameRecord[]>;
  /** Present records the catalog doesn't know, by title key, for possible matches. */
  byTitle: ReadonlyMap<string, GameRecord[]>;
};

// Library snapshots are immutable (the store replaces the object on every
// change), so an index is built once per snapshot, however often it's asked.
const indexes = new WeakMap<GameLibraryData, LibraryIndex>();

function indexOf(data: GameLibraryData): LibraryIndex {
  const cached = indexes.get(data);
  if (cached) return cached;
  const present = new Set<GameId>();
  for (const entry of Object.values(data.queue)) {
    if (!entry.gameId || entry.deletedAt !== null) continue;
    if (entry.parentId !== ROOT_PARENT) {
      const parent = data.queue[entry.parentId];
      if (!parent || parent.kind !== "collection" || parent.deletedAt !== null) continue;
    }
    present.add(entry.gameId);
  }
  for (const record of Object.values(data.records)) {
    if (record.status !== null) present.add(record.gameId);
  }
  const byKey = new Map<number, GameRecord[]>();
  const byTitle = new Map<string, GameRecord[]>();
  for (const id of [...present].sort()) {
    const record = data.records[id];
    if (!record) continue;
    const key = catalogKey(record);
    if (key !== null) {
      byKey.set(key, [...(byKey.get(key) ?? []), record]);
      continue;
    }
    const title = titleKey(record.name);
    if (title) byTitle.set(title, [...(byTitle.get(title) ?? []), record]);
  }
  const index = { present, byKey, byTitle };
  indexes.set(data, index);
  return index;
}

/** Whether a record is on any list, so it counts as saved. */
export function isPresent(data: GameLibraryData, gameId: GameId): boolean {
  return indexOf(data).present.has(gameId);
}

/**
 * The record already in the library for this game under another provider's
 * id, by the catalog only. Null when the game is saved under its own id (that
 * record wins), when the catalog doesn't know it, or when nothing equivalent is
 * on a list. A record that is on no list doesn't count: saving then starts
 * clean under the game's own id.
 */
export function savedEquivalent(data: GameLibraryData, game: GameIdentity): GameRecord | null {
  const index = indexOf(data);
  if (index.present.has(game.gameId)) return null;
  const key = catalogKey(game);
  if (key === null) return null;
  return index.byKey.get(key)?.find((record) => record.gameId !== game.gameId) ?? null;
}

/** The snapshot reference a record was saved with, unchanged. */
export function recordRef(record: GameRecord): GameRef {
  const snapshot = {
    slug: record.slug,
    name: record.name,
    released: record.released,
    image: record.image,
  };
  return record.provider === "rawg"
    ? { provider: "rawg", rawgId: record.rawgId, ...snapshot }
    : { provider: "igdb", igdbId: record.igdbId, ...snapshot };
}

/**
 * What a save should write for this game: the existing equivalent record when
 * the catalog says it's already saved, so one game keeps one personal record;
 * otherwise the game's own ref. The equivalent's snapshot is never replaced.
 */
export function libraryRef(data: GameLibraryData, ref: GameRef): GameRef {
  const gameId: GameId = ref.provider === "rawg" ? `rawg:${ref.rawgId}` : `igdb:${ref.igdbId}`;
  const equivalent = savedEquivalent(data, { gameId, slug: ref.slug });
  return equivalent ? recordRef(equivalent) : ref;
}

/** libraryRef for each, dropping refs that resolve to a game already listed. */
export function libraryRefs(data: GameLibraryData, refs: readonly GameRef[]): GameRef[] {
  const seen = new Set<string>();
  const out: GameRef[] = [];
  for (const ref of refs) {
    const resolved = libraryRef(data, ref);
    const id = resolved.provider === "rawg" ? `rawg:${resolved.rawgId}` : `igdb:${resolved.igdbId}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(resolved);
  }
  return out;
}

function yearOf(released: string | null): string | null {
  return released && /^\d{4}/.test(released) ? released.slice(0, 4) : null;
}

/**
 * Saved records from another provider with the same title and release year,
 * for a game the catalog doesn't know. Advisory only: the user decides, and
 * nothing is linked. Empty when the catalog knows either side, because then
 * the catalog has already said whether they are the same game.
 */
export function possibleMatches(
  data: GameLibraryData,
  game: GameIdentity & { name: string; released: string | null },
): GameRecord[] {
  if (catalogKey(game) !== null) return [];
  const index = indexOf(data);
  if (index.present.has(game.gameId)) return [];
  const year = yearOf(game.released);
  const title = titleKey(game.name);
  if (!year || !title) return [];
  const provider = parseGameId(game.gameId)?.provider;
  return (index.byTitle.get(title) ?? []).filter(
    (record) => record.provider !== provider && yearOf(record.released) === year,
  );
}
