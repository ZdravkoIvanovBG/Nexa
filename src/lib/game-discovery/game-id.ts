// Provider-qualified game identities: "rawg:N" and "igdb:N".
//
// A game id always names its metadata provider, so the same number from two
// providers is never the same game: rawg:1942 and igdb:1942 are unrelated.
// Ids are compared as whole strings and never re-keyed: existing personal
// records keep their rawg: ids forever (a future link layer may say that a
// rawg: record and an igdb: game are the same title, without rewriting either).
//
// No runtime imports, so the library rules and tests can use this under
// `node --test`.

export const GAME_PROVIDERS = ["rawg", "igdb"] as const;

export type GameProvider = (typeof GAME_PROVIDERS)[number];

export type RawgGameId = `rawg:${number}`;
export type IgdbGameId = `igdb:${number}`;
export type GameId = RawgGameId | IgdbGameId;

export type ParsedGameId =
  | { provider: "rawg"; providerId: number }
  | { provider: "igdb"; providerId: number };

// Positive integer without leading zeros or signs, so every id has exactly one
// spelling ("rawg:01" and "rawg:+1" are not aliases of "rawg:1").
const GAME_ID = /^(rawg|igdb):([1-9]\d{0,15})$/;

export function isGameProvider(value: unknown): value is GameProvider {
  return value === "rawg" || value === "igdb";
}

/** The provider and numeric id, or null for anything that isn't a valid game id. */
export function parseGameId(value: unknown): ParsedGameId | null {
  if (typeof value !== "string") return null;
  const match = GAME_ID.exec(value);
  if (!match) return null;
  const providerId = Number(match[2]);
  if (!Number.isSafeInteger(providerId)) return null;
  return match[1] === "rawg" ? { provider: "rawg", providerId } : { provider: "igdb", providerId };
}

export function isGameId(value: unknown): value is GameId {
  return parseGameId(value) !== null;
}

export function gameIdOf(provider: "rawg", providerId: number): RawgGameId;
export function gameIdOf(provider: "igdb", providerId: number): IgdbGameId;
export function gameIdOf(provider: GameProvider, providerId: number): GameId;
export function gameIdOf(provider: GameProvider, providerId: number): GameId {
  if (!isGameProvider(provider)) throw new RangeError("Unknown game provider");
  if (!Number.isSafeInteger(providerId) || providerId < 1) {
    throw new RangeError("Invalid provider game id");
  }
  return `${provider}:${providerId}` as GameId;
}

export function providerOf(id: GameId): GameProvider {
  return id.startsWith("igdb:") ? "igdb" : "rawg";
}

/** The RAWG number for a rawg: id; null for any other provider or an invalid id. */
export function rawgIdOf(id: unknown): number | null {
  const parsed = parseGameId(id);
  return parsed?.provider === "rawg" ? parsed.providerId : null;
}
