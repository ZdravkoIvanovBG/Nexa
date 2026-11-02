// Durable upload queue for game rows, separate from lib/cloud/queue.ts on
// purpose. That queue drops a whole batch on a schema error and retries others
// forever, so sharing it would let a missing game table lose movie edits or
// stall movie sync. A problem here stays here.
//
// Nothing in this queue is the only copy of anything: the library blob and its
// stamps are the truth, and the next hydrate re-sends whatever the cloud lacks.
// So an op can be dropped when the cloud can't take it, without losing an edit.
import { GAME_TABLES, type GameOp, type GameOwner, type GameRow, type GameTable } from "./rows.ts";

const DEBOUNCE_MS = 400;
const MAX_BACKOFF_MS = 60_000;
const CHUNK_SIZE = 200;

export type CloudError = { code?: string; status?: number; message?: string };

/** The tables, columns or policies don't exist yet or don't allow this. Won't fix itself. */
const BLOCKED_CODES = new Set(["42501", "42P01", "42P10", "42703", "PGRST204", "PGRST205"]);
/** This row can't be stored, but the rest of the batch may be fine. */
const BAD_ROW_CODES = new Set(["21000", "22001", "22003", "22P02", "23502", "23503", "23514"]);
const AUTH_CODES = new Set(["PGRST301", "PGRST303"]);

export type CloudErrorKind = "blocked" | "bad-row" | "auth" | "transient";

/**
 * `42501` is an RLS refusal, so it counts as blocked rather than as an auth
 * failure: refreshing the session can't fix a policy, and treating it as auth
 * would retry in a tight loop.
 */
export function classifyCloudError(error: CloudError): CloudErrorKind {
  const code = error.code ?? "";
  if (BLOCKED_CODES.has(code)) return "blocked";
  if (BAD_ROW_CODES.has(code)) return "bad-row";
  if (AUTH_CODES.has(code) || error.status === 401) return "auth";
  return "transient";
}

export type DrainOutcome =
  /** Nothing left to send for the signed-in user. */
  | "drained"
  /** Only rows the server rejected are left. They'll be retried after a restart. */
  | "held"
  /** Failed for now, and a retry is scheduled. */
  | "failed"
  /** The cloud can't take game data this session. */
  | "blocked"
  | "no-session";

export type GameQueueDeps = {
  load: () => string | null;
  save: (payload: string) => void;
  send: (table: GameTable, rows: GameRow[]) => Promise<CloudError | null>;
  userId: () => string | null;
  refreshSession: () => Promise<boolean>;
  setTimer: (run: () => void, ms: number) => unknown;
  clearTimer: (timer: unknown) => void;
  /** Everything queued for the signed-in user reached the cloud. */
  onDrained?: () => void;
};

function slotOf(op: Pick<GameOp, "table" | "owner" | "key">): string {
  return `${op.table}|${op.owner.userId}|${op.owner.profileId}|${op.key}`;
}

function isOp(value: unknown): value is GameOp {
  const op = value as Partial<GameOp> | null;
  return (
    !!op &&
    typeof op.key === "string" &&
    typeof op.owner?.userId === "string" &&
    typeof op.owner?.profileId === "string" &&
    !!op.row &&
    GAME_TABLES.includes(op.table as GameTable)
  );
}

