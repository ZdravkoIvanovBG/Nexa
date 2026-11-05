// Fetch-based IGDB transport. SERVER / DEV ONLY: it attaches the Client-ID and
// bearer token, so it belongs in the dev check script or a backend proxy, never
// in the app bundle (a test enforces that).

import type { IgdbTransport, IgdbTransportResponse } from "../client.ts";
import { isIgdbEndpoint } from "../query.ts";
import { TwitchAuthError, type TwitchTokenSource } from "./twitch-auth.ts";

export const IGDB_API_BASE = "https://api.igdb.com/v4";

type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{
  status: number;
  headers?: { get(name: string): string | null };
  json(): Promise<unknown>;
}>;

export function createFetchTransport(options: {
  fetchImpl: FetchLike;
  tokens: TwitchTokenSource;
  base?: string;
}): IgdbTransport {
  const base = options.base ?? IGDB_API_BASE;
  const tokens = options.tokens;
  return {
    ready: () => tokens.configured(),
    renew: () => tokens.renew(),
    async send({ endpoint, body, signal }): Promise<IgdbTransportResponse> {
      if (!isIgdbEndpoint(endpoint)) throw new Error("endpoint");
      let token: string;
      try {
        token = await tokens.getToken();
      } catch (error) {
        // Rejected credentials read as a 401 so the client reports them properly;
        // anything else is a transport failure.
        if (error instanceof TwitchAuthError && error.kind !== "network") {
          return { status: 401, json: async () => null };
        }
        throw new Error("auth");
      }
      const res = await options.fetchImpl(`${base}/${endpoint}`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Client-ID": tokens.clientId,
          Authorization: `Bearer ${token}`,
          "Content-Type": "text/plain",
        },
        body,
        signal,
      });
      return {
        status: res.status,
        retryAfter: res.headers?.get("retry-after") ?? null,
        json: () => res.json(),
      };
    },
  };
}
