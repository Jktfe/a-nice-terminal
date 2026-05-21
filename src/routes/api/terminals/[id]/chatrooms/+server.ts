/**
 * GET /api/terminals/[id]/chatrooms → chat rooms a terminal participates in.
 *
 * Returns `{ chatRooms: [{ id, name, role }, ...] }` where role is 'chair'
 * when the terminal's per-room handle matches chat_rooms.current_chair_handle,
 * otherwise 'member'. The terminal's intrinsic linked chat is excluded — it's
 * not a "membership", it's a property of the terminal, and lives on the
 * terminal page rather than in the dashboard chatroom surface. Mirrors the
 * LINKED-CHAT-LISTING-FILTER applied by listChatRooms().
 */
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getTerminalById } from '$lib/server/terminalsStore';
import { listChatRoomsForTerminal } from '$lib/server/roomMembershipsStore';

export const GET: RequestHandler = async ({ params }) => {
  const terminalId = params.id ?? '';
  if (terminalId.length === 0) throw error(400, 'terminal id required.');
  if (!getTerminalById(terminalId)) throw error(404, 'terminal not found');
  return json({ chatRooms: listChatRoomsForTerminal(terminalId) });
};
