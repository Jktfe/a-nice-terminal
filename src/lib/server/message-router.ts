// ANT v3 — Message Router with Pluggable Adapters
//
// Centralises all message fan-out logic that was previously inline in the
// POST /api/sessions/:id/messages handler. Each delivery mechanism is an
// adapter that implements DeliveryAdapter.
//
// Uses globalThis singleton to survive Vite module duplication (same pattern
// as ws-broadcast.ts).

import { queries } from './db.js';
import { CHAT_BREAK_MSG_TYPE } from './chat-context.js';
import type { AgentStatus } from '../shared/agent-status.js';
import { deriveTerminalActivityState } from '../shared/terminal-activity.js';
import { nanoid } from 'nanoid';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DeliveryAdapter {
  name: string;
  canDeliver(message: RouteMessage, target: RouteTarget): boolean;
  deliver(message: RouteMessage, target: RouteTarget): Promise<DeliveryResult>;
}

export interface RouteMessage {
  id: string;
  sessionId: string;
  content: string;
  role: string;
  senderId: string | null;
  senderName: string;
  senderType: string | null;  // 'terminal' | 'chat' | null (web user)
  target: string | null;
  replyTo: string | null;
  msgType: string;
  meta?: string | null;
  // Phase C of server-split-2026-05-11 — set false by the catch-up
  // loop when the message age exceeds the 30s PTY-injection window.
  // When false, route() will not pick the pty-injection adapter, so
  // stale replays cannot inject buffered text into running agents.
  // Defaults to true (live path).
  allowPtyInject?: boolean;
}

export interface RouteTarget {
  sessionId: string;
  handle: string | null;
  type: string;  // 'terminal' | 'chat'
  cliFlag?: string | null;
}

export interface DeliveryResult {
  adapter: string;
  targetId: string;
  delivered: boolean;
  error?: string;
}

export interface RouteResult {
  messageId: string;
  deliveries: DeliveryResult[];
}

const WORKING_STATUS_STALE_MS = 45_000;
const FOCUS_BYPASS_LIMIT = 3;
const FOCUS_BYPASS_WINDOW_MS = 10 * 60 * 1000;

// ─── @mention parsing ───────────────────────────────────────────────────────

/**
 * Parse @mentions from message content with bracket-escape support.
 *
 *   [@handle] — bracket-escaped, suppressed from routing
 *   @handle   — active mention, routed to that handle only
 *   No @ at all → broadcast to all participants
 *   @mentions that don't match any known handle → treated as broadcast to all
 */
export function parseMentions(content: string, knownHandles: string[]): {
  targets: string[];
  isAllParticipants: boolean;
} {
  // 1. Remove bracket-escaped mentions: [@handle] → placeholder
  const bracketEscaped = content.replace(/\[@[\w.-]+\]/g, '');

  // 2. No @ remaining → broadcast to all
  if (!bracketEscaped.includes('@')) return { targets: [], isAllParticipants: true };

  // 3. Extract @mentions, filter against known handles
  const mentions = [...new Set(bracketEscaped.match(/@[\w.-]+/g) || [])];
  const targets = mentions.filter(m => knownHandles.includes(m));

  return { targets, isAllParticipants: targets.length === 0 };
}

function activeMentionHandles(content: string): string[] {
  const bracketEscaped = content.replace(/\[@[\w.-]+\]/g, '');
  return [...new Set(bracketEscaped.match(/@[\w.-]+/g) || [])];
}

function hasEveryoneMention(content: string): boolean {
  return activeMentionHandles(content).includes('@everyone');
}

export function focusAttentionStatus(
  member: { attention_state?: string | null; attention_expires_at?: number | string | null },
  nowSeconds = Math.floor(Date.now() / 1000),
): 'available' | 'active' | 'expired' {
  if (member.attention_state !== 'focus') return 'available';
  const expiresAt = Number(member.attention_expires_at || 0);
  if (expiresAt > 0 && expiresAt <= nowSeconds) return 'expired';
  return 'active';
}

function metaObject(message: RouteMessage): Record<string, any> {
  if (!message.meta) return {};
  try {
    return typeof message.meta === 'string' ? JSON.parse(message.meta || '{}') : message.meta as any;
  } catch {
    return {};
  }
}

