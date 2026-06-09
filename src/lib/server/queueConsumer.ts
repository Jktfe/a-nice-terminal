/**
 * queueConsumer — the CAPACITY GATE between the durable curated queue
 * (messageQueueStore) and the local-model worker (Gemma) pane.
 *
 *   [ room_message_queue ] ──maybePullForWorker──► worker pane (pty-inject)
 *            ▲                     │
 *            │                     └── only releases when the worker is FREE
 *            └── pullNext is one-in-flight; this gate adds the SECOND guard:
 *                "don't even pull unless the worker's own state says it can
 *                 take work" — so we never melt a small-context local chair.
 *
 * Two guards, both must pass before a pull:
 *   1. Worker capacity — its agentStateReader state ∈ {Waiting, Available}
 *      (i.e. NOT Working). The state read is INJECTABLE so tests stay
 *      model-free and never touch ~/.ant/state.
 *   2. One-in-flight — messageQueueStore has nothing already 'working' for
 *      this (room, handle). pullNext enforces this atomically, but we also
 *      short-circuit on it so a busy worker is never disturbed.
 *
 * On both passing we pullNext() and hand the claimed item back to the
 * caller, which delivers it to the pane. If the worker is busy or nothing
 * is pending, returns null (the caller does nothing).
 *
 * Spec: docs/curated-queue-spec.md (Gate/consumer section).
 */

import { getIdentityDb } from './db';
import { listQueue, pullNext, type QueueItem } from './messageQueueStore';
import {
  findStateForCwdBasename,
  listSnapshots,
  type AgentStateSnapshot
} from './agentStateReader';
import { classifyStateFreshness } from '../shared/state-freshness';

/**
 * Raw state label as written by a CLI status-line emitter (e.g. "Working",
 * "Waiting", "Available", "Thinking", "Idle"). `null` = unknown/absent.
 */
export type WorkerStateLabel = string | null;

/** Read a worker's current state label. Injectable for tests. */
export type ReadWorkerState = (targetHandle: string) => WorkerStateLabel;

export type MaybePullOpts = {
  /**
   * Override the worker-state lookup. Tests pass a pure fn so the gate is
   * MODEL-FREE and never reads ~/.ant/state. Production omits it and falls
   * back to the default agentStateReader-backed resolver below.
   */
  readWorkerState?: ReadWorkerState;
  /** Injectable clock for deterministic tests. */
  now?: number;
  /** Injectable DB handle (in-memory for tests). */
  db?: ReturnType<typeof getIdentityDb>;
};

/**
 * A worker is FREE to take a new item only when its state is one of these.
 * Anything else (notably "working", but also thinking/response-required/etc.)
 * means hold — don't release the next queued item.
 */
const FREE_LABELS: ReadonlySet<string> = new Set(['waiting', 'available']);

export function isWorkerFree(label: WorkerStateLabel): boolean {
  if (!label) return false; // unknown state → conservative: hold
  return FREE_LABELS.has(label.trim().toLowerCase());
}

/**
 * Default (production) worker-state reader. The worker is a local-model
 * chair (gemini-cli class). We pick the freshest LIVE snapshot whose cwd
 * basename or sessionId hints at this handle; if none is live, return null
 * (treated as "not free" by isWorkerFree, so we hold rather than flood).
 *
 * This is intentionally simple — the precise terminal↔handle resolution is
 * the caller's job in production wiring. Tests inject readWorkerState and
 * never hit this path, so it stays untested-by-design (model/state-file
 * coupled) per the box-safety rule.
 */
function defaultReadWorkerState(targetHandle: string, now: number): WorkerStateLabel {
  const handleKey = targetHandle.replace(/^@/, '').trim().toLowerCase();
  const snaps: AgentStateSnapshot[] = listSnapshots('gemini-cli');
  const live = snaps
    .filter((s) => classifyStateFreshness(s.mtimeMs, now) === 'live')
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  // Prefer a snapshot whose cwd basename / sessionId mentions the handle.
  const matched =
    live.find(
      (s) =>
        (s.cwd ? s.cwd.toLowerCase().includes(handleKey) : false) ||
        s.sessionId.toLowerCase().includes(handleKey)
    ) ?? live[0];
  if (!matched) {
    // Last resort: a direct cwd-basename lookup keyed by the handle.
    const byBasename = findStateForCwdBasename('gemini-cli', handleKey);
    return byBasename?.stateLabel ?? null;
  }
  return matched.stateLabel ?? null;
}

/**
 * Capacity gate. If the worker is free AND nothing is in flight AND
 * something is pending, atomically claim the next item and return it
 * (the caller delivers it to the pane). Otherwise return null.
 */
export function maybePullForWorker(
  roomId: string,
  targetHandle: string,
  opts: MaybePullOpts = {}
): QueueItem | null {
  const now = opts.now ?? Date.now();
  const db = opts.db ?? getIdentityDb();
  const readWorkerState: ReadWorkerState =
    opts.readWorkerState ?? ((h) => defaultReadWorkerState(h, now));

  // Guard 1: worker capacity.
  const label = readWorkerState(targetHandle);
  if (!isWorkerFree(label)) return null;

  // Guard 2 (cheap pre-check): is anything already working for this target?
  // pullNext re-checks this atomically, but short-circuiting here avoids a
  // transaction when the worker's plainly busy on a queued item.
  const working = listQueue(roomId, targetHandle, { status: 'working' }, db);
  if (working.length > 0) return null;

  // Both guards pass → atomically claim the next pending item.
  return pullNext(roomId, targetHandle, now, db);
}
