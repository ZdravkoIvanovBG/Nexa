// Sortable string positions. A key is chosen to sort between its neighbours, so
// moving an item rewrites that one item instead of renumbering its siblings.
// That is what keeps a reorder to a single synced row, and lets two devices
// reorder different items without overwriting each other.
//
// Keys are read as base-62 fractions and compared by code unit: never sort them
// with SQL ORDER BY, which applies a collation.

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE = DIGITS.length;

// Appending and prepending step through a fixed-width head rather than halving
// the remaining range, which would add a character every few inserts. Each
// direction has about 1,900 steps before falling back to midpoints.
const HEAD_WIDTH = 4;
const HEAD_LIMIT = BASE ** HEAD_WIDTH;
const HEAD_STEP = BASE ** 2;

export const MAX_KEY_LENGTH = 64;

const KEY_PATTERN = /^[0-9A-Za-z]+$/;

export type Ranked = { id: string; position: string };

function encodeHead(value: number): string {
  let out = "";
  let rest = value;
  for (let i = 0; i < HEAD_WIDTH; i++) {
    out = DIGITS[rest % BASE] + out;
    rest = Math.floor(rest / BASE);
  }
  return out;
}

function decodeHead(key: string): number {
  let value = 0;
  for (let i = 0; i < HEAD_WIDTH; i++) {
    value = value * BASE + DIGITS.indexOf(key[i] ?? "0");
  }
  return value;
}

/** A key strictly between `a` and `b`. Neither may end in the zero digit. */
function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    let shared = 0;
    while ((a[shared] ?? "0") === b[shared]) shared++;
    if (shared > 0) return b.slice(0, shared) + midpoint(a.slice(shared), b.slice(shared));
  }
  const low = a ? DIGITS.indexOf(a[0]) : 0;
  const high = b ? DIGITS.indexOf(b[0]) : BASE;
  if (high - low > 1) return DIGITS[Math.round((low + high) / 2)];
  if (b && b.length > 1) return b.slice(0, 1);
  return DIGITS[low] + midpoint(a.slice(1), null);
}

function stepAfter(key: string): string {
  const next = decodeHead(key) + HEAD_STEP;
  return next < HEAD_LIMIT ? encodeHead(next) : midpoint(key, null);
}

function stepBefore(key: string): string {
  const next = decodeHead(key) - HEAD_STEP;
  return next > 0 ? encodeHead(next) : midpoint("", key);
}

/** Two devices filling the same gap get different keys. Never ends in zero. */
function suffixed(key: string, upper: string | null, random: () => number): string {
  const first = DIGITS[Math.floor(random() * BASE)];
  const last = DIGITS[1 + Math.floor(random() * (BASE - 1))];
  const candidate = key + first + last;
  if (upper === null || candidate < upper) return candidate;
  // `key` is a prefix of `upper`, so the suffix overshot. Descend towards it.
  return suffixed(midpoint(key, upper), upper, random);
}

function cleaned(key: string | null): string | null {
  if (key === null || !KEY_PATTERN.test(key)) return null;
  return key.replace(/0+$/, "") || null;
}

/**
 * A key after `a` and before `b`; null means no bound on that side. When the
 * bounds are equal or reversed no such key exists, so this returns one after
 * `a` and the caller moves `b` out of the way. placeAt() does that.
 */
export function keyBetween(
  a: string | null,
  b: string | null,
  random: () => number = Math.random,
): string {
  const lower = cleaned(a);
  const upper = cleaned(b);
  if (lower === null && upper === null) {
    return suffixed(encodeHead(Math.floor(HEAD_LIMIT / 2)), null, random);
  }
  if (lower === null) return suffixed(stepBefore(upper as string), upper, random);
  if (upper === null || lower >= upper) return suffixed(stepAfter(lower), null, random);
  return suffixed(midpoint(lower, upper), upper, random);
}

/** Sort order. The id tiebreak makes every device resolve a collision the same way. */
export function compareRank(a: Ranked, b: Ranked): number {
  if (a.position !== b.position) return a.position < b.position ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** `count` evenly stepped keys, for a new list or a one-off respacing. */
export function spreadKeys(count: number, random: () => number = Math.random): string[] {
  const keys: string[] = [];
  let previous: string | null = null;
  for (let i = 0; i < count; i++) {
    previous = keyBetween(previous, null, random);
    keys.push(previous);
  }
  return keys;
}

/**
 * Position for an item inserted at `index` among `siblings`, which must be in
 * compareRank order and exclude the item. `rewrites` is empty unless neighbours
 * shared a key, or a key grew past MAX_KEY_LENGTH and the list was respaced.
 */
export function placeAt(
  siblings: readonly Ranked[],
  index: number,
  random: () => number = Math.random,
): { position: string; rewrites: Ranked[] } {
  const at = Math.max(0, Math.min(Math.trunc(index), siblings.length));
  const before = at > 0 ? siblings[at - 1].position : null;

  let end = at;
  while (before !== null && end < siblings.length && siblings[end].position <= before) end++;
  const upper = end < siblings.length ? siblings[end].position : null;

  const position = keyBetween(before, upper, random);
  const rewrites: Ranked[] = [];
  let cursor = position;
  for (const sibling of siblings.slice(at, end)) {
    cursor = keyBetween(cursor, upper, random);
    rewrites.push({ id: sibling.id, position: cursor });
  }

  const longest = Math.max(position.length, ...rewrites.map((r) => r.position.length));
  if (longest <= MAX_KEY_LENGTH) return { position, rewrites };

  const keys = spreadKeys(siblings.length + 1, random);
  return {
    position: keys[at],
    rewrites: siblings.map((s, i) => ({ id: s.id, position: keys[i < at ? i : i + 1] })),
  };
}
