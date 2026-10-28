// Raw RAWG response shapes (only the fields Games reads). Everything is
// optional/nullable: RAWG omits or nulls fields freely.

export type RawgNamed = { id?: number; slug?: string; name?: string } | null;

export type RawgPlatformWrap = { platform?: RawgNamed; released_at?: string | null } | null;

export type RawgListGame = {
  id?: number;
  slug?: string;
  name?: string;
  released?: string | null;
  tba?: boolean;
  background_image?: string | null;
  rating?: number | null;
  ratings_count?: number | null;
  metacritic?: number | null;
  added?: number | null;
  genres?: RawgNamed[] | null;
  parent_platforms?: RawgPlatformWrap[] | null;
  esrb_rating?: RawgNamed;
  short_screenshots?: ({ id?: number; image?: string | null } | null)[] | null;
};

export type RawgGameDetail = RawgListGame & {
  description?: string | null;
  description_raw?: string | null;
  background_image_additional?: string | null;
  website?: string | null;
  developers?: RawgNamed[] | null;
  publishers?: RawgNamed[] | null;
  platforms?: RawgPlatformWrap[] | null;
  tags?: (RawgNamed & { language?: string })[] | null;
  playtime?: number | null;
  alternative_names?: string[] | null;
  screenshots_count?: number | null;
  game_series_count?: number | null;
  additions_count?: number | null;
  parents_count?: number | null;
};

export type RawgPage<T> = {
  count?: number;
  next?: string | null;
  previous?: string | null;
  results?: (T | null)[] | null;
};

export type RawgScreenshot = { id?: number; image?: string | null } | null;
