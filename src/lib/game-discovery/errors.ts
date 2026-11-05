// Provider errors as the kinds the Games error states explain. Both clients
// already reduce failures to fixed kinds with fixed messages (no URLs, bodies
// or credentials), so nothing here can leak one.

import { isIgdbError } from "../providers/igdb/client.ts";
import { isRawgError } from "../providers/rawg/client.ts";

export type GamesErrorKind = "network" | "rate_limited" | "credentials" | "unavailable";

export function gamesErrorKind(error: unknown): GamesErrorKind | null {
  if (isRawgError(error)) {
    switch (error.kind) {
      case "network":
        return "network";
      case "rate_limited":
        return "rate_limited";
      case "missing_key":
      case "unverified":
      case "invalid_key":
        return "credentials";
      default:
        return "unavailable";
    }
  }
  if (isIgdbError(error)) {
    switch (error.kind) {
      case "network":
        return "network";
      case "rate_limited":
        return "rate_limited";
      case "missing_credentials":
      case "invalid_credentials":
        return "credentials";
      default:
        return "unavailable";
    }
  }
  return null;
}
