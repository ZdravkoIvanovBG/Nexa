// IGDB client (Stage 1 proof of concept). Transport-injected: the client never
// holds credentials, tokens or headers. A transport (Rust command, a backend
// proxy, or the dev-only fetch transport) attaches them, so the same client
// works with user-supplied credentials or a shared backend.
//
// The client only accepts queries built by ./query.ts, so a raw string body can
// never reach IGDB. Errors carry a fixed message per kind and never the
// endpoint body, a URL, a token or the underlying error.
//
// Limits: IGDB allows 4 requests/second and 8 open requests per Twitch app.
// This client starts at most `ratePerSecond` requests in any 1 s window and
// keeps at most `concurrency` open (default 4 / 4), with identical in-flight
// requests shared.

import { createRequestScheduler } from "../../request-scheduler.ts";
import { normalizeIgdbGames } from "./normalize.ts";
import {
  buildMultiquery,
  buildQuery,
  isIgdbEndpoint,
  type IgdbEndpoint,
  type IgdbQuery,
  type IgdbSubQuery,
} from "./query.ts";
import type { IgdbGame } from "./types.ts";

export type IgdbErrorKind =
  | "missing_credentials"
  | "invalid_credentials"
  | "rate_limited"
  | "network"
  | "unavailable"
  | "bad_request"
  | "bad_response";

const MESSAGES: Record<IgdbErrorKind, string> = {
  missing_credentials: "IGDB credentials are not set",
  invalid_credentials: "IGDB rejected the credentials",
  rate_limited: "IGDB request limit reached",
  network: "Could not reach IGDB",
  unavailable: "IGDB is temporarily unavailable",
  bad_request: "IGDB could not process the request",
  bad_response: "Unexpected response from IGDB",
};

export class IgdbError extends Error {
  readonly kind: IgdbErrorKind;
  readonly status: number | null;

  constructor(kind: IgdbErrorKind, status: number | null = null) {
    super(MESSAGES[kind]);
    this.name = "IgdbError";
    this.kind = kind;
    this.status = status;
  }
}

export function isIgdbError(error: unknown): error is IgdbError {
  return error instanceof IgdbError;
}

export type IgdbTransportRequest = {
  endpoint: IgdbEndpoint;
  /** Apicalypse body. Holds no credentials. */
  body: string;
  signal: AbortSignal;
};

export type IgdbTransportResponse = {
  status: number;
  /** Raw Retry-After header value, when present. */
  retryAfter?: string | null;
  /**
   * Final outcome from a transport that authenticates, rate-limits and retries
   * itself (the Rust transport). The client reports it as-is: retrying here
   * too would multiply the attempts.
   */
  errorKind?: IgdbErrorKind;
  json(): Promise<unknown>;
};

export type IgdbTransport = {
  /** One HTTP attempt. Throwing means a transport failure; the error is discarded unread. */
  send(request: IgdbTransportRequest): Promise<IgdbTransportResponse>;
  /** False when no credentials are configured, so no request should be made. */
  ready?(): boolean;
  /** Renew the access token after a 401. Resolves false when renewal isn't possible. */
  renew?(): Promise<boolean>;
};

export type IgdbRequestInfo = { endpoint: IgdbEndpoint; status: number | null; ms: number };

export type IgdbClientOptions = {
  transport: IgdbTransport;
  /** Diagnostics hook. Receives the endpoint only, never the body. */
  onRequest?: (info: IgdbRequestInfo) => void;
  /** Called when a request fails because credentials are missing or rejected. */
  onCredentialError?: (kind: "missing_credentials" | "invalid_credentials") => void;
  timeoutMs?: number;
  concurrency?: number;
  ratePerSecond?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  isOffline?: () => boolean;
};

export const RATE_LIMIT_BACKOFF_MS = [250, 500, 1000];
const SERVER_RETRY_DELAYS_MS = [500, 1500];
const MAX_RETRY_AFTER_MS = 5000;
const MAX_BODY_LENGTH = 16_384;

