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
import {
  listFocusedMembersInRoom,
  listLapsedUnpromptedShields,
  markTimerPrompted
} from './focusModeStore';
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
import { getMessageById, postSystemMessage, listMessagesAfterLatestBreak } from './chatMessageStore';
import { listReactionsForMessage } from './messageReactionStore';
import { summariseBlock } from './blockDigest';
import type { FocusEntry } from './focusModeStore';
import { listLinkedTerminalRowsForRoom, getLinkedTerminalRowBySessionId } from './linkedRoomTerminalLookup';
import { deriveHandle, getTerminalRecord } from './terminalRecordsStore';
import { hasBareEveryoneMention, hasBracketedMention, listBareMentionHandles } from '../chat/mentionRouting';
import { listReadersForMessage, markMessageRead } from './messageReadReceiptStore';
import { broadcastToRoom } from './eventBroadcast';
import { findHandleForAliasInRoom } from './chatRoomAliasStore';
import { getActiveWorkingClaim, listActiveClaimsForEntity } from './entityClaimStore';
import { listRespondersForRoom } from './roomRespondersStore';
import { pickNextResponder, type ResponderWithStatus } from './responderPicker';
import { openAskInRoom, AskTargetNotHumanError, AskerNotInInboxError } from './askStore';
import type { ChatRoom } from './chatRoomStore';
import { inboxRoomIdFor } from './humanInboxRoomStore';

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

