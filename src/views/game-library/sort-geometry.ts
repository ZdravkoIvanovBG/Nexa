// Pure layout maths for usePointerSort, kept apart so it runs under `node --test`.

export type Geometry = { tops: number[]; heights: number[]; from: number };

/**
 * Where the dragged item would land, and how far each item should shift. The
 * landing place follows the pointer rather than the item's middle, so a tall
 * item, like an open collection, moves as soon as the pointer passes a row.
 */
export function arrange(
  geo: Geometry,
  startY: number,
  offsetY: number,
): { target: number; offset: number; shifts: number[] } {
  const { tops, heights, from } = geo;
  const first = tops[0];
  const last = tops[tops.length - 1] + heights[heights.length - 1];
  const top = Math.max(first, Math.min(tops[from] + offsetY, last - heights[from]));
  const pointer = startY + offsetY;

  let target = 0;
  for (let i = 0; i < tops.length; i++) {
    if (i !== from && tops[i] + heights[i] / 2 < pointer) target++;
  }

  // The space the dragged item leaves behind, including the gap after it.
  const gap =
    tops.length > 1
      ? from + 1 < tops.length
        ? tops[from + 1] - (tops[from] + heights[from])
        : tops[from] - (tops[from - 1] + heights[from - 1])
      : 0;
  const space = heights[from] + gap;

  const shifts = tops.map((_, i) => {
    if (i === from) return 0;
    if (from < target && i > from && i <= target) return -space;
    if (target < from && i >= target && i < from) return space;
    return 0;
  });
  return { target, offset: top - tops[from], shifts };
}