function urgentBypass(message: RouteMessage): { requested: boolean; reason: string | null } {
  const meta = metaObject(message);
  const requested = meta.urgent === true || meta.urgent_bypass === true || meta.focus_bypass === true;
  const reason = typeof meta.urgent_reason === 'string' ? meta.urgent_reason.trim()
    : typeof meta.bypass_reason === 'string' ? meta.bypass_reason.trim()
      : typeof meta.reason === 'string' ? meta.reason.trim()
        : null;
  return { requested, reason: reason || null };
}

function focusQueueKind(message: RouteMessage, explicitTarget: string | null): string {
  if (explicitTarget || activeMentionHandles(message.content).length > 0) return 'mention';
  const lower = message.content.toLowerCase();
  if (/\b(blocked|blocker|stuck|failed|error|needs|waiting)\b/.test(lower)) return 'blocker';
  if (/\b(approved|approve|accepted|rejected|decision|decided|merged|go for it|signed off|sign-off)\b/.test(lower)) return 'decision';
  if (/\b(task|todo|doing|review|owner|build lane|score|scoreboard)\b/.test(lower)) return 'task';
  return 'message';
}

export function sqliteDateTimeAgo(ms: number, nowMs = Date.now()): string {
  return new Date(nowMs - ms).toISOString().replace('T', ' ').slice(0, 19);
}

function focusDigestFor(member: any, rows: any[], cause: 'manual' | 'expired'): string {
  const handle = handlesForMember(member)[0] || member.session_id;
  const room = queries.getSession(member.room_id) as any;
  const roomName = room?.name || member.room_id;
  const grouped: Record<string, any[]> = {
    mention: [],
    decision: [],
    task: [],
    blocker: [],
    message: [],
  };
  for (const row of rows) {
    const kind = grouped[row.kind] ? row.kind : 'message';
    grouped[kind].push(row);
  }

  const lines = [
    `Focus digest for ${handle}: ${rows.length} queued message${rows.length === 1 ? '' : 's'} while you were in focus mode (${cause}).`,
    `Room: ${roomName} (${member.room_id}).`,
  ];

  const append = (title: string, items: any[], max: number) => {
    if (items.length === 0) return;
    lines.push(`${title}:`);
    for (const item of items.slice(0, max)) {
      const sender = item.sender_name || item.sender_id || 'unknown';
      const text = String(item.content || '').replace(/\s+/g, ' ').slice(0, 180);
      lines.push(`- ${sender}: ${text}`);
    }
    if (items.length > max) lines.push(`- ...${items.length - max} more`);
  };

  append('Direct mentions', grouped.mention, 5);
  append('Decisions', grouped.decision, 5);
  append('Tasks/status', grouped.task, 5);
  append('Blockers', grouped.blocker, 5);
  if (grouped.mention.length + grouped.decision.length + grouped.task.length + grouped.blocker.length === 0) {
    append('Other room activity', grouped.message, 4);
  }

  lines.push(`Full backlog if needed: ant chat read ${member.room_id} --limit 80`);
  return lines.join('\n');
}

export function resolveRoomFanout(
  content: string,
  knownHandles: string[],
  senderType: string | null,
): {
  targets: string[];
  isAllParticipants: boolean;
  shouldFanOutToTerminals: boolean;
  protectWorkingTerminals: boolean;
} {
  const { targets, isAllParticipants } = parseMentions(content, knownHandles);
  const activeMentions = activeMentionHandles(content);
  const hasEveryone = activeMentions.includes('@everyone');

  if (senderType !== 'terminal') {
    return { targets, isAllParticipants, shouldFanOutToTerminals: true, protectWorkingTerminals: false };
  }

  // Agent typo guard: @mentions that do not resolve to a room member stay
  // chat-visible only. This prevents a misspelled handle from waking everyone.
  if (activeMentions.length > 0 && !hasEveryone && targets.length === 0) {
    return { targets, isAllParticipants, shouldFanOutToTerminals: false, protectWorkingTerminals: false };
  }

  return {
    targets,
    isAllParticipants,
    shouldFanOutToTerminals: true,
    protectWorkingTerminals: !hasEveryone && targets.length === 0,
  };
}

