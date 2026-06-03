/**
 * POST /api/terminals/[id]/agent-launch
 *   Body: { message: string, agentKind?: string }
 *   →
 *   1. Resolve terminal_record by sessionId (404 if missing).
 *   2. Resolve linked_chat_room_id (404 if absent — record predates T1b).
 *   3. Post message to the linked chat room (chatMessageStore.postMessage).
 *   4. fanoutMessageToRoomTerminals → linkedRoomTerminalLookup synthesises
 *      a TerminalRow from terminal_records → twoCallSubmit pastes into pane.
 *   5. broadcastToRoom emits SSE message_added so subscribed browsers
 *      (TerminalChatView) refresh without poll.
 *   →
 *   Returns { messageId, roomId, sessionId }.
 *
 * Per T2-LINKED-CHAT-T1b/T1c design contract (2026-05-14, PATH A flowspec lift).
 *
 * Identity (CVE FIX B 2026-05-20 — closes security-audit-2026-05-19.md
 * Finding #2): server-resolved via resolveTerminalCallerHandle (cookie /
 * antchat Bearer / admin Bearer → @you). The previous body-supplied
 * `callerHandle` field is IGNORED. 401 when no identity can be resolved.
 * authorHandle on the posted message reflects the resolved identity.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getTerminalRecord } from '$lib/server/terminalRecordsStore';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { postMessage } from '$lib/server/chatMessageStore';
import { fanoutMessageToRoomTerminals } from '$lib/server/pty-inject-fanout';
import { broadcastToRoom } from '$lib/server/eventBroadcast';
import { canCallerActOnTerminal } from '$lib/server/allowlistGuard';
import { isSuperAdmin } from '$lib/server/orgStore';
import { resolveTerminalCallerHandle } from '$lib/server/authGate';

export const POST: RequestHandler = async ({ params, request }) => {
  const sessionId = params.id ?? '';
  if (sessionId.length === 0) throw error(400, 'sessionId required.');

  // Identity FIRST so unauthenticated callers are rejected before we read
  // the body. Body-supplied `callerHandle` is no longer trusted.
  const callerHandle = resolveTerminalCallerHandle(request);
  if (!callerHandle) {
    throw error(401, 'browser-session or admin-bearer required');
  }

  const raw = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!raw) throw error(400, 'body must be a JSON object.');
  const message = typeof raw.message === 'string' ? raw.message : '';
  if (message.trim().length === 0) throw error(400, 'message required.');

  const record = getTerminalRecord(sessionId);
  if (!record) throw error(404, 'terminal not found');
  // Allowlist guard: only the creator + allowlist members may launch into
  // this terminal. Operator-bypass remains explicit here for the operator
  // who owns the host (matches the kill route's bare-pane invariant after
  // CVE FIX B removed the @you shortcut from allowlistGuard).
  const operatorBypass = isSuperAdmin(callerHandle);
  if (!operatorBypass && !canCallerActOnTerminal(callerHandle, record)) {
    throw error(403, 'caller is not allowed to launch into this terminal');
  }

  const roomId = record.linked_chat_room_id;
  if (!roomId) throw error(404, 'terminal has no linked chat room (pre-T1b record)');
  if (!findChatRoomById(roomId)) throw error(404, 'linked chat room not found');

  const newMessage = postMessage({
    roomId,
    authorHandle: callerHandle,
    body: message,
    kind: 'human'
  });

  // T1c (2026-05-14): fanout is now the sole delivery path. linkedRoomTerminalLookup
  // synthesises a TerminalRow from terminal_records.linked_chat_room_id, fanout
  // enqueues, twoCallSubmit pastes the envelope into tmux_target_pane.
  try {
    fanoutMessageToRoomTerminals(roomId, newMessage);
  } catch {
    /* fanout is best-effort; route still returns 201 with the message persisted */
  }
  // SSE broadcast so subscribed browsers (TerminalChatView) refresh without
  // poll. Mirrors POST /api/chat-rooms/[roomId]/messages behaviour — surfaced
  // by claude2 after TRACK-2 ChatView refactor (2026-05-14).
  try {
    broadcastToRoom(roomId, { type: 'message_added', message: newMessage });
  } catch {
    /* broadcast is best-effort; route still returns 201 */
  }

  return json({ messageId: newMessage.id, roomId, sessionId }, { status: 201 });
};
