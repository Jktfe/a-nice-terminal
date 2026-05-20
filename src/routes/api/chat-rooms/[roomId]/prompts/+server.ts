/**
 * GET /api/chat-rooms/:roomId/prompts                  list pending prompts
 * POST /api/chat-rooms/:roomId/prompts                 record a new prompt
 * PATCH /api/chat-rooms/:roomId/prompts?promptId=…&status=responded|dismissed
 *
 * Task #114 prompt-bridge minimum viable. Pure read/write surface for the
 * pending-prompts panel; the v3 broker/delivery layer ships later.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import {
  listPendingPromptsInRoom,
  markPromptStatus,
  recordPromptEvent
} from '$lib/server/terminalPromptEventStore';
import { requireChatRoomMutationAuth } from '$lib/server/chatRoomAuthGate';

export const GET: RequestHandler = ({ params }) => {
  if (!findChatRoomById(params.roomId)) throw error(404, 'Room not found.');
  return json({ prompts: listPendingPromptsInRoom(params.roomId) });
};

export const POST: RequestHandler = async ({ params, request }) => {
  if (!findChatRoomById(params.roomId)) throw error(404, 'Room not found.');
  const payload = (await request.json().catch(() => null)) as
    | { rawText?: unknown; detector?: unknown; terminalId?: unknown }
    | null;
  if (!payload) throw error(400, 'JSON body required.');
  // LAUNCH-BLOCKER CVE FIX D (2026-05-20): identity-gate prompts POST.
  requireChatRoomMutationAuth(params.roomId, request, payload);
  if (typeof payload.rawText !== 'string' || payload.rawText.trim().length === 0) {
    throw error(400, 'rawText is required.');
  }
  const event = recordPromptEvent({
    roomId: params.roomId,
    terminalId: typeof payload.terminalId === 'string' ? payload.terminalId : null,
    rawText: payload.rawText,
    detector: typeof payload.detector === 'string' ? payload.detector : null
  });
  return json(event, { status: 201 });
};

export const PATCH: RequestHandler = ({ params, url, request }) => {
  if (!findChatRoomById(params.roomId)) throw error(404, 'Room not found.');
  // LAUNCH-BLOCKER CVE FIX D (2026-05-20): identity-gate prompts PATCH.
  requireChatRoomMutationAuth(params.roomId, request, null);
  const promptId = url.searchParams.get('promptId');
  const statusRaw = url.searchParams.get('status');
  if (!promptId) throw error(400, 'promptId query parameter required.');
  if (statusRaw !== 'responded' && statusRaw !== 'dismissed') {
    throw error(400, 'status must be responded or dismissed.');
  }
  const updated = markPromptStatus(promptId, statusRaw);
  if (!updated) throw error(404, 'Prompt not found or already resolved.');
  return new Response(null, { status: 204 });
};
