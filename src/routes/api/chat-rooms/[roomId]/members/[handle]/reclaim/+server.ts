/**
 * POST /api/chat-rooms/:roomId/members/:handle/reclaim
 *
 * Phase C2 of the 0.1.13 terminal lifecycle slice (JWPK A Team
 * msg_7uvr35x0xr, greenlit 2026-05-29). Flips the terminal bound to a
 * room membership from `archived` back to `live` so the handle becomes
 * usable again without forcing the operator to re-register from
 * scratch.
 *
 * Behaviour:
 *   1. Read-gate via requireChatRoomReadAccess — caller must be
 *      authenticated and have access to the room. Anything else 401/404s.
 *   2. Look up the room_memberships row for (roomId, handle). 404 if
 *      missing — there's nothing to reclaim.
 *   3. Resolve the bound terminal. 404 if the row points at a terminal
 *      that no longer exists (stale fk).
 *   4. If already 'live' → 200 with { ok:true, alreadyLive:true }.
 *      Idempotent so the participants pane can fire on click without
 *      checking server-side state first.
 *   5. If 'deleted' → 409. Deleted is intentional, not recoverable here;
 *      the caller has to register a fresh terminal.
 *   6. Resolve the caller's pidChain to a live terminal. If the resolved
 *      terminal differs from the bound one, re-point membership.terminal_id
 *      to the caller's terminal (via addMembership's upsert) AND flip
 *      the caller's terminal status to 'live' (in case it was archived).
 *      If they're the same, just flip the bound terminal to 'live'.
 *   7. 200 with { ok:true, terminalId } pointing at the now-live terminal.
 *
 * pidChain comes from the request body (standard ANT CLI pattern,
 * matches identity-gated POST routes). When the caller's pidChain
 * doesn't resolve, the bound terminal can still be flipped to 'live'
 * — that's a no-op re-point but a valid reclaim of the existing binding.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { requireChatRoomReadAccess } from '$lib/server/chatRoomReadGate';
import { parsePidChainFromBody } from '$lib/server/identityGate';
import {
  addMembership,
  getTerminalIdByHandle
} from '$lib/server/roomMembershipsStore';
import {
  getTerminalById,
  lookupTerminalByPidChain,
  setTerminalStatus
} from '$lib/server/terminalsStore';

function decodeHandleParam(rawHandle: string): string {
  const decoded = decodeURIComponent(rawHandle);
  return decoded.startsWith('@') ? decoded : `@${decoded}`;
}

export const POST: RequestHandler = async ({ params, request }) => {
  const room = findChatRoomById(params.roomId);
  if (!room) throw error(404, 'Room not found.');

  // Read-gate first. 401 / 404 are thrown by the gate.
  await requireChatRoomReadAccess(request, room);

  // Body is optional — only the pidChain matters for re-point logic.
  // Anything else is ignored.
  const rawBody = await request.json().catch(() => ({}));
  const pidChain = parsePidChainFromBody(rawBody);

  const targetHandle = decodeHandleParam(params.handle);
  const boundTerminalId = getTerminalIdByHandle(params.roomId, targetHandle);
  if (!boundTerminalId) throw error(404, 'Handle is not a member of this room.');

  const boundTerminal = getTerminalById(boundTerminalId);
  if (!boundTerminal) throw error(404, 'Bound terminal no longer exists.');

  const currentStatus = boundTerminal.status ?? 'live';
  if (currentStatus === 'live') {
    return json({ ok: true, alreadyLive: true, terminalId: boundTerminalId });
  }
  if (currentStatus === 'deleted') {
    throw error(409, 'Terminal is deleted — re-register a fresh terminal to take this handle.');
  }

  // Phase C2 re-point: if the caller is on a different live terminal
  // (e.g. a freshly-rebuilt shell), point the membership at THAT
  // terminal and also flip its status to live in case it was archived
  // upstream. If the caller's pidChain doesn't resolve OR resolves to
  // the same terminal, just flip the bound one to live.
  const callerTerminal = pidChain.length > 0 ? lookupTerminalByPidChain(pidChain) : null;
  if (callerTerminal && callerTerminal.id !== boundTerminalId) {
    addMembership({
      room_id: params.roomId,
      handle: targetHandle,
      terminal_id: callerTerminal.id
    });
    setTerminalStatus(callerTerminal.id, 'live');
    return json({ ok: true, terminalId: callerTerminal.id, repointed: true });
  }

  setTerminalStatus(boundTerminalId, 'live');
  return json({ ok: true, terminalId: boundTerminalId });
};