function toEnvelopeMessage(q: QueuedItem): EnvelopeMessage {
  return {
    roomName: q.roomName,
    roomId: q.roomId,
    messageId: q.messageId,
    senderHandle: q.senderHandle,
    body: q.body,
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
export function sendCoordinationRelay(roomId: string, recipientHandle: string, body: string): boolean {
  const room = findChatRoomById(roomId);
  if (!room) return false;
  const membership = listMembershipsForRoom(roomId).find((m) => m.handle === recipientHandle);
  if (!membership?.terminal_id) return false;
  queue.enqueue(queueKeyFor(roomId, membership.terminal_id), {
    roomId,
    roomName: room.name,
    messageId: `relay-${Date.now()}-${membership.terminal_id}`,
    senderHandle: '@system',
    body,
    recipientHandle,
    terminalId: membership.terminal_id
  });
  return true;
}

/**
 * Focus MVP-2 slice 3 — fire the directed timer-lapse prompt to the SETTER for
 * every shield whose timer has lapsed and hasn't been prompted yet. STAY-
 * shielded (JWPK 2026-06-05): the focus is NOT auto-released — the setter is
 * prompted (privately, never a room post; self-set → goes to the member) to
 * extend or release, and the member stays shielded until then. One-shot per
 * lapse via markTimerPrompted. Piggybacks on room activity (the fanout call)
 * rather than a background timer — if the room's quiet there's no flood to
 * escape, so the prompt only matters once traffic resumes.
 */
export function fireFocusTimerPrompts(roomId: string): void {
  for (const focus of listLapsedUnpromptedShields(roomId)) {
    const reasonSuffix = focus.reason ? ` (reason: ${focus.reason})` : '';
    const selfSet = focus.setter === focus.memberHandle;
    const body = selfSet
      ? `⏰ Your focus shield timer has lapsed${reasonSuffix}. You're STILL shielded — exitFocus to rejoin, or it stays shielded.`
      : `⏰ Focus shield timer lapsed for ${focus.memberHandle}${reasonSuffix} (you set it). They're STILL shielded — extend, release them, or leave it shielded.`;
    let delivered = false;
    try {
      delivered = sendCoordinationRelay(roomId, focus.setter, body);
    } catch {
      /* best-effort notify; never block fanout */
    }
    if (delivered) {
      markTimerPrompted(roomId, focus.memberHandle);
    }
  }
}

/**
 * Focus MVP-2 slice 4b — on shield RELEASE, deliver the break-bounded,
 * reaction-weighted digest of what the member missed, DIRECTED to them only
 * (never a room post). Solo release delivers nothing (the soloer received
 * everything; others were the muted ones). No-op when there's nothing to
 * summarise. Best-effort — never blocks the release.
 */
export function deliverFocusExitDigest(roomId: string, focus: FocusEntry): void {
  if (focus.mode !== 'shield') return;
  // Missed window = CURRENT-BLOCK messages posted AFTER the shield began.
  // listMessagesAfterLatestBreak keeps it break-bounded — the digest never
  // reconstructs across a system-break (that boundary is hard, per the design).
  const blockMessages = listMessagesAfterLatestBreak(roomId).filter(
    (m) => m.postedAt > focus.enteredAt
  );
  if (blockMessages.length === 0) return;
  const reactionCountByMessageId = new Map<string, number>();
  for (const m of blockMessages) {
    reactionCountByMessageId.set(m.id, listReactionsForMessage(m.id).length);
  }
  const digest = summariseBlock({ messages: blockMessages, reactionCountByMessageId });
  if (digest.text.length === 0) return;
  try {
    sendCoordinationRelay(roomId, focus.memberHandle, digest.text);
  } catch {
    /* best-effort; release already succeeded */
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
  // Focus slice 3: on any room activity, fire any pending lapsed-shield timer
  // prompts to setters (directed, one-shot, never auto-release).
  fireFocusTimerPrompts(roomId);
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
  // Focus mode (JWPK 2026-06-05) — MVP-2 slice 2: mode-aware suppression at the
  // inject seam. Per-member (focusModeStore, persisted), so focusing @localant
  // never affects @researchant. Nothing is lost — the message is in room history
  // regardless; focus only gates the PTY push, and the missed stream is
  // reconstructed as the break-bounded exit digest (slice 4). Distinct from
  // heads-down (responder relay) and room-mode (room-wide).
  //   • SHIELD @X  → X stops receiving the room entirely. By default even a
  //     direct @-mention is suppressed (→ digest), so a mention can't be a flood
  //     vector (team-locked, JWPK 'make a decision and go'). The breakthrough
  //     knob below flips that to "mentions break through" with one line.
  //   • SOLO @X    → mute EVERYONE ELSE so X works/presents uninterrupted; only
  //     the solo target(s) keep receiving.
  // FOCUS_SHIELD_MENTION_BREAKTHROUGH: false = no live breakthrough (default,
  // team-locked). Flip to true to restore JWPK's earlier "mentions break
  // through" pick — single-line, no other change.
  const FOCUS_SHIELD_MENTION_BREAKTHROUGH = false;
  const focusEntries = listFocusedMembersInRoom(roomId);
  const shieldedHandles = new Set(
    focusEntries.filter((e) => e.mode === 'shield').map((e) => e.memberHandle)
  );
  const soloTargets = new Set(
    focusEntries.filter((e) => e.mode === 'solo').map((e) => e.memberHandle)
  );
  const soloActive = soloTargets.size > 0;
  for (const membership of memberships) {
    if (sameAuthorHandle(membership.handle, message.authorHandle)) continue;
    // SOLO: when any member is soloing the room, only the solo target(s) receive.
    if (soloActive && !soloTargets.has(membership.handle)) {
      continue;
    }
    // SHIELD: a shielded member's firehose is suppressed; a direct @-mention
    // breaks through ONLY when the breakthrough knob is on (default off).
    if (
      shieldedHandles.has(membership.handle) &&
      !(FOCUS_SHIELD_MENTION_BREAKTHROUGH && membershipIsTargeted(membership, targetedHandles))
    ) {
      continue;
    }
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
    if (soloActive && !soloTargets.has(linkedHandle)) continue;
    if (
      shieldedHandles.has(linkedHandle) &&
      !(FOCUS_SHIELD_MENTION_BREAKTHROUGH && targetedHandles.has(linkedHandle))
    ) {
      continue;
    }
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
