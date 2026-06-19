/**
 * /api/chat-rooms/:roomId/cli-agents — room-scoped bring-in for CLI
 * bridges (dogfood finding #4 follow-up, 2026-05-24).
 *
 * Background: the original /cli-agents dashboard is room-detached — an
 * operator opening a room can't see what agents are in it, and bringing
 * a fresh codex into the room means leaving the room. This surface lets
 * the room page own its own bring-in flow.
 *
 * GET  /api/chat-rooms/:roomId/cli-agents
 *   -> 200 { agents: SerialisedCliAgent[] }   (handles tagged with this roomId)
 *
 * POST /api/chat-rooms/:roomId/cli-agents
 *   Body: { cli: 'codex'|'pi', cwd?, sessionDir?, binary? }
 *   -> 201 SerialisedCliAgent
 *   -> 403 remote-bridge bearer (parity with /api/cli-agents)
 *   -> 404 unknown room
 *   -> 500 spawn failure
 *
 * The spawned agent's wire-back to the room (auto-posting its replies as
 * the registered handle) is NOT in this slice — that needs codex-side
 * MCP/tool config and is the natural follow-up to finding #5's banked
 * design. For now the operator drives prompts via the prompt-channel
 * shipped in PR #52 and reads replies through /cli-hooks/:sessionId.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  listCliAgentsForRoom,
  startCliAgent,
  type CliAgentKind
} from '$lib/server/cliAgentRegistry';
import { serialiseCliAgent } from '$lib/server/cliAgentSerialise';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { requireChatRoomReadAccess } from '$lib/server/chatRoomReadGate';
import { requireChatRoomMutationAuth } from '$lib/server/chatRoomAuthGate';

function rejectRemoteBridgeBearer(request: Request): void {
  const auth = request.headers.get('authorization') ?? '';
  if (auth.startsWith('Bearer rbt_')) {
    throw error(403, 'Remote-bridge bearer tokens cannot spawn CLI agents.');
  }
}

export const GET: RequestHandler = async ({ params, request }) => {
  const roomId = params.roomId ?? '';
  if (!roomId) throw error(400, 'roomId required');
  const room = findChatRoomById(roomId);
  if (!room) throw error(404, 'room not found');
  await requireChatRoomReadAccess(request, room);
  const agents = listCliAgentsForRoom(roomId).map(serialiseCliAgent);
  return json({ agents });
};

export const POST: RequestHandler = async ({ params, request }) => {
  rejectRemoteBridgeBearer(request);

  const roomId = params.roomId ?? '';
  if (!roomId) throw error(400, 'roomId required');
  if (!findChatRoomById(roomId)) throw error(404, 'room not found');

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw error(400, 'Body must be a JSON object.');
    }
    body = parsed as Record<string, unknown>;
  } catch (cause) {
    if ((cause as { status?: number } | null)?.status === 400) throw cause;
    throw error(400, 'Body must be valid JSON.');
  }

  requireChatRoomMutationAuth(roomId, request, body);

  const cli = body.cli;
  if (cli !== 'codex' && cli !== 'pi') {
    throw error(400, `cli must be "codex" or "pi", got ${JSON.stringify(cli)}`);
  }
  const cwd = typeof body.cwd === 'string' && body.cwd.length > 0 ? body.cwd : undefined;
  const sessionDir = typeof body.sessionDir === 'string' && body.sessionDir.length > 0
    ? body.sessionDir
    : undefined;
  const binary = typeof body.binary === 'string' && body.binary.length > 0
    ? body.binary
    : undefined;

  let handle;
  try {
    handle = startCliAgent({ cli: cli as CliAgentKind, cwd, sessionDir, binary, roomId });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw error(500, `failed to spawn ${cli} in room ${roomId}: ${message}`);
  }
  return json(serialiseCliAgent(handle), { status: 201 });
};
