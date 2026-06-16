/**
 * roomWorkerEmitter — SAFE HALF of the ANT→Claude mention bridge.
 *
 * Called best-effort from the message POST route after a message is persisted
 * (beside fanoutMessageToRoomTerminals). Decides whether to cold-start a Claude
 * worker for the room, applying every gate that lives entirely in-ANT:
 *   - direct @-mention of the worker handle only (protects the daily run cap)
 *   - loop guard (never react to the worker's own posts)
 *   - circuit breaker (consecutive-failure suppression)
 *   - rate limit (fires/min/room)
 *   - per-room lease (concurrency 1 → ~one session per active period)
 *
 * The actual launch (Funnel + per-fire mcpGrant + routines.fire) is the EXPOSED
 * half and is injected via setRoomWorkerLauncher(). Until @speedy's trust-tier
 * proofs pass and the real launcher is wired, the default launcher is a gated
 * no-op stub — so importing/wiring this module has no external effect.
 *
 * Params (TTL/breaker/rate-limit) per @speedy's security spec, 2026-06-08.
 * Design: /Users/ant/ANT-claude-mention-bridge-design.md (v3, §6.2/§6.5).
 */

import { listBareMentionHandles } from '$lib/chat/mentionRouting';
import {
  tryAcquireLease,
  recordSession,
  releaseLease,
  logFire,
  recentLaunchCount,
  breakerOpen
} from './roomWorkerLease';

/** The agent handle the bridge wakes. Single-owner for v1. */
export const WORKER_HANDLE = '@jwpkCD';

/**
 * Lease TTL = max worker runtime before the lease auto-reclaims on crash.
 * NOTE: distinct from the per-fire mcpGrant token TTL (~120s, one drain+reply
 * round) which lives in the exposed half — this is the outer safety reclaim.
 */
const LEASE_TTL_MS = 5 * 60_000;
const RATE_LIMIT_MAX = 6; // launches
const RATE_LIMIT_WINDOW_MS = 60_000; // per minute per room
const BREAKER_THRESHOLD = 3; // consecutive failures
const BREAKER_COOLDOWN_MS = 5 * 60_000;

export type WorkerLaunchContext = {
  roomId: string;
  messageId: string;
  authorHandle: string;
  body: string;
};

export type WorkerLaunchResult = {
  launched: boolean;
  sessionId?: string;
  sessionUrl?: string | null;
  fireTokenId?: string | null;
  reason?: string;
};

export type WorkerLauncher = (ctx: WorkerLaunchContext) => Promise<WorkerLaunchResult>;

/**
 * Default launcher — GATED. Logs and declines. The exposed half replaces this
 * via setRoomWorkerLauncher() only after @speedy's 4 trust-tier proofs pass on
 * a staged build. Keeping it here means the safe half is fully testable and
 * shippable with zero exposure surface.
 */
const gatedStubLauncher: WorkerLauncher = async (ctx) => {
  console.info(
    `[room-worker] launch gated (exposed half pending @speedy trust-tier proofs) room=${ctx.roomId} msg=${ctx.messageId}`
  );
  return { launched: false, reason: 'gated' };
};

let launcher: WorkerLauncher = gatedStubLauncher;

/** Wire the real (exposed-half) launcher. Call once, post trust-tier sign-off. */
export function setRoomWorkerLauncher(fn: WorkerLauncher): void {
  launcher = fn;
}

/** Reset to the gated stub (tests / kill-switch). */
export function resetRoomWorkerLauncher(): void {
  launcher = gatedStubLauncher;
}

/** Minimal shape this module needs from a persisted message. */
export type EmitterMessage = {
  id: string;
  authorHandle: string;
  body: string;
};

/**
 * Best-effort: never throws into the caller, never blocks the 201. Returns the
 * resolved outcome string (useful in tests); the caller can ignore it.
 */
export async function maybeLaunchRoomWorker(roomId: string, message: EmitterMessage): Promise<FireDecision> {
  try {
    const body = message.body ?? '';

    // Loop guard — the worker posts replies as WORKER_HANDLE; never react to
    // its own output (mirrors pty-inject-fanout's author-skip).
    if (message.authorHandle === WORKER_HANDLE) return 'skip:self';

    // Direct mention only. @everyone broadcasts deliberately do NOT fire, to
    // protect the per-account daily run cap.
    if (!listBareMentionHandles(body).includes(WORKER_HANDLE)) return 'skip:no-mention';

    if (breakerOpen(roomId, BREAKER_THRESHOLD, BREAKER_COOLDOWN_MS)) {
      logFire(roomId, 'suppressed', 'breaker-open');
      return 'suppress:breaker';
    }

    if (recentLaunchCount(roomId, RATE_LIMIT_WINDOW_MS) >= RATE_LIMIT_MAX) {
      logFire(roomId, 'suppressed', 'rate-limit');
      return 'suppress:rate-limit';
    }

    // Concurrency 1: only the cold-start mention acquires; others rely on the
    // live worker to drain them.
    if (!tryAcquireLease(roomId, LEASE_TTL_MS)) return 'skip:lease-held';

    let result: WorkerLaunchResult;
    try {
      result = await launcher({
        roomId,
        messageId: message.id,
        authorHandle: message.authorHandle,
        body
      });
    } catch (cause) {
      releaseLease(roomId);
      logFire(roomId, 'failed', cause instanceof Error ? cause.message : String(cause));
      return 'fail:launcher-threw';
    }

    if (result.launched && result.sessionId) {
      recordSession(roomId, result.sessionId, result.sessionUrl ?? null, result.fireTokenId ?? null);
      logFire(roomId, 'launched', result.sessionId);
      return 'launched';
    }

    // Declined (incl. the gated stub) — free the lease so a future mention can
    // try again once the launcher is live.
    releaseLease(roomId);
    logFire(roomId, 'suppressed', result.reason ?? 'not-launched');
    return 'suppress:declined';
  } catch (cause) {
    // Absolute backstop: the bridge must never break message posting.
    console.warn('[room-worker] maybeLaunchRoomWorker error (swallowed):', cause);
    return 'error:swallowed';
  }
}

export type FireDecision =
  | 'launched'
  | 'skip:self'
  | 'skip:no-mention'
  | 'skip:lease-held'
  | 'suppress:breaker'
  | 'suppress:rate-limit'
  | 'suppress:declined'
  | 'fail:launcher-threw'
  | 'error:swallowed';