export function handlesForMember(member: { alias?: string | null; handle?: string | null }): string[] {
  return [...new Set([member.alias, member.handle].filter((h): h is string => !!h))];
}

export function shouldDeliverLinkedChatToTerminal(
  terminalSessionId: string,
  senderId: string | null,
): boolean {
  return terminalSessionId !== senderId;
}

function memberHasAnyHandle(member: { alias?: string | null; handle?: string | null }, handles: string[]): boolean {
  const handleSet = new Set(handles);
  return handlesForMember(member).some(handle => handleSet.has(handle));
}

export function isWorkingAgentStatus(
  status: AgentStatus | null,
  now = Date.now(),
  staleMs = WORKING_STATUS_STALE_MS,
): boolean {
  if (!status) return false;
  if (now - status.detectedAt > staleMs) return false;
  return status.state === 'busy' || status.state === 'thinking';
}

async function isTerminalWorking(sessionId: string): Promise<boolean> {
  try {
    const session = queries.getSession(sessionId) as any;
    const terminalActivity = deriveTerminalActivityState(session?.last_activity);
    if (terminalActivity.state !== 'idle') return true;

    const { getAgentStatus, refreshStatusFromCapture } = await import('./agent-event-bus.js');
    const cached = getAgentStatus(sessionId);
    if (isWorkingAgentStatus(cached)) return true;

    // After server/daemon restarts the in-memory status cache is empty until
    // the next output burst. For routing decisions, refresh from the current
    // pane so a busy TUI does not get treated as idle just because ANT restarted.
    if (!cached || Date.now() - cached.detectedAt > WORKING_STATUS_STALE_MS) {
      return isWorkingAgentStatus(await refreshStatusFromCapture(sessionId));
    }

    return false;
  } catch {
    return false;
  }
}

// ─── System message types that must NOT fan out ─────────────────────────────

const SYSTEM_MSG_TYPES = new Set([
  'prompt', 'silence', 'title', 'agent_response', 'agent_event', 'terminal_line',
  'focus_status', 'focus_bypass', 'focus_digest', CHAT_BREAK_MSG_TYPE,
]);

// ─── MessageRouter ──────────────────────────────────────────────────────────

export class MessageRouter {
  private adapters: DeliveryAdapter[] = [];

  register(adapter: DeliveryAdapter): void {
    this.adapters.push(adapter);
  }

  get adapterCount(): number { return this.adapters.length; }

  async expireFocusForRoom(roomId: string): Promise<void> {
    const expired = queries.listExpiredFocusedMembers(roomId, Math.floor(Date.now() / 1000)) as any[];
    for (const member of expired) {
      await this.releaseFocus(roomId, member.session_id, 'system', 'focus TTL expired', 'expired');
    }
  }

  async expireAllFocus(): Promise<void> {
    const expired = queries.listExpiredFocusedMembers(null, Math.floor(Date.now() / 1000)) as any[];
    for (const member of expired) {
      await this.releaseFocus(member.room_id, member.session_id, 'system', 'focus TTL expired', 'expired');
    }
  }

  async releaseFocus(
    roomId: string,
    sessionId: string,
    releasedBy: string | null,
    reason: string | null,
    cause: 'manual' | 'expired' = 'manual',
  ): Promise<{ queued: number; digest: string | null; delivered: boolean }> {
    const member = queries.getRoomMember(roomId, sessionId) as any;
    if (!member) return { queued: 0, digest: null, delivered: false };

    const rows = queries.listFocusQueue(roomId, sessionId, 200) as any[];
    queries.setMemberAttention(roomId, sessionId, 'available', null, releasedBy, null);
    queries.clearFocusQueue(roomId, sessionId);

    const handle = handlesForMember(member)[0] || sessionId;
    this.postFocusRoomEvent(
      roomId,
      'focus_status',
      `${handle} left focus mode (${cause}${reason ? `: ${reason}` : ''}). ${rows.length} queued message${rows.length === 1 ? '' : 's'} summarised.`,
      releasedBy,
      { focus: { action: 'exit', cause, target_session_id: sessionId, target: handle, queued: rows.length, reason } },
    );

    if (rows.length === 0) return { queued: 0, digest: null, delivered: false };

    const digest = focusDigestFor(member, rows, cause);
    const ptyAdapter = this.adapters.find(a => a.name === 'pty-injection');
    const targetSession = queries.getSession(sessionId) as any;
    if (!ptyAdapter || targetSession?.type !== 'terminal') {
      return { queued: rows.length, digest, delivered: false };
    }

    const digestMessage: RouteMessage = {
      id: nanoid(),
      sessionId: roomId,
      content: digest,
      role: 'assistant',
      senderId: releasedBy,
      senderName: 'ANT focus digest',
      senderType: 'chat',
      target: handle,
      replyTo: null,
      msgType: 'focus_digest',
      meta: JSON.stringify({ focus_digest: true, queued: rows.length, cause }),
    };
    const result = await ptyAdapter.deliver(digestMessage, {
      sessionId,
      handle,
      type: 'terminal',
      cliFlag: member.cli_flag || targetSession.cli_flag || null,
    });
    return { queued: rows.length, digest, delivered: result.delivered };
  }

