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
 *     Body: { mode: 'brainstorm' | 'heads-down' | 'closed', pidChain?: [...] }
 *     → 200 { roomId, mode, set_by, set_at } on success; an audit row is
 *       appended to chat_room_mode_history inside the same transaction.
 *     → 400 on malformed body or invalid mode value.
 *     → 403 when no identity resolves to a member of this room.
 *     → 404 if the room does not exist.
 *
 * Auth: pidChain (CLI/agent) OR browser-session cookie (web UI). At least
 * one must resolve to a room member.
 */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { doesChatRoomExist } from '$lib/server/chatRoomStore';
import { parsePidChainFromBody, resolveServerSideHandle } from '$lib/server/identityGate';
import {
  getCookieValuesFromRequest
} from '$lib/server/authGate';
import {
  resolveBrowserSessionSecret
} from '$lib/server/browserSessionStore';
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

function resolveHandleFromRequest(roomId: string, request: Request, rawBody: unknown): string | null {
  // 1. Try pidChain from body (CLI/agent path).
  const pidChain = parsePidChainFromBody(rawBody);
  if (pidChain.length > 0) {
    const handle = resolveServerSideHandle(roomId, pidChain);
    if (handle) return handle;
  }

  // 2. Try browser-session cookie (web UI path).
  const cookieSecrets = getCookieValuesFromRequest(request, 'ant_browser_session');
  for (const secret of cookieSecrets) {
    const resolved = resolveBrowserSessionSecret(secret, roomId);
    if (resolved) return resolved.handle;
  }

  return null;
}

export const PUT: RequestHandler = async ({ params, request }) => {
  if (!doesChatRoomExist(params.roomId)) {
    throw error(404, 'Room not found.');
  }
  const rawBody = await request.json().catch(() => null);
  if (!rawBody || typeof rawBody !== 'object') {
    throw error(400, 'Send a JSON body with mode field.');
  }

  const modeRaw = (rawBody as { mode?: unknown }).mode;
  if (!isAllowedRoomMode(modeRaw)) {
    throw error(400, `mode must be one of: ${ALLOWED_ROOM_MODES.join(', ')}.`);
  }

  const handle = resolveHandleFromRequest(params.roomId, request, rawBody);
  if (!handle) {
    throw error(403, 'Authentication required — must be a room member.');
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
