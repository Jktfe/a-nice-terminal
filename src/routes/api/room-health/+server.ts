/**
 * GET /api/room-health — read-only room-identity health feed (workstream C,
 * plan room-identity-stage-full-delivery-2026-06-02).
 *
 * Surfaces the core identity invariant chain (handle / membership /
 * linked-room-live) for every LIVE terminal so drift is visible as a
 * green/amber/red list BEFORE a human hits a 403 on chat. Read-only:
 * listRoomHealth() issues SELECTs only and writes to no identity table.
 *
 * No auth gate beyond DB reachability (matches /api/health + the other
 * decorative read feeds). Cheap enough for a 30s client poll.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listRoomHealth, summariseRoomHealth } from '$lib/server/roomHealthStore';

export const GET: RequestHandler = () => {
  const terminals = listRoomHealth();
  const summary = summariseRoomHealth(terminals);
  return json({ terminals, summary });
};
