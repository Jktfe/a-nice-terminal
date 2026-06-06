/**
 * Room blocks — read + curate a single block.
 *
 *   GET /api/chat-rooms/:roomId/blocks/:blockId[?includeDeleted=1]
 *     → 200 { block, messages }   the section's messages (the "read a prior
 *                                  section to summarise it" primitive)
 *     → 401 / 404
 *     includeDeleted (audit view) is ADMIN-ONLY — normal readers get the
 *     research-clean view (deleted messages + deleted blocks skipped).
 *     blockId "__open__" reads the current (open) block.
 *
 *   POST /api/chat-rooms/:roomId/blocks/:blockId   body { deleted: boolean }
 *     → 200 { block }             tombstone / un-tombstone the whole block
 *                                  (skipped in reads/memory/research, retained
 *                                  for audit). Mutation-gated.
 *
 * See docs/concepts/ant-room-blocks.md.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { resolveChatRoomReadAccess } from '$lib/server/chatRoomReadGate';
import { requireChatRoomMutationAuth } from '$lib/server/chatRoomAuthGate';
import { readBlock, OPEN_BLOCK_ID } from '$lib/server/roomBlocksStore';
import { setBlockDeleted } from '$lib/server/roomBlockStateStore';

export const GET: RequestHandler = async ({ request, params, url }) => {
  const roomId = params.roomId;
  if (!findChatRoomById(roomId)) throw error(404, 'Room not found.');

  const access = await resolveChatRoomReadAccess(request, roomId);
  if (!access) throw error(401, 'Authentication required.');

  // Audit view (deleted messages + deleted blocks) is admin-only — normal
  // readers always get the research-clean view.
  const includeDeleted = url.searchParams.get('includeDeleted') === '1' && access.isAdminBearer;

  const result = readBlock(roomId, params.blockId, { includeDeleted });
  if (!result) throw error(404, 'Block not found.');
  return json(result);
};

export const POST: RequestHandler = async ({ request, params }) => {
  const roomId = params.roomId;
  if (!findChatRoomById(roomId)) throw error(404, 'Room not found.');
  if (params.blockId === OPEN_BLOCK_ID) {
    throw error(400, 'The open block cannot be deleted — seal it with a break first.');
  }

  const rawBody = await request.json().catch(() => null);
  const deleted = (rawBody as { deleted?: unknown } | null)?.deleted;
  if (typeof deleted !== 'boolean') throw error(400, 'Body must include a boolean `deleted` field.');

  const auth = requireChatRoomMutationAuth(roomId, request, rawBody);

  const existing = readBlock(roomId, params.blockId, { includeDeleted: true });
  if (!existing) throw error(404, 'Block not found.');
  setBlockDeleted(roomId, params.blockId, deleted, auth.handle);
  const result = readBlock(roomId, params.blockId, { includeDeleted: true });
  return json({ block: result?.block ?? existing.block });
};
