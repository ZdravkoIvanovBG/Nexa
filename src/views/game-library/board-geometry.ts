// Where a dragged tile would land in a tier row. Pure, so it runs under
// `node --test`. Rows wrap, so tiles are read line by line; the moving tile is
// never among them, so the slot is the index the drop will actually use and
// the marker sits exactly where the tile will go.

export type Box = { left: number; top: number; right: number; bottom: number };

/** `index` among the row's other tiles; `x`, `top` and `bottom` place the marker. */
export type Slot = { index: number; x: number; top: number; bottom: number };

type Line = { first: number; last: number; top: number; bottom: number };

/** Tiles that share a line overlap vertically; a tile starting below the line's middle starts a new one. */
function linesOf(tiles: readonly Box[]): Line[] {
  const lines: Line[] = [];
  tiles.forEach((tile, index) => {
    const line = lines.at(-1);
    if (line && tile.top < (line.top + line.bottom) / 2) {
      line.last = index;
      line.top = Math.min(line.top, tile.top);
      line.bottom = Math.max(line.bottom, tile.bottom);
    } else {
      lines.push({ first: index, last: index, top: tile.top, bottom: tile.bottom });
    }
  });
  return lines;
}

/**
 * @param tiles The row's tiles in order, without the one being dragged.
 * @param empty Where the first tile of an empty row would sit.
 */
export function insertionSlot(
  tiles: readonly Box[],
  x: number,
  y: number,
  { empty, gap = 10, rtl = false }: { empty: Box; gap?: number; rtl?: boolean },
): Slot {
  if (tiles.length === 0) {
    return { index: 0, x: rtl ? empty.right : empty.left, top: empty.top, bottom: empty.bottom };
  }
  const lines = linesOf(tiles);
  const lastLine = lines[lines.length - 1];
  const half = gap / 2;
  const after = (tile: Box) => (rtl ? tile.left - half : tile.right + half);
  const before = (tile: Box) => (rtl ? tile.right + half : tile.left - half);

  // Below the last line is the end of the row.
  if (y > lastLine.bottom) {
    const tile = tiles[lastLine.last];
    return { index: tiles.length, x: after(tile), top: lastLine.top, bottom: lastLine.bottom };
  }
  let line = lines.find((l) => y >= l.top && y <= l.bottom);
  if (!line) {
    const distance = (l: Line) => Math.min(Math.abs(y - l.top), Math.abs(y - l.bottom));
    line = lines.reduce((best, l) => (distance(l) < distance(best) ? l : best));
  }
  for (let i = line.first; i <= line.last; i++) {
    const tile = tiles[i];
    const centre = (tile.left + tile.right) / 2;
    if (rtl ? x > centre : x < centre) {
      return { index: i, x: before(tile), top: line.top, bottom: line.bottom };
    }
  }
  return {
    index: line.last + 1,
    x: after(tiles[line.last]),
    top: line.top,
    bottom: line.bottom,
  };
}
