/**
 * GET /api/chat-rooms/:roomId/policy
 *
 * Read-only UI-facing projection of the room's two-axis policy
 * (Simplify & Harden lane A). Surfaces {joinPolicy, readPolicy} so the
 * RoomPolicyBadge can render the read + join posture without the client
 * reimplementing any policy logic.
 *
 * Workstream-C DISPLAY layer: this endpoint CONSUMES A's roomPolicyStore
 * (getRoomPolicy) and does NOT mutate or reimplement it. A room with no
 * explicit row gets A's documented default (invite-join, allowed-read).
 *
 * No auth gate beyond room existence — matches the agent-statuses /
 * digest / artefacts read-only patterns. The badge is informational; the
 * actual enforcement happens in roomAccessGate at the post/join path.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { getRoomPolicy } from '$lib/server/roomPolicyStore';

export const GET: RequestHandler = ({ params }) => {
  const room = findChatRoomById(params.roomId);
  if (!room) throw error(404, 'Room not found.');

  const { joinPolicy, readPolicy } = getRoomPolicy(params.roomId);
  return json({ joinPolicy, readPolicy });
};
