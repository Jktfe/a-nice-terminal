/**
 * pty-inject-fanout — wires chat messages → per-handle queue → bridge.
 *
 * Called from POST /api/chat-rooms/:roomId/messages after appendMessage.
 * Entry guard rejects system / system-break messages so stale-marker
 * emissions cannot recurse (per B3 fanout-recursion-lockout).
 *
 * For each targeted recipient:
 *   - bare @handle routes to that member's terminal
 *   - bare @everyone routes to every member except the sender
 *   - @you operator posts route to every non-browser member terminal
 *   - bracketed [@handle] stays informational and does not inject
 *   - linked terminal chat rooms still inject to their intrinsic pane
 *   - on flush: bridge.injectToTerminal runs verify + paste-or-marker
 */

import type { ChatMessage } from './chatMessageStore';
import { findChatRoomById } from './chatRoomStore';
import { listMembershipsForRoom, type RoomMembershipRow } from './roomMembershipsStore';
import { getTerminalById, touchLastPtyByteAt } from './terminalsStore';
import { canonicaliseOperatorHandle, isOperatorHandle } from './operatorHandle';
import { getRoomMode } from './roomModesStore';
import {
  injectToTerminal,
  formatEnvelope,
  type EnvelopeInput,
  type EnvelopeMessage
} from './pty-inject-bridge';
import { makeInjectQueue } from './pty-inject-queue';
import { getMessageById, postSystemMessage } from './chatMessageStore';
import { listLinkedTerminalRowsForRoom, getLinkedTerminalRowBySessionId } from './linkedRoomTerminalLookup';
import { deriveHandle, getTerminalRecord } from './terminalRecordsStore';
import { hasBareEveryoneMention, hasBracketedMention, listBareMentionHandles } from '../chat/mentionRouting';
import { listReadersForMessage, markMessageRead } from './messageReadReceiptStore';
import { broadcastToRoom } from './eventBroadcast';
import { findHandleForAliasInRoom } from './chatRoomAliasStore';
import { getActiveWorkingClaim, listActiveClaimsForEntity, hasActiveClaimForHandle } from './entityClaimStore';
import { getAgentStatus } from './agentStatusStore';
import { computeIdleTriggers, type IdleReportRow } from './idleAgentTriggers';
import { listRespondersForRoom } from './roomRespondersStore';
import { pickNextResponder, type ResponderWithStatus } from './responderPicker';
import { openAskInRoom, AskTargetNotHumanError, AskerNotInInboxError } from './askStore';
import type { ChatRoom } from './chatRoomStore';
import { inboxRoomIdFor } from './humanInboxRoomStore';
import { buildMessageDeliveryEnvelope } from './messageDeliveryEnvelope';
import { getContextState, markContextSeen } from './roomSessionContextStore';
import { resolveCurrentOwner } from './roomIdentityResolver';

// (room × askee × messageId) → already opened; prevents double-file under
// retried fanout. Bounded — entries age out after fanout for the message
// completes; in practice only ever holds a handful of entries at a time
// (one per still-fanning message). No TTL needed.
const askedForMessage = new Set<string>();
function askedKey(roomId: string, askee: string, messageId: string): string {
  return `${roomId}::${askee}::${messageId}`;
}

// Duplicate responder-routing guard (JWPK msg_ktbgn99ft1):
// A single (roomId, messageId, handle) triple should only be enqueued once
// per fanout session. This prevents double-delivery if the same message is
// re-fanned (e.g., retry or duplicate event).
const routedForMessage = new Set<string>();
function routedKey(roomId: string, messageId: string, handle: string): string {
  return `${roomId}::${messageId}::${handle}`;
}

