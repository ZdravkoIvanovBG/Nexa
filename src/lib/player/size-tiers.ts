/**
 * Size tiers for the player surface. The width thresholds are the ones the
 * transport bar has always used; `short` is the vertical equivalent, so a wide
 * but very short window can reclaim the padding the controls normally take.
 */
export type PlayerSize = {
  width: number;
  height: number;
  /** < 1300px — episode labels collapse to icons. */
  mid: boolean;
  /** < 1000px — buttons shrink and gaps tighten. */
  compact: boolean;
  /** < 600px — minimal padding, text labels drop to icons only. */
  tight: boolean;
  /** < 620px tall. */
  short: boolean;
};

export const DEFAULT_PLAYER_SIZE: PlayerSize = {
  width: 0,
  height: 0,
  mid: false,
  compact: false,
  tight: false,
  short: false,
};

export function tiersFor(width: number, height: number): PlayerSize {
  return {
    width,
    height,
    mid: width < 1300,
    compact: width < 1000,
    tight: width < 600,
    short: height < 620,
  };
}
