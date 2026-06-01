/**
 * permissionRequestsSweepBoot — Stage B TTL housekeeping (plan milestone
 * p3-stage-b-permission-requests of ant-substrate-v0.2-2026-05-29).
 *
 * Boots a 60-second setInterval that calls sweepExpiredPendingActions().
 * Boot-once via globalThis flag matches the cronJobTicker + run-events
 * patterns elsewhere in the substrate. Idempotent — calling
 * ensurePermissionRequestsSweepBooted() multiple times is a no-op.
 *
 * Why 60s: the default TTL is 5 minutes. A 60-second sweep means
 * worst-case latency between expiry and visible state flip is 60s; the
 * Stage B UX cost of that is one extra minute of "pending → approve
 * works → grant written but CLI never polled" before the sweep notices.
 * Cheap enough to run more aggressively; the SQL is a single indexed
 * UPDATE so 60s is comfortable.
 */

import { sweepExpiredPendingActions } from './permissionRequestsStore';

const BOOT_KEY = '__antPermissionRequestsSweepBooted';
const TIMER_KEY = '__antPermissionRequestsSweepTimer';
const DEFAULT_SWEEP_INTERVAL_MS = 60_000;

function logErr(prefix: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  // eslint-disable-next-line no-console
  console.error(`[permissionRequestsSweep] ${prefix}: ${msg}`);
}

export function tickPermissionRequestsSweepOnce(nowMs: number = Date.now()): {
  expired: number;
  requestsExpired: number;
} {
  try {
    return sweepExpiredPendingActions(nowMs);
  } catch (cause) {
    logErr('sweep failed', cause);
    return { expired: 0, requestsExpired: 0 };
  }
}

export function ensurePermissionRequestsSweepBooted(input: {
  intervalMs?: number;
} = {}): void {
  const slot = globalThis as Record<string, unknown>;
  if (slot[BOOT_KEY]) return;
  slot[BOOT_KEY] = true;
  const intervalMs = Math.max(1_000, input.intervalMs ?? DEFAULT_SWEEP_INTERVAL_MS);
  const timer = setInterval(() => {
    const result = tickPermissionRequestsSweepOnce();
    if (result.expired > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `[permissionRequestsSweep] expired ${result.expired} pending_action${result.expired === 1 ? '' : 's'} (requests: ${result.requestsExpired})`
      );
    }
  }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  slot[TIMER_KEY] = timer;
}

export function _resetPermissionRequestsSweepForTests(): void {
  const slot = globalThis as Record<string, unknown>;
  const timer = slot[TIMER_KEY] as NodeJS.Timeout | undefined;
  if (timer) clearInterval(timer);
  delete slot[BOOT_KEY];
  delete slot[TIMER_KEY];
}