  postFocusRoomEvent(
    roomId: string,
    msgType: 'focus_status' | 'focus_bypass',
    content: string,
    senderId: string | null,
    meta: Record<string, unknown>,
  ): void {
    try {
      const id = nanoid();
      const metaJson = JSON.stringify(meta);
      queries.createMessage(id, roomId, 'system', content, 'text', 'complete', senderId, null, null, msgType, metaJson);
      const wsAdapter = this.adapters.find(a => a.name === 'ws-broadcast');
      if (wsAdapter) {
        wsAdapter.deliver({
          id,
          sessionId: roomId,
          content,
          role: 'system',
          senderId,
          senderName: 'ANT focus',
          senderType: 'chat',
          target: null,
          replyTo: null,
          msgType,
          meta: metaJson,
        }, { sessionId: roomId, handle: null, type: 'chat' }).catch(() => {});
      }
      import('./ws-broadcast.js').then(({ broadcastGlobal }) => {
        broadcastGlobal({ type: 'sessions_changed' });
        const focus = (meta as any)?.focus;
        if (focus?.target_session_id && (focus.action === 'enter' || focus.action === 'exit')) {
          const queueCount = queries.countFocusQueue(roomId, focus.target_session_id);
          const room = queries.getSession(roomId) as any;
          broadcastGlobal({
            type: 'agent_status_updated',
            sessionId: focus.target_session_id,
            status: focus.action === 'enter'
              ? {
                  state: 'focus',
                  activity: focus.reason ? `Focus mode: ${focus.reason}` : 'Focus mode',
                  waitingFor: queueCount > 0 ? `${queueCount} queued message${queueCount === 1 ? '' : 's'}` : undefined,
                  detectedAt: Date.now(),
                  focus: {
                    roomId,
                    roomName: room?.name || null,
                    reason: focus.reason || null,
                    expiresAt: focus.ttl_seconds ? Math.floor(Date.now() / 1000) + Number(focus.ttl_seconds) : null,
                    queueCount,
                  },
                }
              : {
                  state: 'idle',
                  activity: 'Focus mode cleared',
                  detectedAt: Date.now(),
                },
          });
        }
      }).catch(() => {});
    } catch (e) {
      console.error('[message-router] focus room event failed:', e);
    }
  }

  private async focusedDeliveryDecision(
    message: RouteMessage,
    member: any,
    targetHandle: string | null,
    isEveryone: boolean,
  ): Promise<'deliver' | 'queued'> {
    const status = focusAttentionStatus(member);
    if (status === 'available') return 'deliver';

    if (status === 'expired') {
      await this.releaseFocus(member.room_id, member.session_id, 'system', 'focus TTL expired', 'expired');
      return 'deliver';
    }

    if (isEveryone || hasEveryoneMention(message.content)) return 'deliver';

    const urgent = urgentBypass(message);
    if (urgent.requested && urgent.reason) {
      const recent = queries.countRecentFocusBypasses(
        member.room_id,
        message.senderId,
        sqliteDateTimeAgo(FOCUS_BYPASS_WINDOW_MS),
      );
      if (recent < FOCUS_BYPASS_LIMIT) {
        const handle = targetHandle || handlesForMember(member)[0] || member.session_id;
        this.postFocusRoomEvent(
          member.room_id,
          'focus_bypass',
          `${message.senderName || message.senderId || 'Someone'} bypassed ${handle}'s focus mode. Reason: ${urgent.reason}`,
          message.senderId,
          {
            focus: {
              action: 'bypass',
              target_session_id: member.session_id,
              target: handle,
              sender_id: message.senderId,
              reason: urgent.reason,
              focus_reason: member.attention_reason || null,
            },
          },
        );
        return 'deliver';
      }
    }

    const kind = focusQueueKind(message, targetHandle);
    queries.queueFocusMessage(
      member.room_id,
      member.session_id,
      message.id,
      message.senderId,
      message.senderName,
      targetHandle,
      message.content,
      kind,
    );
    return 'queued';
  }

