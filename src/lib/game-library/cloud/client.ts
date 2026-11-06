// Binds the store, queue and hydrate to Supabase and localStorage. Those modules
// take their dependencies as arguments so they can be tested; this is the only
// file here that talks to the real backend.
import { loadProfiles } from "@/lib/profiles";
import { freeStorageSpace, setItemWithRecovery } from "@/lib/storage-recovery";
import { readCachedSupabaseUserId, supabase } from "@/lib/supabase";
import { GAME_QUEUE_KEY, libraryProfiles, onGameProfileForgotten } from "../backup-state.ts";
import { createGameStore } from "../store-core.ts";
import type { LibraryPatch } from "../types.ts";
import { createSyncTracker, hydrateGameLibrary, type PullPage } from "./hydrate.ts";
import { createGameQueue, type CloudError } from "./queue.ts";
import {
  GAME_CONFLICT,
  GAME_PAGE_ORDER,
  patchToOps,
  type GameOwner,
  type GameRow,
  type GameTable,
} from "./rows.ts";

/** Pulls triggered by focus or reconnecting wait this long after the last one. */
const PULL_THROTTLE_MS = 60_000;

function asCloudError(
  error: { code?: string; message?: string } | null,
  status: number,
): CloudError | null {
  return error ? { code: error.code, message: error.message, status } : null;
}

async function send(table: GameTable, rows: GameRow[]): Promise<CloudError | null> {
  const { error, status } = await supabase
    .from(table)
    .upsert(rows, { onConflict: GAME_CONFLICT[table] });
  return asCloudError(error, status);
}

const pull: PullPage = async (table, owner, from, to) => {
  const { data, error, status } = await supabase
    .from(table)
    .select("*")
    .eq("user_id", owner.userId)
    .eq("profile_id", owner.profileId)
    .order(GAME_PAGE_ORDER[table])
    .range(from, to);
  return { rows: data ?? [], error: asCloudError(error, status) };
};

function persist(key: string, value: string): boolean {
  try {
    if (setItemWithRecovery(key, value)) return true;
    freeStorageSpace();
    return setItemWithRecovery(key, value);
  } catch {
    return false;
  }
}

export const gameStore = createGameStore({
  read: (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  write: persist,
  remove: (key) => {
    try {
      localStorage.removeItem(key);
    } catch {
      /* a stranded blob is inert once its profile is gone */
    }
  },
  now: Date.now,
  random: Math.random,
  isPlaceholderProfile: (profileId) =>
    loadProfiles().find((p) => p.id === profileId)?.autoCreated === true,
});

const tracker = createSyncTracker((owner) => gameStore.markSynced(owner.profileId));

export const gameQueue = createGameQueue({
  load: () => localStorage.getItem(GAME_QUEUE_KEY),
  save: (payload) => {
    try {
      if (setItemWithRecovery(GAME_QUEUE_KEY, payload)) return;
    } catch {
      /* falls through: the queue is an optimisation, the blob is the truth */
    }
    console.warn("[game-library] could not persist the upload queue");
  },
  send,
  userId: readCachedSupabaseUserId,
  refreshSession: async () => !(await supabase.auth.refreshSession()).error,
  setTimer: (run, ms) => window.setTimeout(run, ms),
  clearTimer: (timer) => window.clearTimeout(timer as number),
  onDrained: tracker.drained,
});

export function queueLibraryChange(profileId: string, patch: LibraryPatch): void {
  const userId = readCachedSupabaseUserId();
  // With no session the rows stay marked unsynced, and the next hydrate sends them.
  if (userId) gameQueue.enqueue(patchToOps({ userId, profileId }, patch));
}

onGameProfileForgotten((profileId) => {
  gameStore.evict(profileId);
  gameQueue.dropProfile(profileId);
  tracker.forget(profileId);
});

/** A placeholder profile is dropped when the real roster arrives. Its games must not be. */
function adoptPlaceholderLibraries(owner: GameOwner): void {
  const roster = new Set(loadProfiles().map((p) => p.id));
  for (const profileId of libraryProfiles()) {
    if (roster.has(profileId) || !gameStore.isPlaceholderBlob(profileId)) continue;
    gameQueue.enqueue(patchToOps(owner, gameStore.adopt(profileId, owner.profileId)));
  }
}

let lastPullAt = 0;
let pulling: Promise<unknown> | null = null;

export type GameSyncOptions = {
  isCurrent: () => boolean;
  /** Bypasses the throttle: a new session or profile has never been pulled. */
  force?: boolean;
  /**
   * Moves placeholder-profile games into this profile first (the default). Only
   * the active profile may adopt them, so "Sync now" passes false for others.
   */
  adoptPlaceholders?: boolean;
};

export async function syncGameLibrary(owner: GameOwner, options: GameSyncOptions): Promise<void> {
  if (gameQueue.isBlocked()) return;
  const now = Date.now();
  if (!options.force && (pulling || now - lastPullAt < PULL_THROTTLE_MS)) return;
  lastPullAt = now;

  if (options.adoptPlaceholders !== false) adoptPlaceholderLibraries(owner);
  const run = hydrateGameLibrary({
    owner,
    pull,
    drain: () => gameQueue.drain(),
    enqueue: (ops) => gameQueue.enqueue(ops),
    merge: (remote) => gameStore.merge(owner.profileId, remote),
    isCurrent: options.isCurrent,
    markBlocked: () => gameQueue.markBlocked(owner),
    onReconciled: () => tracker.reconciled(owner),
  }).catch((err: unknown) => {
    console.warn("[game-library] sync failed, keeping local data", err);
  });
  pulling = run;
  await run;
  if (pulling === run) pulling = null;
}