export function createGameQueue(deps: GameQueueDeps) {
  /** Coalesced per row, so rapid edits collapse to the final value. */
  const pending = new Map<string, GameOp>();
  /** Rejected rows. Kept out of this session's sends, and not counted as drained. */
  const heldBack = new Set<string>();
  let restored = false;
  let blocked = false;
  let timer: unknown = null;
  let retryTimer: unknown = null;
  let backoff = 0;
  let running: Promise<DrainOutcome> | null = null;

  function restore(): void {
    if (restored) return;
    restored = true;
    try {
      const parsed = JSON.parse(deps.load() ?? "[]") as unknown;
      if (!Array.isArray(parsed)) return;
      for (const op of parsed) if (isOp(op)) pending.set(slotOf(op), op);
    } catch {
      /* a corrupt queue costs nothing: the next hydrate re-sends what's missing */
    }
  }

  function persist(): void {
    deps.save(JSON.stringify(Array.from(pending.values())));
  }

  function sendable(userId: string): GameOp[] {
    return Array.from(pending.values()).filter(
      (op) => op.owner.userId === userId && !heldBack.has(slotOf(op)),
    );
  }

  function nextChunk(userId: string, size: number): GameOp[] {
    const ops = sendable(userId);
    for (const table of GAME_TABLES) {
      const forTable = ops.filter((op) => op.table === table);
      if (forTable.length > 0) return forTable.slice(0, size);
    }
    return [];
  }

  function clearTimers(): void {
    if (timer !== null) deps.clearTimer(timer);
    if (retryTimer !== null) deps.clearTimer(retryTimer);
    timer = null;
    retryTimer = null;
  }

  function schedule(): void {
    if (timer !== null || retryTimer !== null || blocked) return;
    timer = deps.setTimer(() => {
      timer = null;
      void drain();
    }, DEBOUNCE_MS);
  }

  function scheduleRetry(): void {
    backoff = backoff === 0 ? 1000 : Math.min(backoff * 2, MAX_BACKOFF_MS);
    if (retryTimer !== null) return;
    retryTimer = deps.setTimer(() => {
      retryTimer = null;
      void drain();
    }, backoff);
  }

  function block(userId: string): void {
    blocked = true;
    clearTimers();
    for (const op of sendable(userId)) pending.delete(slotOf(op));
    persist();
    console.warn(
      "[game-library] the cloud can't store game data right now, so the library stays on " +
        "this device. It uploads automatically once the tables are available.",
    );
  }

  async function run(): Promise<DrainOutcome> {
    restore();
    if (blocked) return "blocked";
    const userId = deps.userId();
    if (!userId) return "no-session";

    let chunkSize = CHUNK_SIZE;
    let refreshed = false;
    for (;;) {
      const chunk = nextChunk(userId, chunkSize);
      if (chunk.length === 0) break;

      let error: CloudError | null;
      try {
        error = await deps.send(
          chunk[0].table,
          chunk.map((op) => op.row),
        );
      } catch (err) {
        error = { message: err instanceof Error ? err.message : String(err) };
      }

      if (!error) {
        // Only drop what was sent: an edit made mid-flight replaced the op.
        for (const op of chunk) {
          if (pending.get(slotOf(op)) === op) pending.delete(slotOf(op));
        }
        persist();
        backoff = 0;
        continue;
      }

      const kind = classifyCloudError(error);
      if (kind === "blocked") {
        block(userId);
        return "blocked";
      }
      if (kind === "bad-row") {
        if (chunk.length > 1) {
          chunkSize = 1;
        } else {
          heldBack.add(slotOf(chunk[0]));
          console.error("[game-library] the cloud rejected a row, holding it back", error);
        }
        continue;
      }
      if (kind === "auth" && !refreshed && (await deps.refreshSession())) {
        refreshed = true;
        continue;
      }
      console.warn("[game-library] upload failed, will retry", error);
      scheduleRetry();
      return "failed";
    }

    if (heldBack.size > 0) return "held";
    deps.onDrained?.();
    return "drained";
  }

  /** Resolves once this queue has done what it can, including a run already in flight. */
  function drain(): Promise<DrainOutcome> {
    if (running) {
      return running.then((outcome) => {
        const userId = deps.userId();
        return userId && !blocked && sendable(userId).length > 0 ? drain() : outcome;
      });
    }
    running = run().finally(() => {
      running = null;
    });
    return running;
  }

  return {
    enqueue(ops: readonly GameOp[]): void {
      restore();
      if (blocked || ops.length === 0) return;
      for (const op of ops) {
        pending.set(slotOf(op), op);
        heldBack.delete(slotOf(op));
      }
      persist();
      schedule();
    },

    drain,

    /** For a failed pull: what the queue would have learned from a failed send. */
    markBlocked(owner: GameOwner): void {
      restore();
      if (!blocked) block(owner.userId);
    },

    isBlocked(): boolean {
      return blocked;
    },

    dropProfile(profileId: string): void {
      restore();
      for (const [slot, op] of pending) {
        if (op.owner.profileId !== profileId) continue;
        pending.delete(slot);
        heldBack.delete(slot);
      }
      persist();
    },

    pendingCount(): number {
      restore();
      return pending.size;
    },
  };
}

export type GameQueue = ReturnType<typeof createGameQueue>;