function autoOpenAsksForHumanMentions(
  room: ChatRoom,
  message: ChatMessage,
  targetedHandles: Set<string>
): void {
  if (targetedHandles.size === 0) return;
  // System messages are not asks — they're side-effects of other actions.
  if (message.kind !== 'human' && message.kind !== 'agent') return;
  for (const handle of targetedHandles) {
    if (handle === message.authorHandle) continue;
    const member = room.members.find((m) => m.handle === handle);
    if (!member || member.kind !== 'human') continue;  // agent target → no ask
    const dedupeKey = askedKey(room.id, handle, message.id);
    if (askedForMessage.has(dedupeKey)) continue;
    askedForMessage.add(dedupeKey);
    try {
      const opened = openAskInRoom({
        roomId: room.id,
        openedByHandle: message.authorHandle,
        targetHandle: handle,
        // Title = first ~80 chars of body; falls back to "Question" when
        // body opens with the @-mention and not much else (rare).
        title: makeAskTitle(message.body, handle),
        body: message.body
      });
      // Per-human inbox slice 6: broadcast ask_added into the askee's
      // inbox room so the inbox UI shows the new question immediately
      // (no poll). The originating-room fanout already covers the
      // chat-side message rendering.
      try {
        broadcastToRoom(inboxRoomIdFor(handle), {
          type: 'ask_added',
          askId: opened.id,
          targetHandle: handle,
          roomId: room.id,
          openedByHandle: message.authorHandle,
          title: opened.title
        });
      } catch {
        /* inbox broadcast best-effort */
      }
    } catch (cause) {
      // AskTargetNotHumanError = race (member kind flipped between check
      // and openAskInRoom); fail silently. AskerNotInInboxError can
      // legitimately fire when a fresh agent @-mentions a human in a
      // room the agent isn't a member of yet (rare race) — also silent.
      // Anything else is unexpected and worth logging without breaking
      // the underlying fanout.
      const isExpected = cause instanceof AskTargetNotHumanError ||
                         cause instanceof AskerNotInInboxError;
      if (!isExpected) {
        console.warn(`[fanout] auto-open ask failed for ${handle}:`, cause);
      }
    }
  }
}

