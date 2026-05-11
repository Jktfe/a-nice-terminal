// Phase A of server-split-2026-05-11 — Tier 1 entry point. Any
// process (HTTP handler, CLI direct-write, MCP, future tools) calls
// writeMessage() to persist a message + its asks + room-membership
// upsert in a single transaction. The row is inserted with
// broadcast_state='pending'; Tier 2 flips it to 'done' after the
// side-effect block (channel fanout, WS broadcast, agent event bus)
// runs. If Tier 2 never gets a chance (server offline, crash), the
// catch-up loop in Phase C replays the side-effects on next boot.
//
// What this function does NOT do, on purpose:
//   - Channel HTTP fanout (Phase B / runSideEffects)
//   - WS broadcast (Phase B / runSideEffects)
//   - PTY injection via MessageRouter.route (Phase B / runSideEffects)
//   - agent_response handling (special path in POST handler)
//
// Phase A keeps the side-effect block inline in the POST handler so
// that this change is purely a refactor with no behaviour delta.

import { nanoid } from 'nanoid';
import { queries } from '$lib/server/db';
import { resolveSenderSession } from './sender.js';
import { normalizeMessageInput } from './normalize-input.js';
import { writeAsksForMessage } from './ask-writes.js';
import { ensureRoomMembershipForSender } from './room-membership.js';
import type { MessageInput, PersistedMessage, WriteMessageResult } from './types.js';
import { WriteMessageError } from './types.js';

export function writeMessage(input: MessageInput): WriteMessageResult {
  // Validate reply_to BEFORE normalization throws on its own checks so
  // the existing POST-handler's reply_to 400 mirrors current behaviour.
  if (input.replyTo) {
    const parent: any = queries.getMessage(input.replyTo);
    if (!parent || parent.session_id !== input.sessionId) {
      throw new WriteMessageError('reply_to must reference a message in this session', 400);
    }
  }

  const norm = normalizeMessageInput(input);
  const id = nanoid();

  // First-post detection — must happen BEFORE createMessage so the
  // just-inserted row doesn't pollute the lookup. Used to deliver a
  // one-line skills hint on the sender's first post in a room.
  const isFirstPostFromSender =
    !!norm.senderId &&
    norm.msgType === 'message' &&
    !queries.hasPriorMessageFromSender(norm.sessionId, norm.senderId);

  // Wrap the persist + ask write + meta rewrite + membership upsert in
  // a single transaction so a crash mid-write leaves no half-state.
  // The previous inline path ran each query autocommitted; this is a
  // small correctness improvement, not a semantic change.
  const tx = (queries as any).__txWriteMessage as
    | ((cb: () => WriteMessageResult) => WriteMessageResult)
    | undefined;
  const runInTx = tx ?? ((cb: () => WriteMessageResult) => cb());

  return runInTx(() => {
    queries.createMessage(
      id,
      norm.sessionId,
      norm.role,
      norm.content,
      norm.format,
      'complete',
      norm.senderId,
      norm.target,
      norm.replyTo,
      norm.msgType,
      norm.metaJson,
      'pending',
    );
    queries.updateSession(null, null, null, null, norm.sessionId);

    const askResult = writeAsksForMessage({
      sessionId: norm.sessionId,
      messageId: id,
      senderId: norm.senderId,
      target: norm.target,
      msgType: norm.msgType,
      isChatBreak: norm.isChatBreak,
      content: typeof norm.content === 'string' ? norm.content : '',
      explicitAsks: norm.explicitAsks,
      inferred: norm.inferred,
      parsedMeta: norm.parsedMeta,
    });

    if (askResult.createdAsks.length > 0) {
      queries.updateMessageMeta(id, askResult.finalMetaJson);
    }

    ensureRoomMembershipForSender(norm.sessionId, norm.senderId);

    const message: PersistedMessage = {
      id,
      session_id: norm.sessionId,
      role: norm.role,
      content: typeof norm.content === 'string' ? norm.content : String(norm.content),
      format: norm.format,
      status: 'complete',
      sender_id: norm.senderId,
      target: norm.target,
      reply_to: norm.replyTo,
      msg_type: norm.msgType,
      meta: askResult.createdAsks.length > 0 ? askResult.finalMetaJson : norm.metaJson,
      broadcast_state: 'pending',
    };

    const linkedTerminals = queries.getTerminalsByLinkedChat(norm.sessionId) as unknown[];
    const isLinkedChat = Array.isArray(linkedTerminals) && linkedTerminals.length > 0;

    return {
      message,
      asks: askResult.createdAsks,
      firstPost: isFirstPostFromSender,
      isLinkedChat,
      senderResolved: resolveSenderSession(norm.senderId),
      routingHints: {
        askIds: askResult.createdAsks.map((ask) => ask.id),
      },
    };
  });
}

export { WriteMessageError } from './types.js';
