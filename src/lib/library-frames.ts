// Stack rules for the two libraries, kept free of React so they run under `node --test`.
//
// A `library` frame is My Library, the Movie/Show Library, whether Games is on
// or off. The Game Library is its own `game-library` frame: the sidebar opens it
// as a root page, and a game page's "View in ..." pushes it so Back returns to
// the game.

type FrameLike = { kind: string };

const GAME_FRAME_KINDS: ReadonlySet<string> = new Set([
  "games",
  "game",
  "game-franchise",
  "game-browse",
  "game-library",
]);

/** True when a Game Library frame is in the stack. */
export function hasGameLibraryFrame(stack: readonly FrameLike[]): boolean {
  return stack.some((frame) => frame.kind === "game-library");
}

/**
 * The stack to use once Games is turned off while the Game Library is in it.
 * Going Home would throw away where the user was, so the Game Library falls back
 * to My Library. Game pages go too; anything else, Settings included, stays
 * where it is.
 */
export function withoutGameFrames<F extends FrameLike>(stack: readonly F[], libraryRoot: F): F[] {
  const kept: F[] = [];
  for (const frame of stack) {
    if (frame.kind === "game-library") {
      if (kept.at(-1)?.kind !== "library") kept.push(libraryRoot);
      continue;
    }
    if (GAME_FRAME_KINDS.has(frame.kind)) continue;
    kept.push(frame);
  }
  return kept.length > 0 ? kept : [libraryRoot];
}
