/**
 * GET /api/room-health — read-only room-identity health feed (workstream C,
 * plan room-identity-stage-full-delivery-2026-06-02).
 *
 * Surfaces the core identity invariant chain (handle / membership /
 * linked-room-live) for every LIVE terminal so drift is visible as a
 * green/amber/red list BEFORE a human hits a 403 on chat. Read-only:
 * listRoomHealth() issues SELECTs only and writes to no identity table.
 *
 * Auth: this exposes the cross-room terminal/handle roster, so callers need
 * an authenticated ANT identity or admin-bearer.
 *
 * Also carries `durableActivation` — the read-only "deployed-but-dormant"
 * verdict for the durable-identity model (ant_sessions / room_handle_leases).
 * Kept on this one read-model (consistent with #139) so a single poll surfaces
 * both per-terminal identity drift AND whether the durable model is actually in
 * use vs silently dormant on the fallback path. Read-only: SELECT/COUNT only.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAggregateReadAuth } from '$lib/server/aggregateReadAuth';
import { listRoomHealth, summariseRoomHealth } from '$lib/server/roomHealthStore';
import { summariseDurableActivation } from '$lib/server/durableActivationHealth';

export const GET: RequestHandler = ({ request }) => {
  requireAggregateReadAuth(request, '/api/room-health');
  const terminals = listRoomHealth();
  const summary = summariseRoomHealth(terminals);
  const durableActivation = summariseDurableActivation();
  return json({ terminals, summary, durableActivation });
};