  /**
   * Route a message to its targets via registered adapters.
   *
   * Centralised loop-prevention rules:
   *   - terminal-originated plain updates only fan out to idle/ready terminals
   *     (busy/thinking terminals are protected)
   *   - target is sender → skip (don't echo back)
   *   - system message types → skip fan-out entirely
   */
  async route(message: RouteMessage): Promise<RouteResult> {
    const deliveries: DeliveryResult[] = [];

    // ── 1. Always broadcast to WS clients for the session ──────────────
    //    The ws-broadcast adapter handles target filtering internally.
    const wsAdapter = this.adapters.find(a => a.name === 'ws-broadcast');
    if (wsAdapter) {
      const wsTarget: RouteTarget = {
        sessionId: message.sessionId,
        handle: message.target || null,
        type: 'chat',
      };
      if (wsAdapter.canDeliver(message, wsTarget)) {
        const result = await wsAdapter.deliver(message, wsTarget);
        deliveries.push(result);
        this.logDelivery(message.id, result);
      }
    }

    // ── 2. Agent response routing (agent_response to linked terminals) ─
    //    Must be handled BEFORE the systemMsgTypes guard.
    if (message.msgType === 'agent_response' && (!message.target || message.target === '@everyone')) {
      const agentAdapter = this.adapters.find(a => a.name === 'linked-chat');
      if (agentAdapter) {
        const linkedTerminals: any[] = queries.getTerminalsByLinkedChat(message.sessionId);
        for (const terminal of linkedTerminals) {
          if (terminal.id === message.senderId) continue;
          const target: RouteTarget = {
            sessionId: terminal.id,
            handle: terminal.handle || null,
            type: 'terminal',
            cliFlag: terminal.cli_flag || null,
          };
          // Pass a special flag via the message for the adapter
          const agentMsg = { ...message, msgType: 'agent_response' };
          if (agentAdapter.canDeliver(agentMsg, target)) {
            const result = await agentAdapter.deliver(agentMsg, target);
            deliveries.push(result);
            this.logDelivery(message.id, result);
          }
        }
      }
    }

    // ── 3. Skip fan-out for system message types ───────────────────────
    if (SYSTEM_MSG_TYPES.has(message.msgType)) {
      return { messageId: message.id, deliveries };
    }

    await this.expireFocusForRoom(message.sessionId);

    // ── 4. Targeted @handle → inject into that terminal's PTY ──────────
    if (message.target && message.target !== '@everyone') {
      // Phase C of server-split-2026-05-11 — when the catch-up loop
      // replays a message older than 30s, allowPtyInject is false and
      // we deliberately leave ptyAdapter null so the existing
      // canDeliver+deliver path naturally skips PTY injection. Stale
      // typed input must not land in a running agent's stdin.
      const allowPty = message.allowPtyInject !== false;
      const ptyAdapter = allowPty
        ? this.adapters.find(a => a.name === 'pty-injection')
        : null;
      const mcpAdapter = this.adapters.find(a => a.name === 'mcp-channel');

      // Room-scoped alias lookup first, then fall back to global handle
      const roomMember: any = queries.getMemberByAlias(message.sessionId, message.target);
      const targetSession: any = roomMember
        ? queries.getSession(roomMember.session_id)
        : queries.getSessionByHandle(message.target);

      if (roomMember && targetSession?.id !== message.senderId) {
        const attentionDecision = await this.focusedDeliveryDecision(message, roomMember, message.target, false);
        if (attentionDecision === 'queued') {
          const result = { adapter: 'focus-queue', targetId: roomMember.session_id, delivered: true };
          deliveries.push(result);
          this.logDelivery(message.id, result);
          return { messageId: message.id, deliveries };
        }
      }

      // Try PTY injection for terminal sessions
      if (ptyAdapter && targetSession?.type === 'terminal') {
        // Loop prevention: don't deliver back to sender
        if (targetSession.id !== message.senderId) {
          const target: RouteTarget = {
            sessionId: targetSession.id,
            handle: message.target,
            type: 'terminal',
            cliFlag: targetSession.cli_flag || null,
          };
          if (ptyAdapter.canDeliver(message, target)) {
            const result = await ptyAdapter.deliver(message, target);
            deliveries.push(result);
            this.logDelivery(message.id, result);
          }
        }
      }

      // Try MCP channel adapter for registered channel handles
      if (mcpAdapter) {
        // Loop prevention: don't deliver back to sender
        if (targetSession?.id !== message.senderId) {
          const target: RouteTarget = {
            sessionId: targetSession?.id || '',
            handle: message.target,
            type: targetSession?.type || 'chat',
          };
          if (mcpAdapter.canDeliver(message, target)) {
            const result = await mcpAdapter.deliver(message, target);
            deliveries.push(result);
            this.logDelivery(message.id, result);
          }
        }
      }

      return { messageId: message.id, deliveries };
    }

    // Identify bracket-escaped mentions to exclude them from ALL delivery
    const bracketedMentions = [...(message.content.match(/\[@[\w.-]+\]/g) || [])];
    const excludedHandles = bracketedMentions.map(m => m.slice(2, -1));

    // ── 5. Linked chat fan-out (private linked chat → its terminal) ────
    //    Private linked chats are terminal control channels. Humans and
    //    coordinator terminals can both type into them; only skip echoing a
    //    terminal's own linked-chat message back into the same terminal.
    const linkedChatAdapter = this.adapters.find(a => a.name === 'linked-chat');
    if (linkedChatAdapter) {
      const linkedTerminals: any[] = queries.getTerminalsByLinkedChat(message.sessionId);
      for (const terminal of linkedTerminals) {
        if (!shouldDeliverLinkedChatToTerminal(terminal.id, message.senderId)) continue;
        if (terminal.handle && excludedHandles.includes(terminal.handle)) continue;

        const target: RouteTarget = {
          sessionId: terminal.id,
          handle: terminal.handle || null,
          type: 'terminal',
          cliFlag: terminal.cli_flag || null,
        };
        if (linkedChatAdapter.canDeliver(message, target)) {
          const result = await linkedChatAdapter.deliver(message, target);
          deliveries.push(result);
          this.logDelivery(message.id, result);
        }
      }
    }

    // ── 6. Group chat fan-out (standalone chatroom → room participants) ─
    //    Only runs for standalone chatrooms (NOT linked chats — Section 5
    //    already handled those). Uses chat_room_members for scoped delivery.
    //    Room member aliases take precedence over global handles for
    //    @mention resolution. NO global fallback — if no room members
    //    exist, no delivery happens (prevents blast-to-all-terminals bug).
    //
    //    Routing:
    //      Human with no @mention or invalid @ → All participants' terminals
    //      Terminal with no @mention           → Idle/ready terminals only
    //      Terminal with invalid @mention      → Chatroom only, no PTY fan-out
    //      Valid @mention                      → Only that @'s terminal(s)
    //      @everyone                           → All participants' terminals
    //    For routed terminal deliveries, also cross-post to each target's
    //    linked chat (but never back to the originating chatroom).
    const isLinkedChat = (queries.getTerminalsByLinkedChat(message.sessionId) as any[]).length > 0;
    if (!isLinkedChat) {
      // Phase C of server-split-2026-05-11 — replay-mode messages
      // older than 30s set allowPtyInject=false to skip the fan-out
      // path. The null adapter falls through the if-block below.
      const allowPty = message.allowPtyInject !== false;
      const ptyAdapter = allowPty
        ? this.adapters.find(a => a.name === 'pty-injection')
        : null;
      if (ptyAdapter) {
        // Room-scoped participants only — no global fallback
        const terminals: any[] = (queries.getRoutableMembers(message.sessionId) as any[])
          .filter((m: any) => m.type === 'terminal' && m.session_id !== message.senderId);

        if (terminals.length > 0) {
          const getId = (t: any) => t.session_id;
          const getHandle = (t: any) => handlesForMember(t)[0] ?? null;
          const getCliFlag = (t: any) => t.cli_flag || null;

          const knownHandles = [...new Set(terminals.flatMap(handlesForMember))];
          const {
            targets,
            isAllParticipants,
            shouldFanOutToTerminals,
            protectWorkingTerminals,
          } = resolveRoomFanout(
            message.content,
            knownHandles,
            message.senderType,
          );
          if (!shouldFanOutToTerminals) {
            return { messageId: message.id, deliveries };
          }

          const candidateTerminals = isAllParticipants
            ? terminals.filter((t: any) => !memberHasAnyHandle(t, excludedHandles))
            : terminals.filter((t: any) => memberHasAnyHandle(t, targets) && !memberHasAnyHandle(t, excludedHandles));

          const terminalsToSend = protectWorkingTerminals
            ? []
            : candidateTerminals;

          if (protectWorkingTerminals) {
            for (const terminal of candidateTerminals) {
              if (!(await isTerminalWorking(getId(terminal)))) {
                terminalsToSend.push(terminal);
              }
            }
          }

          const isEveryoneBypass = hasEveryoneMention(message.content);
          for (const terminal of terminalsToSend) {
            const matchingTarget = isAllParticipants
              ? getHandle(terminal)
              : handlesForMember(terminal).find(handle => targets.includes(handle)) ?? getHandle(terminal);
            const focusTarget = isAllParticipants ? null : matchingTarget;
            const attentionDecision = await this.focusedDeliveryDecision(message, terminal, focusTarget, isEveryoneBypass);
            if (attentionDecision === 'queued') {
              const result = { adapter: 'focus-queue', targetId: getId(terminal), delivered: true };
              deliveries.push(result);
              this.logDelivery(message.id, result);
              continue;
            }
            const target: RouteTarget = {
              sessionId: getId(terminal),
              handle: matchingTarget,
              type: 'terminal',
              cliFlag: getCliFlag(terminal),
            };
            const routedMessage = isAllParticipants ? message : { ...message, target: matchingTarget };

            // a. Deliver to the terminal's PTY
            if (ptyAdapter.canDeliver(routedMessage, target)) {
              const result = await ptyAdapter.deliver(routedMessage, target);
              deliveries.push(result);
              this.logDelivery(message.id, result);
            }

            // b. Cross-post to the terminal's linked chat (if any),
            //    but never echo back to the originating chatroom
            const termSession: any = queries.getSession(getId(terminal));
            if (termSession?.linked_chat_id && termSession.linked_chat_id !== message.sessionId) {
              const wsAdapter = this.adapters.find(a => a.name === 'ws-broadcast');
              if (wsAdapter) {
                const chatTarget: RouteTarget = {
                  sessionId: termSession.linked_chat_id,
                  handle: null,
                  type: 'chat',
                };
                if (wsAdapter.canDeliver(routedMessage, chatTarget)) {
                  const result = await wsAdapter.deliver(routedMessage, chatTarget);
                  deliveries.push(result);
                  this.logDelivery(message.id, result);
                }
              }
            }
          }
        }
      }
    }

    return { messageId: message.id, deliveries };
  }

  private logDelivery(messageId: string, result: DeliveryResult): void {
    try {
      queries.logDelivery(
        messageId,
        result.targetId,
        result.adapter,
        result.delivered ? 1 : 0,
        result.error ?? null
      );
    } catch (e) {
      console.error('[message-router] logDelivery failed:', e);
    }
  }
}

// ─── Singleton (globalThis to survive Vite module duplication) ──────────────

const ROUTER_KEY = '__ant_message_router__';

export function getRouter(): MessageRouter {
  const g = globalThis as any;
  if (!g[ROUTER_KEY]) {
    g[ROUTER_KEY] = new MessageRouter();
  }
  return g[ROUTER_KEY];
}

/** Reset the singleton — used by tests or hot-reload scenarios. */
export function resetRouter(): void {
  (globalThis as any)[ROUTER_KEY] = null;
}
