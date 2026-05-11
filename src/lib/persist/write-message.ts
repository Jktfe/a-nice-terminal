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
import { queries, runInTransaction } from '$lib/server/db';
import { resolveSenderSession } from './sender.js';
import { normalizeMessageInput } from './normalize-input.js';
import { writeAsksForMessage } from './ask-writes.js';
import { ensureRoomMembershipForSender } from './room-membership.js';
import type { MessageInput, PersistedMessage, WriteMessageResult } from './types.js';
import { WriteMessageError } from './types.js';

export function writeMessage(input: MessageInput): WriteMessageResult {
  // Phase D of server-split-2026-05-11 — direct-write auth gate.
  // HTTP enforces assertCanWrite via bearer-token kind upstream; CLI
  // direct-write bypasses HTTP entirely, so the three M0
  // clarification-3 checks live here:
  //
  //   (1) source-validity — only 'http' and 'cli' are accepted.
  //       'mcp' is reserved for the future MCP direct-write surface
  //       and rejected with 400 until that lane lands.
  //   (2) caller identity — for source='cli', actorSessionId must
  //       be present. Missing actor = anonymous CLI invocation,
  //       rejected with 403.
  //   (3) room membership — for source='cli', the resolved actor
  //       must be a member of the target room via chat_room_members.
  //       NOTE: serverSplit.md's original M0 wording referenced a
  //       "sessions.owner_session_id" bypass for owner-room writes.
  //       That column does NOT exist on the sessions table (only on
  //       decks/sheets/sites) — the bypass was never implemented and
  //       the doc has been corrected. Greenfield rooms (zero
  //       membership rows) accept the first write so
  //       ensureRoomMembershipForSender can seed the table, matching
  //       HTTP semantics where the first post auto-creates the
  //       membership row. Subsequent writes hit the strict member
  //       check.
  if (input.source !== 'http' && input.source !== 'cli') {
    throw new WriteMessageError(
      `writeMessage source='${input.source}' is not yet supported; only 'http' and 'cli' are accepted`,
      400,
    );
  }
  if (input.source === 'cli') {
    const actor = input.actorSessionId;
    if (!actor || typeof actor !== 'string' || actor.trim().length === 0) {
      throw new WriteMessageError(
        `writeMessage source='cli' requires actorSessionId (resolved from ~/.ant/config.json)`,
        403,
      );
    }
    // Membership check: the actor must be in chat_room_members for the
    // target room. Greenfield exception: if the room has NO members
    // yet, allow the write — this matches HTTP semantics where the
    // first post auto-creates membership via
    // ensureRoomMembershipForSender below. After the first write the
    // actor is in the table and subsequent CLI direct-writes pass the
    // strict check. Rooms that have established membership but don't
    // include this actor are rejected.
    const memberCount = queries.countRoomMembers(input.sessionId) as number;
    const isMember = !!queries.isRoomMember(input.sessionId, actor);
    if (memberCount > 0 && !isMember) {
      throw new WriteMessageError(
        `actor '${actor}' is not a member of room '${input.sessionId}'`,
        403,
      );
    }
  }

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
  // a single SQLite transaction. better-sqlite3's db.transaction(fn)
  // wraps fn so a thrown exception inside rolls back every statement
  // run within. The previous inline path ran each query autocommitted;
  // this is a real atomicity guarantee, not just a comment.
  return runInTransaction((): WriteMessageResult => {
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
