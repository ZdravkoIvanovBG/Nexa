// Bridge to the Rust IGDB module (src-tauri/src/igdb). `invoke` is injected so
// this file has no runtime imports and runs under `node --test`.
//
// Security model:
// - The Client Secret passes through `setCredentials` straight into one
//   `igdb_set_credentials` call and is not kept anywhere here.
// - No command returns the secret or an access token. Status carries only
//   storage support, a credential state and a 4-character Client ID hint.
// - Errors are rebuilt from a fixed list of kinds; nothing from the raw
//   rejection (which could be any value) is echoed.
// - The transport sends only an allowlisted endpoint name and a body built by
//   ./query.ts. Rust re-validates both, attaches credentials, rate-limits and
//   retries; the client is told not to retry on top of that.

import {
  createIgdbClient,
  type IgdbClientOptions,
  type IgdbErrorKind,
  type IgdbTransport,
} from "./client.ts";
import { isIgdbEndpoint } from "./query.ts";

export const IGDB_COMMANDS = {
  status: "igdb_status",
  setCredentials: "igdb_set_credentials",
  verify: "igdb_verify_credentials",
  clear: "igdb_clear_credentials",
  query: "igdb_query",
} as const;

export type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

export type IgdbStorageState = "secure" | "unsupported" | "unavailable";

export type IgdbCredentialState =
  | "not_configured"
  | "configured"
  | "verified"
  | "invalid"
  | "corrupted"
  | "unavailable";

export type IgdbNativeStatus = {
  storage: IgdbStorageState;
  state: IgdbCredentialState;
  verifying: boolean;
  /** Last four characters of the Client ID; null when none is stored. */
  clientIdHint: string | null;
};

export type IgdbNativeErrorKind =
  | IgdbErrorKind
  | "invalid_input"
  | "storage_unsupported"
  | "storage_unavailable"
  | "storage_corrupted"
  | "busy"
  | "forbidden"
  | "desktop_only";

const NATIVE_KINDS: ReadonlySet<string> = new Set<IgdbNativeErrorKind>([
  "missing_credentials",
  "invalid_credentials",
  "rate_limited",
  "network",
  "unavailable",
  "bad_request",
  "bad_response",
  "invalid_input",
  "storage_unsupported",
  "storage_unavailable",
  "storage_corrupted",
  "busy",
  "forbidden",
  "desktop_only",
]);

const STORAGE: ReadonlySet<string> = new Set<IgdbStorageState>([
  "secure",
  "unsupported",
  "unavailable",
]);
const STATES: ReadonlySet<string> = new Set<IgdbCredentialState>([
  "not_configured",
  "configured",
  "verified",
  "invalid",
  "corrupted",
  "unavailable",
]);

export class IgdbNativeError extends Error {
  readonly kind: IgdbNativeErrorKind;
  readonly status: number | null;
  readonly retryAfterMs: number | null;

