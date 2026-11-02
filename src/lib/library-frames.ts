// Stack rules for My Library, kept free of React so they run under `node --test`.
//
// A plain `library` frame is what the sidebar opens. With Games off it is the
// Movie Library, exactly as it has always been. With Games on it is the chooser,
// and a `section` frame above it is the library the user picked, which is what
// lets Back, the mouse buttons and the sidebar all work without a new route.

export type LibrarySection = "movies" | "games";

type LibraryFrameLike = { kind: string; section?: LibrarySection };

const GAME_FRAME_KINDS: ReadonlySet<string> = new Set([
  "games",
  "game",
  "game-franchise",
  "game-browse",
]);

function isSectionFrame(frame: LibraryFrameLike): boolean {
  return frame.kind === "library" && frame.section !== undefined;
}

export function hasLibrarySection(stack: readonly LibraryFrameLike[]): boolean {
  return stack.some(isSectionFrame);
}

/** The section of the topmost library frame, which is what the library layer shows. */
export function currentLibrarySection(stack: readonly LibraryFrameLike[]): LibrarySection | null {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].kind === "library") return stack[i].section ?? null;
  }
  return null;
}

/**
 * The stack to use once Games is turned off while a library section is open.
 * Going Home would throw away where the user was, so a section falls back to the
 * plain library frame, which is the Movie Library with Games off. Anything that
 * isn't game-related, Settings included, stays where it is.
 */
export function withoutGameFrames<F extends LibraryFrameLike>(
  stack: readonly F[],
  libraryRoot: F,
): F[] {
  const kept: F[] = [];
  for (const frame of stack) {
    if (GAME_FRAME_KINDS.has(frame.kind)) continue;
    if (isSectionFrame(frame)) {
      if (kept.at(-1)?.kind !== "library") kept.push(libraryRoot);
      continue;
    }
    kept.push(frame);
  }
  return kept.length > 0 ? kept : [libraryRoot];
}
