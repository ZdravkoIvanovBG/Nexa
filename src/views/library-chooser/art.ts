import type { LibrarySection } from "@/lib/library-frames";

/**
 * Artwork for the chooser cards. Each card shows its original illustration from
 * scenes.tsx until an image is set here. To use one, add the file under
 * src/assets, import it above, and put it in place of `null`. Only use artwork
 * Nexa has the rights to.
 */
export const LIBRARY_ART: Record<LibrarySection, string | null> = {
  movies: null,
  games: null,
};