function makeAskTitle(body: string, targetHandle: string): string {
  const stripped = body
    .replace(new RegExp(`(^|\\s)${targetHandle}\\b`, 'g'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (stripped.length === 0) return 'Question';
  return stripped.length <= 80 ? stripped : `${stripped.slice(0, 77)}...`;
}

/**
 * PID-as-identity model JWPK msg_n2cyrel4u5 (2026-05-21).
 *
 * Bare mentions in a message body can be ANY alias the recipient owns in this
 * room, not just the global handle. Resolve every token through the alias
 * table BEFORE deciding who to route to — once resolved, downstream code only
 * compares against the canonical membership.handle and never has to reason
 * about which alias was used.
 *
 * Pre-2026-05-21 we resolved only the most-recently-set alias at
 * routing time, which silently dropped older aliases as soon as a new one
 * was added (chatRoomAliasStore was 1-alias-per-handle then). Now any of
 * the N stacked aliases routes correctly.
 */
function resolveBareMentionsToGlobalHandles(roomId: string, body: string): Set<string> {
  const resolved = new Set<string>();
  for (const token of listBareMentionHandles(body)) {
    if (token.toLowerCase() === '@everyone') continue;
    resolved.add(findHandleForAliasInRoom(roomId, token));
  }
  return resolved;
}

const FANOUT_KINDS_ALLOWED = new Set(['human', 'agent']);

type QueuedItem = {
  roomId: string;
  roomName: string;
  messageId: string;
  senderHandle: string;
  body: string;
  recipientHandle: string;
  terminalId: string;
  postOrder: number;
  discussion_id?: string;
  // JWPK msg_wcq5fwlhg7 (2026-05-19): pre-resolved reply-parent context.
  // Carried verbatim into the envelope so agents see what they're
  // responding to without scrolling. Parent body is the FULL body here;
  // truncation to a single-line preview happens in formatEnvelope.
  replyParent?: { messageId: string; senderHandle: string; body: string };
};

type FanoutOptions = {
  forceBroadcastToAll?: boolean;
};

function queueKeyFor(roomId: string, terminalId: string): string {
  return `${roomId}::${terminalId}`;
}

const queue = makeInjectQueue<QueuedItem>(onFlush);

function recipientSessionIdFor(q: QueuedItem): string {
  return resolveCurrentOwner(q.roomId, q.recipientHandle)?.session.id ?? q.terminalId;
}

function toEnvelopeMessage(q: QueuedItem): EnvelopeMessage {
  const recipientSessionId = recipientSessionIdFor(q);
  const context = getContextState(q.roomId, recipientSessionId);
  return {
    roomName: q.roomName,
    roomId: q.roomId,
    messageId: q.messageId,
    senderHandle: q.senderHandle,
    body: q.body,
    deliveryEnvelope: buildMessageDeliveryEnvelope({
      roomId: q.roomId,
      roomName: q.roomName,
      message: {
        id: q.messageId,
        authorHandle: q.senderHandle,
        body: q.body,
        postOrder: q.postOrder,
        ...(q.replyParent !== undefined && { parentMessageId: q.replyParent.messageId })
      },
      recipientHandle: q.recipientHandle,
      recipientFallbackSessionId: recipientSessionId,
      context
    }),
    ...(q.discussion_id !== undefined && { discussion_id: q.discussion_id }),
    ...(q.replyParent !== undefined && { replyParent: q.replyParent })
  };
}

function onFlush(handle: string, batch: QueuedItem[]): void {
  if (batch.length === 0) return;
  const head = batch[0];
  const tail = batch.slice(1);
  const envelopeInput: EnvelopeInput = {
    head: toEnvelopeMessage(head),
    batchedExtras: tail.map(toEnvelopeMessage)
  };
  const envelope = formatEnvelope(envelopeInput);
  // T1c: terminal_records-linked rows aren't in terminalsStore. Fall back to
  // the linked-room lookup when getTerminalById misses (head.terminalId is
  // a sessionId for linked-room deliveries).
  const identityTerminal = getTerminalById(head.terminalId);
  const linkedTerminal = getLinkedTerminalRowBySessionId(head.terminalId);
  const terminal = identityTerminal?.tmux_target_pane
    ? identityTerminal
    : (linkedTerminal ?? identityTerminal);
  if (!terminal) return;
  const outcome = injectToTerminal(terminal, envelope, head.roomId, head.recipientHandle, emitStaleSystemMessage);
  if (outcome.kind === 'paste') {
    for (const item of batch) {
      markContextSeen(item.roomId, recipientSessionIdFor(item));
    }
    markDeliveredBatchRead(batch);
  }
}

function markDeliveredBatchRead(batch: QueuedItem[]): void {
  for (const item of batch) {
    try {
      markMessageRead({ messageId: item.messageId, readerHandle: item.recipientHandle });
      broadcastToRoom(item.roomId, {
        type: 'message_read',
        roomId: item.roomId,
        messageId: item.messageId,
        readerHandle: item.recipientHandle,
        readers: listReadersForMessage(item.messageId)
      });
    } catch {
      /* decorative telemetry; delivery already succeeded */
    }
  }
}

function recipientHandleForLinkedTerminal(sessionId: string): string {
  const record = getTerminalRecord(sessionId);
  return record ? deriveHandle(record) : `@${sessionId}`;
}

function membershipIsTargeted(
  membership: RoomMembershipRow,
  targetedHandles: Set<string>
): boolean {
  // PID-as-identity: targetedHandles is already canonical (every alias was
  // resolved to its owning global handle at parse time via
  // resolveBareMentionsToGlobalHandles). Equality on the canonical handle is
  // all that's needed — no more "is this token also an alias of mine?"
  // fallback that only ever worked for the most-recent alias.
  return targetedHandles.has(membership.handle);
}

function isOperatorBroadcastAuthor(handle: string): boolean {
  return isOperatorHandle(handle);
}

function sameAuthorHandle(left: string, right: string): boolean {
  return canonicaliseOperatorHandle(left).toLowerCase() === canonicaliseOperatorHandle(right).toLowerCase();
}

function isBrowserTerminalSource(source: string | null | undefined): boolean {
  return typeof source === 'string' && source.startsWith('browser');
}

function activeClaimAllowsRecipient(message: ChatMessage, recipientHandle: string): boolean {
  const activeWorkingClaim = getActiveWorkingClaim('message', message.id);
  if (!activeWorkingClaim) return true;
  // JWPK msg_le6o84ipu1: working claim with no response after 30s is
  // treated as passed so the message can route to the next responder.
  const AUTO_PASS_MS = 30_000;
  if (Date.now() - activeWorkingClaim.claimed_at_ms > AUTO_PASS_MS) return true;
  return activeWorkingClaim.claimed_by_handle === recipientHandle;
}

function emitStaleSystemMessage(roomId: string, handle: string, reason: string): void {
  try {
    postSystemMessage({
      roomId,
      body: `${handle} appears offline (pane ${reason}). Re-register to resume direct delivery.`
    });
  } catch {
    /* room may have vanished; system marker is best-effort */
  }
}

/**
 * Deliver a directed heads-down relay notification to a single responder's
 * terminal (e.g. "taken by @x", "this is now available to claim"). Routes
 * through the same per-handle inject queue as normal fanout, so the responder
 * receives it in their terminal. Best-effort: no-op if the room or the
 * responder's membership/terminal can't be resolved.
 */
export function sendCoordinationRelay(roomId: string, recipientHandle: string, body: string): void {
  const room = findChatRoomById(roomId);
  if (!room) return;
  const membership = listMembershipsForRoom(roomId).find((m) => m.handle === recipientHandle);
  if (!membership?.terminal_id) return;
  queue.enqueue(queueKeyFor(roomId, membership.terminal_id), {
    roomId,
    roomName: room.name,
    messageId: `relay-${Date.now()}-${membership.terminal_id}`,
    senderHandle: '@system',
    body,
    recipientHandle,
    terminalId: membership.terminal_id,
    // Directed relays are not persisted chat messages, so they do not own
    // a room post_order. Use a monotonic synthetic order for the envelope.
    postOrder: Date.now()
  });
}

/**
 * Idle-agent monitor + trigger (JWPK 2026-06-06). Gathers each room member's
 * CANONICAL status (agentStatusStore — consumed, not re-derived) + open-work
 * signal (an active claim), runs the idle policy, fires a ONE-SHOT directed
 * nudge to each newly-idle agent (sendCoordinationRelay — never a room post),
 * and returns the per-room report for the controller. Piggybacks on room
 * activity (the fanout call); a quiet room has no flood to escape, so a nudge
 * only matters once traffic resumes.
 */
export function runIdleMonitor(
  roomId: string,
  nowMs: number = Date.now(),
  activeAuthorHandle?: string
): IdleReportRow[] {
  const agents = listMembershipsForRoom(roomId)
    .filter((m) => m.terminal_id)
    .map((m) => {
      const status = getAgentStatus(m.terminal_id);
      const isCurrentAuthor =
        activeAuthorHandle !== undefined && sameAuthorHandle(m.handle, activeAuthorHandle);
      return {
        handle: m.handle,
        status: isCurrentAuthor ? 'working' : status?.agent_status ?? null,
        lastActivityMs: isCurrentAuthor ? nowMs : status?.agent_status_at_ms ?? null,
        hasOpenWork: hasActiveClaimForHandle(m.handle)
      };
    });
  const { report, nudges } = computeIdleTriggers({ scopeId: roomId, agents, now: nowMs });
  for (const nudge of nudges) {
    try {
      sendCoordinationRelay(roomId, nudge.handle, nudge.text);
    } catch {
      /* best-effort; never block fanout */
    }
  }
  return report;
}

// Per-room throttle so the idle sweep runs at most once a minute regardless of
// message volume (the scan is O(members) of status+claim queries).
const lastIdleMonitorRunMs = new Map<string, number>();
const IDLE_MONITOR_THROTTLE_MS = 60_000;
export function resetIdleMonitorThrottleForTests(): void {
  lastIdleMonitorRunMs.clear();
}
function maybeRunIdleMonitor(roomId: string, activeAuthorHandle?: string): void {
  const now = Date.now();
  if (now - (lastIdleMonitorRunMs.get(roomId) ?? 0) < IDLE_MONITOR_THROTTLE_MS) return;
  lastIdleMonitorRunMs.set(roomId, now);
  try {
    runIdleMonitor(roomId, now, activeAuthorHandle);
  } catch {
    /* best-effort; never block fanout */
  }
}

export function fanoutMessageToRoomTerminals(
  roomId: string,
  message: ChatMessage,
  options: FanoutOptions = {}
): void {
  if (!FANOUT_KINDS_ALLOWED.has(message.kind)) return;
  const room = findChatRoomById(roomId);
  if (!room) return;
  // Room-mode guard (M3.b.4 + #152):
  //   closed → defensive race-guard; messages route already 409s.
  //   heads-down no longer auto-picks a responder for unmentioned chatter.
  //   Explicit @handle / @everyone routing still works in either open mode.
  const mode = getRoomMode(roomId);
  if (mode === 'closed') return;
  // Idle monitor: on room activity, run the idle-trigger sweep (throttled per
  // room) so newly-idle agents get a one-shot directed nudge. Best-effort.
  maybeRunIdleMonitor(roomId, message.authorHandle);
  const memberships = listMembershipsForRoom(roomId);
  const targetedHandles = resolveBareMentionsToGlobalHandles(roomId, message.body);
  const containsInformationalMention = hasBracketedMention(message.body);

  // Asks-as-pill (JWPK 2026-05-22): every bare @-mention of a HUMAN member
  // opens an ask targeting that human, with the message body as the ask
  // content. Skips agent targets, self-mentions, and system messages. The
  // ask is the canonical source-of-truth for the human's response-required
  // pill (askStore.hasResponseRequiredAsksForHandle). Idempotency: dedupe
  // on (room × askee × messageId) via a small in-process Set so a
  // double-fanout of the same message doesn't double-file the ask.
  autoOpenAsksForHumanMentions(room, message, targetedHandles);
  let broadcastToAll =
    options.forceBroadcastToAll === true ||
    hasBareEveryoneMention(message.body) ||
    (isOperatorBroadcastAuthor(message.authorHandle) && targetedHandles.size === 0);
  // Heads-down responder routing (JWPK msg_eshm5ekuh8):
  // Try ordered responder list first. If a verified non-sender
  // responder exists, route only to them. If all pass/unavailable,
  // fall back to broadcast-to-all so someone can claim it.
  if (
    mode === 'heads-down' &&
    !broadcastToAll &&
    targetedHandles.size === 0 &&
    message.kind === 'human'
  ) {
    const responderRows = listRespondersForRoom(roomId);
    if (responderRows.length > 0) {
      const responderMemberships = listMembershipsForRoom(roomId);
      const handleByTerminal = new Map(responderMemberships.map((m) => [m.terminal_id, m.handle]));
      const respondersWithStatus: ResponderWithStatus[] = responderRows.map((row) => {
        const terminal = getTerminalById(row.terminal_id);
        return {
          terminal_id: row.terminal_id,
          order_index: row.order_index,
          pane_status: terminal?.pane_status ?? 'unknown',
          handle: handleByTerminal.get(row.terminal_id) ?? ''
        };
      });
      // Build pass + working maps from active claims on this message.
      const claims = listActiveClaimsForEntity('message', message.id);
      const passHandles = new Set(
        claims.filter((c) => c.claim_kind === 'pass').map((c) => c.claimed_by_handle)
      );
      const workingMap = new Map(
        claims
          .filter((c) => c.claim_kind === 'working')
          .map((c) => [c.claimed_by_handle, c.claimed_at_ms] as const)
      );
      const timedOutHandles = new Set<string>();
      for (const r of respondersWithStatus) {
        const workingAtMs = workingMap.get(r.handle);
        if (workingAtMs !== undefined && Date.now() - workingAtMs > 30_000) {
          timedOutHandles.add(r.handle);
        }
      }
      const picked = pickNextResponder(respondersWithStatus, message.authorHandle, {
        passHandles,
        workingHandles: workingMap,
        autoPassWorkingMs: 30_000
      });
      if (picked) {
        targetedHandles.add(picked.handle);
      } else {
        // Fallback: route to verified responders who have NOT passed AND not timed out.
        for (const r of respondersWithStatus) {
          if (r.handle === message.authorHandle) continue;
          if (r.pane_status !== 'verified') continue;
          if (passHandles.has(r.handle)) continue;
          if (timedOutHandles.has(r.handle)) continue;
          targetedHandles.add(r.handle);
        }
      }
    } else {
      broadcastToAll = true;
    }
  }

  if (
    mode === 'heads-down' &&
    !broadcastToAll &&
    targetedHandles.size === 0
  ) {
    return;
  }
  // Resolve the reply-parent ONCE for this fanout. Every recipient sees
  // the same reply context — no point hitting the DB per-membership.
  // Tombstoned parents still surface their (now-empty) handle + body
  // so the agent at least sees the link; the body field will be empty.
  let replyParent: { messageId: string; senderHandle: string; body: string } | null = null;
  if (typeof message.parentMessageId === 'string' && message.parentMessageId.length > 0) {
    const parent = getMessageById(message.parentMessageId);
    if (parent) {
      replyParent = {
        messageId: parent.id,
        senderHandle: parent.authorHandle,
        body: parent.body
      };
    }
  }
  for (const membership of memberships) {
    if (sameAuthorHandle(membership.handle, message.authorHandle)) continue;
    if (!broadcastToAll && !membershipIsTargeted(membership, targetedHandles)) continue;
    if (!activeClaimAllowsRecipient(message, membership.handle)) continue;
    const terminal = getTerminalById(membership.terminal_id);
    if (!terminal || !terminal.tmux_target_pane) continue;
    if (isBrowserTerminalSource(terminal.source)) continue;
    // JWPK msg_m6swrkw61q (2026-05-19) — @-only toggle enforcement.
    // Per-terminal onlyRespondTo allowlist persisted in terminals.meta.
    // When non-empty, the terminal ONLY receives messages whose bare
    // mentions include at least one of the allowed handles. Empty list
    // (or missing) → respond-to-everyone (existing behaviour).
    // UI shipped in 7e7c254 TerminalSettingsModal; this closes the
    // server-side enforcement gap that made the toggle UI-only theatre.
    try {
      const metaParsed = typeof terminal.meta === 'string' && terminal.meta.length > 0
        ? JSON.parse(terminal.meta) as Record<string, unknown>
        : {};
      const onlyRespondToRaw = metaParsed.onlyRespondTo;
      if (Array.isArray(onlyRespondToRaw) && onlyRespondToRaw.length > 0) {
        // Canonicalise the allowlist via the same alias resolver as
        // targetedHandles — operator may have typed an alias (@cdx) but
        // means the underlying member, so route on canonical handles in
        // both directions. PID-as-identity 2026-05-21.
        const allowedGlobalHandles = new Set<string>();
        for (const raw of onlyRespondToRaw) {
          if (typeof raw !== 'string' || raw.length === 0) continue;
          const withAt = raw.startsWith('@') ? raw : `@${raw}`;
          allowedGlobalHandles.add(findHandleForAliasInRoom(room.id, withAt));
        }
        if (allowedGlobalHandles.size > 0) {
          const hasAllowedMention = [...targetedHandles].some((h) => allowedGlobalHandles.has(h));
          if (!hasAllowedMention) continue;  // filter out, terminal stays quiet
        }
      }
    } catch {
      /* meta JSON malformed → fail-open (respond as if no filter); the
         operator setting an invalid filter shouldn't silently break delivery */
    }
    const rk = routedKey(room.id, message.id, membership.handle);
    if (routedForMessage.has(rk)) continue;
    routedForMessage.add(rk);
    queue.enqueue(queueKeyFor(room.id, terminal.id), {
      roomId: room.id,
      roomName: room.name,
      messageId: message.id,
      senderHandle: message.authorHandle,
      body: message.body,
      recipientHandle: membership.handle,
      terminalId: terminal.id,
      postOrder: message.postOrder,
      ...(message.discussion_id !== undefined && { discussion_id: message.discussion_id }),
      ...(replyParent !== null && { replyParent })
    });
    // M3.4a-v2 T3d Q5 touchpoint: bump last_pty_byte_at_ms on successful
    // enqueue. Best-effort — failures already swallowed inside the helper.
    touchLastPtyByteAt(terminal.id);
  }
  // T2-LINKED-CHAT-T1c (2026-05-14, PATH A flowspec lift): linked-chat-room
  // direct path — terminal_records.linked_chat_room_id == room.id reaches
  // the pane WITHOUT requiring a room_memberships row. Each terminal_record
  // is 1:1 with its linked room (T1b auto-create). Skip terminals already
  // enqueued via memberships above to avoid double delivery.
  const enqueuedIds = new Set<string>(
    memberships.map((m) => m.terminal_id)
  );
  for (const terminal of listLinkedTerminalRowsForRoom(room.id)) {
    if (enqueuedIds.has(terminal.id)) continue;
    const linkedHandle = recipientHandleForLinkedTerminal(terminal.id);
    if (!broadcastToAll && targetedHandles.size === 0 && containsInformationalMention) continue;
    if (targetedHandles.size > 0 && !broadcastToAll && !targetedHandles.has(linkedHandle)) continue;
    if (!activeClaimAllowsRecipient(message, linkedHandle)) continue;
    const rk = routedKey(room.id, message.id, linkedHandle);
    if (routedForMessage.has(rk)) continue;
    routedForMessage.add(rk);
    queue.enqueue(queueKeyFor(room.id, terminal.id), {
      roomId: room.id,
      roomName: room.name,
      messageId: message.id,
      senderHandle: message.authorHandle,
      body: message.body,
      recipientHandle: linkedHandle,
      terminalId: terminal.id,
      postOrder: message.postOrder,
      ...(message.discussion_id !== undefined && { discussion_id: message.discussion_id })
    });
  }
}

/**
 * JWPK msg_83dhe5anh7 (2026-05-19) — "reactions to a message using the emojis
 * don't get sent to a terminal - I feel like it should get sent to the
 * terminal that posted". The POST /reactions route persists the row + bumps
 * an ask candidate for 🙋‍♂️, but it never injects to the original author's
 * PTY, so agents don't see when their messages get reacted to.
 *
 * Fanout target is the SINGLE original author (per JWPK's "the terminal that
 * posted"). Skips:
 *   - Self-reactions (author reacting to own message → no notification).
 *   - Browser-source terminals (the author was using the web UI; no PTY).
 *   - Linked-room terminals (those don't have memberships rows; reactions in
 *     those rooms cleanly no-op for now; v2 can extend to listLinkedTerminalRowsForRoom).
 *   - Authors without a tmux pane (offline; nothing to deliver to).
 *
 * Envelope format (single-line per terminalReplyRouter's `^[ANT` anchor):
 *   [ANT room <name> id=<roomId> reaction-on=<msgId>] @reactor reacted with <emoji>
 *     ↳ your message: "<truncated body 120c>"
 *   [ANT reply instruction: ...]
 */
const REACTION_PARENT_PREVIEW_CHARS = 120;

function previewReactionParentBody(body: string): string {
  const collapsed = body.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= REACTION_PARENT_PREVIEW_CHARS) return collapsed;
  return `${collapsed.slice(0, REACTION_PARENT_PREVIEW_CHARS - 1)}…`;
}

export function fanoutReactionToAuthor(
  roomId: string,
  messageId: string,
  reactorHandle: string,
  emoji: string
): void {
  const room = findChatRoomById(roomId);
  if (!room) return;
  const message = getMessageById(messageId);
  if (!message) return;
  if (message.authorHandle === reactorHandle) return;
  const memberships = listMembershipsForRoom(roomId);
  const authorMembership = memberships.find((m) => m.handle === message.authorHandle);
  if (!authorMembership) return;
  const terminal = getTerminalById(authorMembership.terminal_id);
  if (!terminal || !terminal.tmux_target_pane) return;
  if (isBrowserTerminalSource(terminal.source)) return;
  const preview = previewReactionParentBody(message.body);
  const envelope =
    `[ANT room ${room.name} id=${room.id} reaction-on=${message.id}] ${reactorHandle} reacted with ${emoji}\n` +
    `  ↳ your message: "${preview}"\n\n` +
    `[ANT reply instruction: respond with: ant chat reply ${message.id} --stdin]`;
  injectToTerminal(terminal, envelope, room.id, message.authorHandle, emitStaleSystemMessage);
  touchLastPtyByteAt(terminal.id);
}

export function resetNoResponderRateLimitForTests(): void {
  /* Kept for older tests/imports; #152 removed no-responder auto-markers. */
}

export function resetFanoutQueueForTests(): void {
  queue.resetForTests();
  routedForMessage.clear();
}

export function getFanoutQueueForTests() {
  return queue;
}
