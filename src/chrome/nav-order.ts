/** Nav ids that, when missing from a saved custom order, slot in after their default neighbour. */
export const NEIGHBOUR_PLACED_NAV_IDS: ReadonlySet<string> = new Set(["games"]);

/**
 * Merges a saved custom nav order with the default order. Unknown saved ids are
 * dropped. Missing ids are appended at the end (the historic behaviour), except
 * ids in `neighbourPlaced`, which are inserted right after the nearest preceding
 * default id so a newly added tab lands where it belongs instead of at the bottom.
 */
export function mergeNavOrder(
  saved: readonly string[],
  defaults: readonly string[],
  neighbourPlaced: ReadonlySet<string> = NEIGHBOUR_PLACED_NAV_IDS,
): string[] {
  const known = new Set(defaults);
  const out: string[] = [];
  for (const id of saved) {
    if (known.has(id) && !out.includes(id)) out.push(id);
  }
  const appended: string[] = [];
  for (let i = 0; i < defaults.length; i++) {
    const id = defaults[i];
    if (out.includes(id)) continue;
    if (!neighbourPlaced.has(id)) {
      appended.push(id);
      continue;
    }
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const k = out.indexOf(defaults[j]);
      if (k >= 0) {
        at = k + 1;
        break;
      }
    }
    out.splice(at, 0, id);
  }
  return [...out, ...appended];
}

/** Setting-gated entries. Games is opt-in: hidden unless a caller explicitly enables it. */
export function navFeatureAllows(
  id: string,
  features: { downloads?: boolean; games?: boolean } | undefined,
): boolean {
  if (id === "downloads") return features?.downloads !== false;
  if (id === "games") return features?.games === true;
  return true;
}