  constructor(
    kind: IgdbNativeErrorKind,
    status: number | null = null,
    retryAfterMs: number | null = null,
  ) {
    super(`IGDB: ${kind}`);
    this.name = "IgdbNativeError";
    this.kind = kind;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

function safeInt(value: unknown, max: number): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max
    ? value
    : null;
}

/** Rebuild a command rejection from known fields only. */
export function toNativeError(raw: unknown): IgdbNativeError {
  if (raw instanceof IgdbNativeError) return raw;
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const kind =
    typeof value.kind === "string" && NATIVE_KINDS.has(value.kind)
      ? (value.kind as IgdbNativeErrorKind)
      : "unavailable";
  return new IgdbNativeError(
    kind,
    safeInt(value.status, 599),
    safeInt(value.retryAfterMs, 86_400_000),
  );
}

/** Validate a status payload; anything unexpected reads as "unavailable". */
export function toNativeStatus(raw: unknown): IgdbNativeStatus {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const storage =
    typeof value.storage === "string" && STORAGE.has(value.storage) ? value.storage : null;
  const state = typeof value.state === "string" && STATES.has(value.state) ? value.state : null;
  const hint =
    typeof value.clientIdHint === "string" && /^[A-Za-z0-9_-]{1,4}$/.test(value.clientIdHint)
      ? value.clientIdHint
      : null;
  if (!storage || !state) {
    return { storage: "unavailable", state: "unavailable", verifying: false, clientIdHint: null };
  }
  return {
    storage: storage as IgdbStorageState,
    state: state as IgdbCredentialState,
    verifying: value.verifying === true,
    clientIdHint: hint,
  };
}

/** Status shown where the Rust module doesn't exist (the web build). */
export const DESKTOP_ONLY_STATUS: IgdbNativeStatus = Object.freeze({
  storage: "unsupported",
  state: "unavailable",
  verifying: false,
  clientIdHint: null,
});

async function call(invoke: Invoke, command: string, args?: Record<string, unknown>) {
  try {
    return await invoke(command, args);
  } catch (error) {
    throw toNativeError(error);
  }
}

export function createIgdbNative(invoke: Invoke) {
  return {
    async status(): Promise<IgdbNativeStatus> {
      return toNativeStatus(await call(invoke, IGDB_COMMANDS.status));
    },
    /**
     * Verify with Twitch and, only if accepted, store on this device. The
     * previous credentials stay in place when this fails.
     */
    async setCredentials(clientId: string, clientSecret: string): Promise<IgdbNativeStatus> {
      const id = typeof clientId === "string" ? clientId.trim() : "";
      const secret = typeof clientSecret === "string" ? clientSecret.trim() : "";
      if (!id || !secret) throw new IgdbNativeError("invalid_input");
      return toNativeStatus(
        await call(invoke, IGDB_COMMANDS.setCredentials, { clientId: id, clientSecret: secret }),
      );
    },
    async verify(): Promise<IgdbNativeStatus> {
      return toNativeStatus(await call(invoke, IGDB_COMMANDS.verify));
    },
    async clear(): Promise<IgdbNativeStatus> {
      return toNativeStatus(await call(invoke, IGDB_COMMANDS.clear));
    },
  };
}

export type IgdbNative = ReturnType<typeof createIgdbNative>;

/** Native error kinds as the IGDB client reports them. */
export function clientErrorKind(kind: IgdbNativeErrorKind): IgdbErrorKind {
  switch (kind) {
    case "storage_unsupported":
    case "storage_corrupted":
    case "desktop_only":
      return "missing_credentials";
    case "storage_unavailable":
    case "busy":
      return "unavailable";
    case "invalid_input":
    case "forbidden":
      return "bad_request";
    default:
      return kind;
  }
}

/**
 * IGDB transport over the `igdb_query` command. One call is one complete
 * request from the client's point of view: Rust already retried it.
 */
export function createTauriTransport(invoke: Invoke): IgdbTransport {
  return {
    async send({ endpoint, body, signal }) {
      if (!isIgdbEndpoint(endpoint)) {
        return {
          status: 0,
          errorKind: "bad_request",
          json: () => Promise.reject(new Error("bad_request")),
        };
      }
      const failed = (error: IgdbNativeError) => ({
        status: error.status ?? 0,
        retryAfter:
          error.retryAfterMs !== null ? String(Math.ceil(error.retryAfterMs / 1000)) : null,
        errorKind: clientErrorKind(error.kind),
        json: () => Promise.reject(new Error(error.kind)),
      });
      if (signal.aborted) return failed(new IgdbNativeError("network"));
      try {
        const data = await new Promise<unknown>((resolve, reject) => {
          const onAbort = () => reject(new IgdbNativeError("network"));
          signal.addEventListener("abort", onAbort, { once: true });
          invoke(IGDB_COMMANDS.query, { endpoint, body }).then(
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
        return { status: 200, json: async () => data };
      } catch (error) {
        return failed(toNativeError(error));
      }
    },
  };
}

/** Rust's per-query deadline (30 s, retries included) plus headroom. */
export const TAURI_TRANSPORT_TIMEOUT_MS = 35_000;

/**
 * An IGDB client backed by the Rust transport. Games Discovery uses one when
 * IGDB is the active provider (the default; see provider-choice.ts).
 */
export function createNativeIgdbClient(
  invoke: Invoke,
  options: Pick<IgdbClientOptions, "onRequest" | "onCredentialError"> = {},
) {
  return createIgdbClient({
    transport: createTauriTransport(invoke),
    timeoutMs: TAURI_TRANSPORT_TIMEOUT_MS,
    onRequest: options.onRequest,
    onCredentialError: options.onCredentialError,
  });
}
