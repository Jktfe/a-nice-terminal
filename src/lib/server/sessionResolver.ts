/**
 * sessionResolver — self-healing identity resolution (Simplify & Harden
 * lane A / A3, the daily-403 killer).
 *
 * THE FIX: today the request gate resolves identity through a pidChain.
 * The pid drifts on restart / day-roll, the chain misses, and the gate
 * 403s the agent out of its own rooms ("stale-rebind"). Here, identity is
 * resolved from the DURABLE session token — the runtime/pid is, at most, a
 * hint we record for delivery, NEVER a gate. A drifted pid can no longer
 * lock anyone out: the token still resolves the same session.
 *
 * "Self-heal" = the rebind is a no-op. Re-presenting the same durable token
 * after any runtime change resolves the identical identity + refreshes
 * liveness. There is nothing to repair because nothing broke.
 */

import { getSession, markSessionSeen, type AntSession } from './antSessionStore';

export type ResolveOutcome =
  | { ok: true; session: AntSession; healed: boolean }
  | { ok: false; reason: 'unknown-token' };

/**
 * Resolve a durable session token to its identity, self-healing across any
 * runtime change.
 *
 * @param token        the durable session id (NOT a pid / pidChain).
 * @param runtimeHint  optional current pid/pane — recorded as liveness, but
 *                     a mismatch with creation NEVER fails resolution. This
 *                     is the whole point: runtime is disposable.
 * @param nowMs        clock (injectable for tests).
 *
 * Returns ok:true with `healed:true` when the presented runtime differs from
 * what we last saw (i.e. a rebind that, under the old model, would have
 * 403'd — here it just refreshes). `healed:false` on a steady-state resolve.
 * Returns ok:false only when the token itself is unknown — the caller then
 * decides (e.g. auto-create + auto-join for an open-room post).
 */
export function resolveDurableSession(
  token: string,
  runtimeHint?: { pid?: number | null },
  nowMs: number = Date.now()
): ResolveOutcome {
  const existing = getSession(token);
  if (!existing) return { ok: false, reason: 'unknown-token' };

  // A runtime change is detected purely for telemetry/"healed" signalling;
  // it does not and must not affect whether resolution succeeds.
  const healed =
    runtimeHint !== undefined &&
    typeof runtimeHint.pid === 'number' &&
    // last_seen advancing with a new runtime = a re-presentation after drift.
    existing.last_seen_at_ms < nowMs;

  const refreshed = markSessionSeen(token, nowMs) ?? existing;
  return { ok: true, session: refreshed, healed };
}

/**
 * Convenience guard for the request gate: resolve-or-null. Replaces the
 * pidChain lookup the old gate used. Never throws; a null result means
 * "no such durable identity", not "your binding went stale".
 */
export function resolveOrNull(token: string | null | undefined, nowMs: number = Date.now()): AntSession | null {
  if (!token) return null;
  const outcome = resolveDurableSession(token, undefined, nowMs);
  return outcome.ok ? outcome.session : null;
}
