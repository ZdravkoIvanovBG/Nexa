/**
 * The stepper cap for a Currently Watching card: the highest number
 * actually present in a list of season or episode numbers, not the count of
 * entries -- a season with specials or an aired-but-uncounted gap would
 * otherwise cap short of the real finale. Returns null (meaning "do not
 * cap") when there is nothing usable to go on, so an unknown/failed lookup
 * never traps the stepper at its current value.
 */
export function capFromNumbers(numbers: number[]): number | null {
  const finite = numbers.filter((n) => Number.isFinite(n) && n >= 1);
  if (finite.length === 0) return null;
  return Math.max(...finite);
}
