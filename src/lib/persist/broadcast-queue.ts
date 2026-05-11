// Phase A of server-split-2026-05-11 — thin typed surface over the
// raw queries.markBroadcast* helpers. Tier 2's runSideEffects (Phase
// B) and the catch-up loop (Phase C) call into this module so they
// can be type-checked against the broadcast lifecycle states.

import { queries } from '$lib/server/db';
import type { PersistedMessage } from './types.js';

export type BroadcastState = 'pending' | 'done' | 'failed' | 'expired';

export function markDone(messageId: string): void {
  queries.markBroadcastDone(messageId);
}

export function markFailed(messageId: string): void {
  queries.markBroadcastFailed(messageId);
}

export function markExpired(messageId: string): void {
  queries.markBroadcastExpired(messageId);
}

export function bumpAttempts(messageId: string): void {
  queries.bumpBroadcastAttempts(messageId);
}

export function listPending(limit: number = 100): PersistedMessage[] {
  return queries.listPendingBroadcasts(limit) as PersistedMessage[];
}
