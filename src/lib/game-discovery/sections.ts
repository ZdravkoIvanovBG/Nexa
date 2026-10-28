import type { GameListFilter } from "./types.ts";

// Discovery rows. Each maps to one real RAWG /games query with an honest label:
// "popular" means RAWG's `added` count (users who added the game), ratings are
// Metacritic unless stated, and dates are release dates.

export type GameSectionId = "popular" | "new" | "acclaimed" | "upcoming" | "classics";

export type GameSection = {
  id: GameSectionId;
  title: string;
  subtitle: string;
  filter: GameListFilter;
  /** Loaded immediately instead of when scrolled near. */
  eager: boolean;
};

function iso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function shiftDays(d: Date, days: number): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() + days);
  return out;
}

function shiftMonths(d: Date, months: number): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setMonth(out.getMonth() + months);
  return out;
}

export function gameSections(today: Date = new Date()): GameSection[] {
  const now = iso(today);
  const yearStart = `${today.getFullYear()}-01-01`;
  return [
    {
      id: "popular",
      title: "Popular this year",
      subtitle: "Most added on RAWG this year",
      filter: { dates: `${yearStart},${now}`, ordering: "-added" },
      eager: true,
    },
    {
      id: "new",
      title: "New releases",
      subtitle: "Last 90 days",
      filter: { dates: `${iso(shiftDays(today, -90))},${now}`, ordering: "-added" },
      eager: true,
    },
    {
      id: "acclaimed",
      title: "Critically acclaimed",
      subtitle: "Metacritic 85+",
      filter: { metacritic: "85,100", ordering: "-metacritic" },
      eager: false,
    },
    {
      id: "upcoming",
      title: "Coming soon",
      subtitle: "Most anticipated on RAWG",
      filter: {
        dates: `${iso(shiftDays(today, 1))},${iso(shiftMonths(today, 12))}`,
        ordering: "-added",
      },
      eager: false,
    },
    {
      id: "classics",
      title: "All-time classics",
      subtitle: "Metacritic 80+, before 2013",
      filter: { dates: "1985-01-01,2012-12-31", metacritic: "80,100", ordering: "-added" },
      eager: false,
    },
  ];
}

/** Genre tiles. Horror is a RAWG tag, not a genre. Opening one costs no request until Browse loads. */
export type GameGenreTile = { title: string; filter: GameListFilter; hue: number };

export const GAME_GENRE_TILES: GameGenreTile[] = [
  { title: "Action", filter: { genres: "action" }, hue: 25 },
  { title: "RPG", filter: { genres: "role-playing-games-rpg" }, hue: 290 },
  { title: "Adventure", filter: { genres: "adventure" }, hue: 150 },
  { title: "Strategy", filter: { genres: "strategy" }, hue: 220 },
  { title: "Shooter", filter: { genres: "shooter" }, hue: 5 },
  { title: "Indie", filter: { genres: "indie" }, hue: 95 },
  { title: "Horror", filter: { tags: "horror" }, hue: 340 },
  { title: "Racing", filter: { genres: "racing" }, hue: 55 },
  { title: "Puzzle", filter: { genres: "puzzle" }, hue: 185 },
  { title: "Sports", filter: { genres: "sports" }, hue: 120 },
];

/** RAWG parent platform ids for the Browse platform filter. */
export const GAME_PLATFORM_FILTERS: { id: string; label: string }[] = [
  { id: "1", label: "PC" },
  { id: "2", label: "PlayStation" },
  { id: "3", label: "Xbox" },
  { id: "7", label: "Nintendo" },
  { id: "4,8", label: "Mobile" },
];

/** RAWG query params for a list filter (exclude_additions keeps DLC out of discovery). */
export function listParams(filter: GameListFilter, page: number, pageSize: number) {
  return {
    page,
    page_size: pageSize,
    exclude_additions: true,
    search: filter.search,
    search_precise: filter.search ? true : undefined,
    genres: filter.genres,
    tags: filter.tags,
    parent_platforms: filter.parentPlatforms,
    developers: filter.developers,
    dates: filter.dates,
    metacritic: filter.metacritic,
    // Relevance ordering while searching: RAWG ranks by match when ordering is absent.
    ordering: filter.search ? filter.ordering : (filter.ordering ?? "-added"),
  };
}
