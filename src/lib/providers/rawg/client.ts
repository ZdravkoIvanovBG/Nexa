import { keyFingerprint } from "../../game-discovery/gates.ts";
import type { RawgCapability, RawgSessionStatus } from "../../game-discovery/status.ts";
import { createRequestScheduler } from "../../request-scheduler.ts";

// RAWG HTTP client. The API key only ever appears as the `key` param of the
// outgoing URL. Errors carry a fixed message per kind and never the URL, the
// key or the underlying error (Rust and plugin-http transport errors embed the
// full request URL), so nothing downstream -- query state, bug reports, logs --
// can leak the key.

export const RAWG_BASE = "https://api.rawg.io/api";

export type RawgErrorKind =
  | "missing_key"
  | "unverified"
  | "invalid_key"
  | "capability_unavailable"
  | "rate_limited"
  | "network"
  | "unavailable"
  | "not_found"
  | "bad_response";

const MESSAGES: Record<RawgErrorKind, string> = {
  missing_key: "RAWG API key is not set",
  unverified: "RAWG API key is not verified",
  invalid_key: "RAWG rejected the API key",
  capability_unavailable: "This RAWG feature is not available for the API key",
  rate_limited: "RAWG request limit reached",
  network: "Could not reach RAWG",
  unavailable: "RAWG is temporarily unavailable",
  not_found: "Not found on RAWG",
  bad_response: "Unexpected response from RAWG",
};

export class RawgError extends Error {
  readonly kind: RawgErrorKind;
  readonly status: number | null;

  constructor(kind: RawgErrorKind, status: number | null = null) {
    super(MESSAGES[kind]);
    this.name = "RawgError";
    this.kind = kind;
    this.status = status;
  }
}

export function isRawgError(error: unknown): error is RawgError {
  return error instanceof RawgError;
}

export type RawgKeyCheck = "valid" | "invalid" | "rate_limited" | "offline" | "unavailable";

export type RawgParams = Record<string, string | number | boolean | null | undefined>;

export type RawgAuth = {
  /** The key as currently stored in settings. */
  key: string;
  /** `rawgKeyVerifiedFor` from settings. */
  verifiedFor: string;
};

export type RawgRequestInfo = { path: string; status: number | null; ms: number };

type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

export type RawgClientOptions = {
  fetchImpl: FetchLike;
  status: RawgSessionStatus;
  base?: string;
  /** Diagnostics hook. Receives the path only -- never the query string. */
  onRequest?: (info: RawgRequestInfo) => void;
  timeoutMs?: number;
  concurrency?: number;
  sleep?: (ms: number) => Promise<void>;
  isOffline?: () => boolean;
};

const SERVER_RETRY_DELAYS_MS = [500, 1500];
const MAX_RATE_LIMIT_WAIT_MS = 5000;

const SUB_ENDPOINTS: Record<string, RawgCapability> = {
  screenshots: "screenshots",
  "game-series": "series",
  additions: "additions",
  "parent-games": "parents",
};

/** Sub-endpoint capability for `/games/{id}/<sub>` paths; null for core endpoints. */
export function capabilityOf(path: string): RawgCapability | null {
  const match = /^\/games\/[^/]+\/([^/]+)\/?$/.exec(path);
  if (!match) return null;
  return SUB_ENDPOINTS[match[1]] ?? null;
}

function buildQuery(params: RawgParams): string {
  const search = new URLSearchParams();
  for (const name of Object.keys(params).sort()) {
    const value = params[name];
    if (value === undefined || value === null || value === "") continue;
    search.set(name, String(value));
  }
  return search.toString();
}

function parseRetryAfter(value: string | null | undefined): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  return null;
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

