// Which actions a game card's right-click menu offers, by where the game is in
// the library. Pure, so node --test can check every state; game-card-menu.tsx
// turns each action into a labelled item that runs the shared play actions.
import type { GameStage } from "@/lib/game-library/rules";

export type GameMenuAction =
  | "details"
  | "add-wishlist"
  | "view-wishlist"
  | "remove-wishlist"
  | "start"
  | "resume"
  | "pause"
  | "played"
  | "again"
  | "view-playing"
  | "view-tiers"
  | "add-tiers";

export type GameMenuState = {
  /** The library is loaded, the profile isn't a kid's, and the provider can save. */
  canSave: boolean;
  stage: GameStage;
  /** On the Wishlist as a game of its own (not only inside a collection). */
  standalone: boolean;
  /**
   * An unsaved game with a maybe-the-same game saved from the other provider.
   * The game page asks which to keep, so the menu only offers to go there.
   */
  maybeSame: boolean;
  /** Placed on the Tier List. */
  onBoard: boolean;
};

export type GameMenuEntry = GameMenuAction | "separator";

export function gameMenuActions(s: GameMenuState): GameMenuEntry[] {
  const out: GameMenuEntry[] = ["details"];
  if (!s.canSave) return out;
  out.push("separator");
  switch (s.stage) {
    case "none":
      out.push(
        ...(s.maybeSame
          ? (["add-wishlist"] as const)
          : (["add-wishlist", "start", "played"] as const)),
      );
      break;
    case "wishlist":
    case "collection":
      out.push("view-wishlist", "start", "played");
      if (s.standalone) out.push("separator", "remove-wishlist");
      break;
    case "playing":
      out.push("view-playing", "pause", "played");
      break;
    case "paused":
    case "dropped":
      out.push("view-playing", "resume", "played");
      break;
    case "completed":
      out.push("view-playing", "again", s.onBoard ? "view-tiers" : "add-tiers");
      break;
  }
  return out;
}

// ── franchise cards ─────────────────────────────────────────────────────────

export type FranchiseMenuAction = "open" | "add-wishlist" | "view-wishlist" | "start-next";

export type FranchiseMenuState = {
  /** The library is loaded and the profile isn't a kid's. */
  canSave: boolean;
  /** The franchise's collection is on the Wishlist. */
  saved: boolean;
  /** Its games can be loaded and saved with the active provider. */
  canAdd: boolean;
  /** The saved collection has a game not yet started. */
  hasNext: boolean;
};

/** A franchise card's right-click menu: the collection actions its page and the Wishlist offer. */
export function franchiseMenuActions(s: FranchiseMenuState): (FranchiseMenuAction | "separator")[] {
  const out: (FranchiseMenuAction | "separator")[] = ["open"];
  if (!s.canSave || (!s.saved && !s.canAdd)) return out;
  out.push("separator");
  if (!s.saved) out.push("add-wishlist");
  else {
    out.push("view-wishlist");
    if (s.hasNext) out.push("start-next");
  }
  return out;
}