function parseRetryAfter(value: string | null | undefined): number | null {
  if (!value) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

function raceAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/**
 * Sliding-window start limiter: at most `perSecond` starts in any 1000 ms.
 * Waiters are served in order.
 */
export function createRateGate(options: {
  perSecond: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}) {
  const perSecond = Math.max(1, Math.floor(options.perSecond));
  const starts: number[] = [];
  let chain: Promise<void> = Promise.resolve();
  return {
    take(): Promise<void> {
      const turn = chain.then(async () => {
        for (;;) {
          const now = options.now();
          while (starts.length > 0 && now - starts[0] >= 1000) starts.shift();
          if (starts.length < perSecond) {
            starts.push(now);
            return;
          }
          await options.sleep(Math.max(1, starts[0] + 1000 - now));
        }
      });
      chain = turn.catch(() => {});
      return turn;
    },
  };
}

export function createIgdbClient(options: IgdbClientOptions) {
  const transport = options.transport;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const isOffline =
    options.isOffline ?? (() => typeof navigator !== "undefined" && navigator.onLine === false);
  const scheduler = createRequestScheduler({ concurrency: options.concurrency ?? 4 });
  const gate = createRateGate({ perSecond: options.ratePerSecond ?? 4, now, sleep });

  // One attempt. Resolves to a response or null on any transport failure; the
  // thrown error is discarded because it may embed headers or URLs.
  const attempt = async (
    endpoint: IgdbEndpoint,
    body: string,
  ): Promise<IgdbTransportResponse | null> => {
    await gate.take();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = now();
    try {
      const res = await transport.send({ endpoint, body, signal: controller.signal });
      options.onRequest?.({ endpoint, status: res.status, ms: now() - started });
      return res;
    } catch {
      options.onRequest?.({ endpoint, status: null, ms: now() - started });
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  const readJson = async (res: IgdbTransportResponse): Promise<unknown> => {
    try {
      return await res.json();
    } catch {
      throw new IgdbError("bad_response", res.status);
    }
  };

  const execute = async (endpoint: IgdbEndpoint, body: string): Promise<unknown> => {
    let networkRetries = 0;
    let serverRetries = 0;
    let rateRetries = 0;
    let renewed = false;
    for (;;) {
      if (isOffline()) throw new IgdbError("network");
      const res = await attempt(endpoint, body);
      if (!res) {
        if (networkRetries < 1) {
          networkRetries += 1;
          continue;
        }
        throw new IgdbError("network");
      }
      if (res.errorKind) throw new IgdbError(res.errorKind, res.status || null);
      const status = res.status;
      if (status >= 200 && status < 300) return readJson(res);
      if (status === 401) {
        if (!renewed && transport.renew) {
          renewed = true;
          let ok = false;
          try {
            ok = await transport.renew();
          } catch {
            ok = false;
          }
          if (ok) continue;
        }
        throw new IgdbError("invalid_credentials", 401);
      }
      if (status === 403) throw new IgdbError("invalid_credentials", 403);
      if (status === 429) {
        if (rateRetries < RATE_LIMIT_BACKOFF_MS.length) {
          const hinted = parseRetryAfter(res.retryAfter);
          const wait =
            hinted !== null && hinted <= MAX_RETRY_AFTER_MS
              ? Math.max(hinted, RATE_LIMIT_BACKOFF_MS[rateRetries])
              : RATE_LIMIT_BACKOFF_MS[rateRetries];
          rateRetries += 1;
          scheduler.pauseFor(wait);
          await sleep(wait);
          continue;
        }
        throw new IgdbError("rate_limited", 429);
      }
      if (status >= 500) {
        if (serverRetries < SERVER_RETRY_DELAYS_MS.length) {
          await sleep(SERVER_RETRY_DELAYS_MS[serverRetries]);
          serverRetries += 1;
          continue;
        }
        throw new IgdbError("unavailable", status);
      }
      // 400 (malformed query) and 404 (unknown endpoint) are our bugs: never retry.
      throw new IgdbError("bad_request", status);
    }
  };

  const send = (endpoint: IgdbEndpoint, body: string, signal?: AbortSignal): Promise<unknown> => {
    if (!isIgdbEndpoint(endpoint)) return Promise.reject(new IgdbError("bad_request"));
    if (body.length === 0 || body.length > MAX_BODY_LENGTH) {
      return Promise.reject(new IgdbError("bad_request"));
    }
    if (transport.ready && !transport.ready()) {
      return Promise.reject(new IgdbError("missing_credentials"));
    }
    const shared = scheduler.schedule(`${endpoint}\n${body}`, () =>
      execute(endpoint, body).catch((error: unknown) => {
        if (
          isIgdbError(error) &&
          (error.kind === "missing_credentials" || error.kind === "invalid_credentials")
        ) {
          options.onCredentialError?.(error.kind);
        }
        throw error;
      }),
    );
    return raceAbort(shared, signal);
  };

  /** Run one query. The query is validated and built locally before anything is sent. */
  function query<T = unknown>(
    endpoint: Exclude<IgdbEndpoint, "multiquery">,
    spec: IgdbQuery,
    signal?: AbortSignal,
  ): Promise<T> {
    let body: string;
    try {
      body = buildQuery(spec);
    } catch {
      return Promise.reject(new IgdbError("bad_request"));
    }
    return send(endpoint, body, signal) as Promise<T>;
  }

  return {
    query,

    /** Up to 10 queries in one request. Resolves to results keyed by sub-query name. */
    async multiquery(
      queries: readonly IgdbSubQuery[],
      signal?: AbortSignal,
    ): Promise<Record<string, unknown>> {
      let body: string;
      try {
        body = buildMultiquery(queries);
      } catch {
        throw new IgdbError("bad_request");
      }
      const data = await send("multiquery", body, signal);
      if (!Array.isArray(data)) throw new IgdbError("bad_response");
      const out: Record<string, unknown> = {};
      for (const entry of data as { name?: unknown; result?: unknown; count?: unknown }[]) {
        if (typeof entry?.name !== "string") continue;
        out[entry.name] = entry.result ?? entry.count ?? null;
      }
      return out;
    },

    /** Normalized public game list (Erotic theme dropped, duplicates removed). */
    async games(spec: IgdbQuery, signal?: AbortSignal): Promise<IgdbGame[]> {
      const data = await query("games", spec, signal);
      if (!Array.isArray(data)) throw new IgdbError("bad_response");
      return normalizeIgdbGames(data);
    },

    snapshot: () => scheduler.snapshot(),
  };
}

export type IgdbClient = ReturnType<typeof createIgdbClient>;
