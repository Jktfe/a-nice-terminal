/**
 * Per-viewer room preferences endpoint.
 *
 * GET  /api/chat-rooms/:roomId/preferences
 *   → { roomId, handle, pinned, muted, archived, updatedAtMs }
 *
 * PUT  /api/chat-rooms/:roomId/preferences
 *   body: { pinned?, muted?, archived? } (partial; only supplied flags written)
 *   → updated row
 *
 * Auth: caller must be able to read the room (`requireChatRoomReadAccess`).
 * Each viewer-handle gets their own row — your prefs are independent of
 * other members'. Persistence is server-side so multi-device users
 * (antios + antchat per eiw05zdurz contract 2026-05-27) see the same
 * pin/mute/archive state across surfaces.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { requireChatRoomReadAccess } from '$lib/server/chatRoomReadGate';
import {
  getRoomMemberPreferences,
  setRoomMemberPreferences
} from '$lib/server/roomMemberPreferencesStore';

function resolveViewerHandle(access: { handles: string[] }, fallback?: string): string {
  const first = access.handles[0];
  if (typeof first === 'string' && first.length > 0) return first;
  if (fallback) return fallback;
  throw error(400, 'Cannot resolve viewer handle from the request.');
}

export const GET: RequestHandler = async ({ params, request }) => {
  const roomId = params.roomId ?? '';
  if (roomId.length === 0) throw error(400, 'roomId required.');
  const room = findChatRoomById(roomId);
  if (!room) throw error(404, 'room not found');
  const access = await requireChatRoomReadAccess(request, room);
  const handle = resolveViewerHandle(access);
  return json(getRoomMemberPreferences(roomId, handle));
};

export const PUT: RequestHandler = async ({ params, request }) => {
  const roomId = params.roomId ?? '';
  if (roomId.length === 0) throw error(400, 'roomId required.');
  const room = findChatRoomById(roomId);
  if (!room) throw error(404, 'room not found');
  const access = await requireChatRoomReadAccess(request, room);
  const handle = resolveViewerHandle(access);

  const body = (await request.json().catch(() => null)) as
    | { pinned?: unknown; muted?: unknown; archived?: unknown }
    | null;
  if (!body || typeof body !== 'object') {
    throw error(400, 'Body must be an object with optional pinned/muted/archived booleans.');
  }

  // Only forward the flags actually supplied as booleans. Anything else
  // is ignored — partial update semantics, per the store contract.
  const input: { roomId: string; handle: string; pinned?: boolean; muted?: boolean; archived?: boolean } = {
    roomId, handle
  };
  if (typeof body.pinned === 'boolean') input.pinned = body.pinned;
  if (typeof body.muted === 'boolean') input.muted = body.muted;
  if (typeof body.archived === 'boolean') input.archived = body.archived;

  const updated = setRoomMemberPreferences(input);
  return json(updated);
};
