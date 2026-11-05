// Twitch app access tokens (client-credentials grant) for IGDB.
//
// SERVER / DEV ONLY. This module handles the Client Secret, so it must never be
// imported by the Nexa app bundle (a test enforces that). It exists for the
// local dev check script and for a possible future backend proxy. In the
// desktop app, credentials would live in Rust instead.
//
// - The secret is sent in the POST body, never in a URL.
// - Neither the secret nor the token appears in any error, return value other
//   than getToken(), or log line. Errors have fixed messages and no cause.
// - Concurrent callers share one token request.
// - Tokens are renewed before they expire (24 h early, or at half-life for
//   short-lived tokens) and on demand after a 401.

export const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";

export type TwitchAuthErrorKind =
  | "missing_credentials"
  | "invalid_credentials"
  | "network"
  | "unavailable";

const MESSAGES: Record<TwitchAuthErrorKind, string> = {
  missing_credentials: "Twitch credentials are not set",
  invalid_credentials: "Twitch rejected the credentials",
  network: "Could not reach Twitch",
  unavailable: "Twitch authentication is unavailable",
};

export class TwitchAuthError extends Error {
  readonly kind: TwitchAuthErrorKind;
  constructor(kind: TwitchAuthErrorKind) {
    super(MESSAGES[kind]);
    this.name = "TwitchAuthError";
    this.kind = kind;
  }
}

type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ status: number; json(): Promise<unknown> }>;

export type TwitchTokenSourceOptions = {
  clientId: string;
  clientSecret: string;
  fetchImpl: FetchLike;
  now?: () => number;
  tokenUrl?: string;
  timeoutMs?: number;
};

const DAY_MS = 86_400_000;

export function createTwitchTokenSource(options: TwitchTokenSourceOptions) {
  const clientId = (options.clientId ?? "").trim();
  const clientSecret = (options.clientSecret ?? "").trim();
  const now = options.now ?? (() => Date.now());
  const tokenUrl = options.tokenUrl ?? TWITCH_TOKEN_URL;
  const timeoutMs = options.timeoutMs ?? 10_000;

  let token: string | null = null;
  let renewAt = 0;
  let expiresAt = 0;
  let pending: Promise<string> | null = null;

  const mint = async (): Promise<string> => {
    if (!clientId || !clientSecret) throw new TwitchAuthError("missing_credentials");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: { status: number; json(): Promise<unknown> };
    try {
      res = await options.fetchImpl(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "client_credentials",
        }).toString(),
        signal: controller.signal,
      });
    } catch {
      throw new TwitchAuthError("network");
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      throw new TwitchAuthError("invalid_credentials");
    }
    if (res.status < 200 || res.status >= 300) throw new TwitchAuthError("unavailable");
    let body: { access_token?: unknown; expires_in?: unknown; token_type?: unknown };
    try {
      body = (await res.json()) as typeof body;
    } catch {
      throw new TwitchAuthError("unavailable");
    }
    const access = typeof body?.access_token === "string" ? body.access_token.trim() : "";
    const lifetimeS = typeof body?.expires_in === "number" ? body.expires_in : NaN;
    if (!access || !Number.isFinite(lifetimeS) || lifetimeS <= 0) {
      throw new TwitchAuthError("unavailable");
    }
    const issued = now();
    const lifetimeMs = lifetimeS * 1000;
    token = access;
    expiresAt = issued + lifetimeMs;
    renewAt = issued + Math.max(lifetimeMs / 2, lifetimeMs - DAY_MS);
    return access;
  };

  const fresh = (): Promise<string> => {
    if (!pending) {
      pending = mint().finally(() => {
        pending = null;
      });
    }
    return pending;
  };

  return {
    clientId,
    configured: () => clientId !== "" && clientSecret !== "",
    /** A valid access token, minting or renewing it when needed. */
    async getToken(): Promise<string> {
      if (token && now() < renewAt) return token;
      return fresh();
    },
    /** Force a new token (after a 401). Resolves false when that fails. */
    async renew(): Promise<boolean> {
      token = null;
      try {
        await fresh();
        return true;
      } catch {
        return false;
      }
    },
    /** Token state without the token itself. */
    state: () => ({ hasToken: token !== null, expiresAt: token ? expiresAt : null }),
  };
}

export type TwitchTokenSource = ReturnType<typeof createTwitchTokenSource>;
