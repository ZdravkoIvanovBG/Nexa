import { supabase } from "@/lib/supabase";
import { setItemWithRecovery } from "@/lib/storage-recovery";
import type { AnyRow, CloudTable, Owner } from "./rows";

const KEY = "harbor.cloud.queue.v1";
const DEBOUNCE_MS = 400;
const MAX_BACKOFF_MS = 60_000;

export type PendingOp =
  | { op: "upsert"; table: CloudTable; owner: Owner; mediaId: string; row: AnyRow }
  | { op: "delete"; table: CloudTable; owner: Owner; mediaId: string };

/**
 * Coalesced by table + media id: a tier drag that reindexes a whole row emits
 * one op per poster, and a rapid add/remove collapses to the final intent.
 */
const pending = new Map<string, PendingOp>();

let timer: number | null = null;
let flushing = false;
let backoff = 0;
let retryTimer: number | null = null;

function slot(o: PendingOp): string {
  return `${o.table}|${o.owner.userId}|${o.owner.profileId}|${o.mediaId}`;
}

function persist(): void {
  const payload = JSON.stringify(Array.from(pending.values()));
  // Best-effort: a full disk must never break the in-memory queue.
  if (!setItemWithRecovery(KEY, payload)) {
    console.warn("[cloud] could not persist the write queue; edits are memory-only until flushed");
  }
}

function restore(): void {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return;
    for (const el of arr) {
      const o = el as PendingOp;
      if (!o || typeof o !== "object") continue;
      if (o.op !== "upsert" && o.op !== "delete") continue;
      if (typeof o.mediaId !== "string" || !o.owner?.userId) continue;
      pending.set(slot(o), o);
    }
  } catch {
    /* corrupt queue is not worth crashing over */
  }
}

let restored = false;

/** Load anything left over from a previous session. Idempotent. */
function ensureRestored(): void {
  if (restored) return;
  restored = true;
  restore();
}

export function enqueue(op: PendingOp): void {
  ensureRestored();
  pending.set(slot(op), op);
  persist();
  schedule();
}

function schedule(): void {
  if (timer !== null || retryTimer !== null) return;
  timer = window.setTimeout(() => {
    timer = null;
    void flush();
  }, DEBOUNCE_MS);
}

function scheduleRetry(): void {
  backoff = backoff === 0 ? 1000 : Math.min(backoff * 2, MAX_BACKOFF_MS);
  if (retryTimer !== null) return;
  retryTimer = window.setTimeout(() => {
    retryTimer = null;
    void flush();
  }, backoff);
}

function isAuthError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  const status = (err as { status?: number } | null)?.status;
  return status === 401 || code === "PGRST301" || code === "42501";
}

/** Push everything queued. Safe to call at any time; concurrent calls no-op. */
export async function flush(): Promise<void> {
  ensureRestored();
  if (flushing || pending.size === 0) return;
  flushing = true;
  const batch = Array.from(pending.values());
  try {
    await sendBatch(batch);
    for (const op of batch) {
      // Only drop what we sent -- anything enqueued mid-flight survives.
      if (pending.get(slot(op)) === op) pending.delete(slot(op));
    }
    persist();
    backoff = 0;
    if (pending.size > 0) schedule();
  } catch (err) {
    if (isAuthError(err)) {
      const { error } = await supabase.auth.refreshSession();
      if (!error) {
        flushing = false;
        void flush();
        return;
      }
    }
    console.warn("[cloud] flush failed, will retry", err);
    scheduleRetry();
  } finally {
    flushing = false;
  }
}

async function sendBatch(batch: PendingOp[]): Promise<void> {
  const upserts = new Map<CloudTable, AnyRow[]>();
  const deletes = new Map<CloudTable, PendingOp[]>();

  for (const op of batch) {
    if (op.op === "upsert") {
      const list = upserts.get(op.table) ?? [];
      list.push(op.row);
      upserts.set(op.table, list);
    } else {
      const list = deletes.get(op.table) ?? [];
      list.push(op);
      deletes.set(op.table, list);
    }
  }

  for (const [table, rows] of upserts) {
    const { error } = await supabase
      .from(table)
      .upsert(rows, { onConflict: "user_id,profile_id,media_id" });
    if (error) throw error;
  }

  for (const [table, ops] of deletes) {
    // Deletes in one table always share an owner in practice, but group anyway
    // so a profile switch mid-queue cannot delete across the wrong scope.
    const byOwner = new Map<string, { owner: Owner; ids: string[] }>();
    for (const op of ops) {
      const k = `${op.owner.userId}|${op.owner.profileId}`;
      const g = byOwner.get(k) ?? { owner: op.owner, ids: [] };
      g.ids.push(op.mediaId);
      byOwner.set(k, g);
    }
    for (const { owner, ids } of byOwner.values()) {
      const { error } = await supabase
        .from(table)
        .delete()
        .eq("user_id", owner.userId)
        .eq("profile_id", owner.profileId)
        .in("media_id", ids);
      if (error) throw error;
    }
  }
}

/** Drop everything queued for a user, e.g. on sign-out. */
export function clearQueue(userId?: string): void {
  if (!userId) {
    pending.clear();
  } else {
    for (const [k, op] of pending) if (op.owner.userId === userId) pending.delete(k);
  }
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
  if (retryTimer !== null) {
    window.clearTimeout(retryTimer);
    retryTimer = null;
  }
  backoff = 0;
  persist();
}

export function pendingCount(): number {
  return pending.size;
}
