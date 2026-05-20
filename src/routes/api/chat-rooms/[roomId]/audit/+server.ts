/**
 * Per-room permissions audit surface (M3.1a).
 *
 *   GET  /api/chat-rooms/:roomId/audit
 *     → 200 { roomId, members: [{ handle, terminal_id, terminal_name,
 *                                  agent_kind, joined_at }, ...] }
 *     → 404 if room not found.
 *
 * Read-only audit query joining room_memberships → terminals so an operator
 * can see exactly who can write into a room and which terminal-row each
 * handle resolves to. Surfaces the identity proof chain for every member.
 *
 * No pidChain required — this is read-only metadata. last_activity_at is
 * intentionally NOT in v1 (would require per-member message scan; punted
 * to a v2 if/when requested).
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { doesChatRoomExist } from '$lib/server/chatRoomStore';
import { listMembershipsForRoom } from '$lib/server/roomMembershipsStore';
import { getTerminalById } from '$lib/server/terminalsStore';

export const GET: RequestHandler = async ({ params }) => {
  if (!doesChatRoomExist(params.roomId)) {
    throw error(404, 'Room not found.');
  }
  const memberships = listMembershipsForRoom(params.roomId);
  const members = memberships.map((m) => {
    const terminal = getTerminalById(m.terminal_id);
    return {
      handle: m.handle,
      terminal_id: m.terminal_id,
      terminal_name: terminal?.name ?? null,
      agent_kind: terminal?.agent_kind ?? null,
      joined_at: m.created_at
    };
  });
  return json({ roomId: params.roomId, members });
};