export function createRawgClient(options: RawgClientOptions) {
  const base = options.base ?? RAWG_BASE;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const isOffline =
    options.isOffline ?? (() => typeof navigator !== "undefined" && navigator.onLine === false);
  const scheduler = createRequestScheduler({ concurrency: options.concurrency ?? 3 });
  const status = options.status;

  const report = (path: string, code: number | null, started: number) => {
    options.onRequest?.({ path, status: code, ms: Date.now() - started });
  };

  // One transport attempt. Resolves to a Response or null on any transport
  // failure; the thrown error is deliberately discarded (it can contain the URL).
  const attempt = async (path: string, url: string): Promise<Response | null> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();
    try {
      const res = await options.fetchImpl(url, { signal: controller.signal });
      report(path, res.status, started);
      return res;
    } catch {
      report(path, null, started);
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  const readJson = async (res: Response): Promise<unknown> => {
    try {
      return await res.json();
    } catch {
      throw new RawgError("bad_response", res.status);
    }
  };

  const execute = async (path: string, url: string, fingerprint: string): Promise<unknown> => {
    let networkRetries = 0;
    let serverRetries = 0;
    let rateLimitRetried = false;
    for (;;) {
      if (isOffline()) throw new RawgError("network");
      const res = await attempt(path, url);
      if (!res) {
        if (networkRetries < 1) {
          networkRetries += 1;
          continue;
        }
        throw new RawgError("network");
      }
      if (res.ok) return readJson(res);
      if (res.status === 401 || res.status === 403) {
        const capability = capabilityOf(path);
        if (capability) {
          status.markCapabilityUnavailable(capability);
          throw new RawgError("capability_unavailable", res.status);
        }
        status.markRejected(fingerprint);
        throw new RawgError("invalid_key", res.status);
      }
      if (res.status === 404) throw new RawgError("not_found", 404);
      if (res.status === 429) {
        const wait = parseRetryAfter(res.headers?.get?.("retry-after"));
        // The free plan is a monthly quota: never loop on 429.
        if (!rateLimitRetried && wait !== null && wait <= MAX_RATE_LIMIT_WAIT_MS) {
          rateLimitRetried = true;
          scheduler.pauseFor(wait);
          await sleep(wait);
          continue;
        }
        throw new RawgError("rate_limited", 429);
      }
      if (res.status >= 500) {
        if (serverRetries < SERVER_RETRY_DELAYS_MS.length) {
          await sleep(SERVER_RETRY_DELAYS_MS[serverRetries]);
          serverRetries += 1;
          continue;
        }
        throw new RawgError("unavailable", res.status);
      }
      throw new RawgError("bad_response", res.status);
    }
  };

  return {
    /** GET a RAWG endpoint. Throws RawgError before any fetch when the key isn't ready. */
    async get<T>(
      path: string,
      params: RawgParams,
      auth: RawgAuth,
      signal?: AbortSignal,
    ): Promise<T> {
      const key = (auth.key ?? "").trim();
      const fingerprint = keyFingerprint(key);
      if (!fingerprint) throw new RawgError("missing_key");
      if (status.isRejected(fingerprint)) throw new RawgError("invalid_key");
      if (auth.verifiedFor !== fingerprint) throw new RawgError("unverified");
      const capability = capabilityOf(path);
      if (capability && status.isCapabilityUnavailable(capability)) {
        throw new RawgError("capability_unavailable");
      }
      const query = buildQuery(params);
      const url = `${base}${path}?${query ? `${query}&` : ""}key=${encodeURIComponent(key)}`;
      // Dedupe on fingerprint + path + params so the raw key is never a map key.
      const dedupeKey = `${fingerprint}|${path}?${query}`;
      const shared = scheduler.schedule(dedupeKey, () => execute(path, url, fingerprint));
      return raceAbort(shared, signal) as Promise<T>;
    },

    /** One cheap request that tells a valid key from an invalid one or a network failure. */
    async validateKey(rawKey: string): Promise<RawgKeyCheck> {
      const key = rawKey.trim();
      if (!key) return "invalid";
      if (isOffline()) return "offline";
      const path = "/genres";
      const url = `${base}${path}?page_size=1&key=${encodeURIComponent(key)}`;
      const res = await attempt(path, url);
      if (!res) return "offline";
      if (res.status === 401 || res.status === 403) return "invalid";
      if (res.status === 429) return "rate_limited";
      if (res.status >= 500) return "unavailable";
      if (!res.ok) return "unavailable";
      try {
        const body = (await res.json()) as { results?: unknown };
        if (!Array.isArray(body?.results)) return "unavailable";
      } catch {
        return "unavailable";
      }
      status.clearRejected(keyFingerprint(key));
      return "valid";
    },
  };
}

export type RawgClient = ReturnType<typeof createRawgClient>;
