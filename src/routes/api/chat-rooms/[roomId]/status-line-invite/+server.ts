/**
 * POST /api/chat-rooms/:roomId/status-line-invite
 *
 * Room-scoped broadcast affordance for the T17 status-line installer pilot.
 * Posts one system invite and fans it out through the existing room message
 * pipeline, so agents see the install request in their normal room context.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { postSystemMessage } from '$lib/server/chatMessageStore';
import { requireChatRoomReadAccess } from '$lib/server/chatRoomReadGate';
import { broadcastToRoom } from '$lib/server/eventBroadcast';
import { fanoutMessageToRoomTerminals } from '$lib/server/pty-inject-fanout';

export const POST: RequestHandler = async ({ params, request }) => {
  const room = findChatRoomById(params.roomId);
  if (!room) throw error(404, 'Room not found.');
  await requireChatRoomReadAccess(request, room);

  const body = await request.json().catch(() => ({})) as { cli?: unknown };
  const cli = normaliseCli(body.cli);
  const targetHandles = room.members
    .filter((member) => member.kind === 'agent')
    .map((member) => member.handle);

  const message = postSystemMessage({
    roomId: room.id,
    body: makeStatusLineInviteBody(cli, targetHandles)
  });

  try {
    fanoutMessageToRoomTerminals(room.id, message, { forceBroadcastToAll: true });
  } catch {
    /* Fanout is best-effort; the room message is the durable record. */
  }
  try {
    broadcastToRoom(room.id, { type: 'message_added', message });
  } catch {
    /* SSE is best-effort; clients can re-fetch the message list. */
  }

  return json({ message, targetHandles, cli }, { status: 201 });
};

function normaliseCli(rawCli: unknown): 'qwen-cli' {
  if (rawCli === undefined || rawCli === null || rawCli === 'qwen' || rawCli === 'qwen-cli') {
    return 'qwen-cli';
  }
  throw error(400, 'Only qwen-cli status-line invites are supported by this pilot.');
}

function makeStatusLineInviteBody(cli: 'qwen-cli', targetHandles: string[]): string {
  const targetText = targetHandles.length > 0 ? targetHandles.join(' ') : 'room agents';
  return [
    `@everyone Status-line install invite for ${targetText}.`,
    `Run \`ant status install-line --cli ${cli}\`, then restart or reopen ${cli} so ANT can read ~/.ant/state/${cli}/.`
  ].join(' ');
}
