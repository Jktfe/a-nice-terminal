/**
 * Per-room mode read/write endpoint per the room-mode design contract
 * 2026-05-13 (M3.b.4).
 *
 *   GET  /api/chat-rooms/:roomId/mode
 *     → 200 { roomId, mode, set_by, set_at }; mode defaults to 'brainstorm'
 *       when no row exists. Plain — no identity required.
 *     → 404 if the room does not exist.
 *
 *   PUT  /api/chat-rooms/:roomId/mode
 *     Body: { mode: 'brainstorm' | 'heads-down' | 'closed', pidChain: [...] }
 *     → 200 { roomId, mode, set_by, set_at } on success; an audit row is
 *       appended to chat_room_mode_history inside the same transaction.
 *     → 400 on malformed body or invalid mode value.
 *     → 403 when pidChain does not resolve to a member of this room
 *       (strict-403 — no transition fallback, this is a new endpoint).
 *     → 404 if the room does not exist.
 *
 * Heads-down ROUTING behaviour is M3.b.5's deliverable; this slice only
 * persists the mode and lets the fanout path read it back.
 */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { doesChatRoomExist } from '$lib/server/chatRoomStore';
import { parsePidChainFromBody, resolveServerSideHandle } from '$lib/server/identityGate';
import {
  getRoomMode,
  getRoomModeRow,
  setRoomMode,
  isAllowedRoomMode,
  ALLOWED_ROOM_MODES
} from '$lib/server/roomModesStore';

export const GET: RequestHandler = async ({ params }) => {
  if (!doesChatRoomExist(params.roomId)) {
    throw error(404, 'Room not found.');
  }
  const row = getRoomModeRow(params.roomId);
  const mode = row?.mode ?? getRoomMode(params.roomId);
  return json({
    roomId: params.roomId,
    mode,
    set_by: row?.set_by ?? null,
    set_at: row?.set_at ?? null
  });
};

export const PUT: RequestHandler = async ({ params, request }) => {
  if (!doesChatRoomExist(params.roomId)) {
    throw error(404, 'Room not found.');
  }
  const rawBody = await request.json().catch(() => null);
  if (!rawBody || typeof rawBody !== 'object') {
    throw error(400, 'Send a JSON body with mode and pidChain fields.');
  }

  const modeRaw = (rawBody as { mode?: unknown }).mode;
  if (!isAllowedRoomMode(modeRaw)) {
    throw error(400, `mode must be one of: ${ALLOWED_ROOM_MODES.join(', ')}.`);
  }

  const pidChain = parsePidChainFromBody(rawBody);
  if (pidChain.length === 0) {
    throw error(400, 'pidChain is required for room-mode writes.');
  }

  const handle = resolveServerSideHandle(params.roomId, pidChain);
  if (!handle) {
    throw error(403, 'Caller is not a registered member of this room.');
  }

  const stored = setRoomMode({
    roomId: params.roomId,
    mode: modeRaw,
    set_by: handle
  });
  return json({
    roomId: stored.room_id,
    mode: stored.mode,
    set_by: stored.set_by,
    set_at: stored.set_at
  });
};
