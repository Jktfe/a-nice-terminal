// ANT v3 — Message Router with Pluggable Adapters
//
// Centralises all message fan-out logic that was previously inline in the
// POST /api/sessions/:id/messages handler. Each delivery mechanism is an
// adapter that implements DeliveryAdapter.
//
// Uses globalThis singleton to survive Vite module duplication (same pattern
// as ws-broadcast.ts).

import { queries } from './db.js';

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
  msgType: string;
}

export interface RouteTarget {
  sessionId: string;
  handle: string | null;
  type: string;  // 'terminal' | 'chat'
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

// ─── System message types that must NOT fan out ─────────────────────────────

const SYSTEM_MSG_TYPES = new Set([
  'prompt', 'silence', 'title', 'agent_response', 'agent_event', 'terminal_line',
]);

// ─── MessageRouter ──────────────────────────────────────────────────────────

export class MessageRouter {
  private adapters: DeliveryAdapter[] = [];

  register(adapter: DeliveryAdapter): void {
    this.adapters.push(adapter);
  }

  get adapterCount(): number { return this.adapters.length; }

  /**
   * Route a message to its targets via registered adapters.
   *
   * Centralised loop-prevention rules:
   *   - sender is agent (senderType === 'terminal') → skip group fan-out
   *     (agents respond to their own chat, not to other terminals)
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

    // ── 4. Targeted @handle → inject into that terminal's PTY ──────────
    if (message.target && message.target !== '@everyone') {
      const ptyAdapter = this.adapters.find(a => a.name === 'pty-injection');
      const mcpAdapter = this.adapters.find(a => a.name === 'mcp-channel');

      // Room-scoped alias lookup first, then fall back to global handle
      const roomMember: any = queries.getMemberByAlias(message.sessionId, message.target);
      const targetSession: any = roomMember
        ? queries.getSession(roomMember.session_id)
        : queries.getSessionByHandle(message.target);

      // Try PTY injection for terminal sessions
      if (ptyAdapter && targetSession?.type === 'terminal') {
        // Loop prevention: don't deliver back to sender
        if (targetSession.id !== message.senderId) {
          const target: RouteTarget = {
            sessionId: targetSession.id,
            handle: message.target,
            type: 'terminal',
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

    // ── 5. Group fan-out to linked terminals ───────────────────────────
    //    Skip if sender is an agent terminal (loop prevention)
    if (message.senderType === 'terminal') {
      return { messageId: message.id, deliveries };
    }

    // Identify bracket-escaped mentions to exclude them from ALL delivery
    const bracketedMentions = [...(message.content.match(/\[@[\w.-]+\]/g) || [])];
    const excludedHandles = bracketedMentions.map(m => m.slice(2, -1));

    // ── 5a. Linked chat fan-out (terminal ↔ its chat) ──────────────────
    const linkedChatAdapter = this.adapters.find(a => a.name === 'linked-chat');
    if (linkedChatAdapter) {
      const linkedTerminals: any[] = queries.getTerminalsByLinkedChat(message.sessionId);
      for (const terminal of linkedTerminals) {
        if (terminal.id === message.senderId) continue;
        if (terminal.handle && excludedHandles.includes(terminal.handle)) continue;

        const target: RouteTarget = {
          sessionId: terminal.id,
          handle: terminal.handle || null,
          type: 'terminal',
        };
        if (linkedChatAdapter.canDeliver(message, target)) {
          const result = await linkedChatAdapter.deliver(message, target);
          deliveries.push(result);
          this.logDelivery(message.id, result);
        }
      }
    }

    // ── 5b. Group chat fan-out (non-linked chat → room participants) ──
    //    Uses chat_room_members for scoped delivery. Room member aliases
    //    take precedence over global handles for @mention resolution.
    //    Fallback: if no room members, use global terminal list (transition).
    const linkedTerminals: any[] = queries.getTerminalsByLinkedChat(message.sessionId);
    if (linkedTerminals.length === 0) {
      const ptyAdapter = this.adapters.find(a => a.name === 'pty-injection');
      if (ptyAdapter) {
        // Primary: use room membership
        let terminals: any[] = (queries.getRoutableMembers(message.sessionId) as any[])
          .filter((m: any) => m.type === 'terminal' && m.session_id !== message.senderId);

        // Accessor: room members have session_id + alias, global list has id + handle
        let getId = (t: any) => t.session_id;
        let getHandle = (t: any) => t.alias || t.handle;

        // Fallback: if no room members registered yet, use global terminal list
        if (terminals.length === 0) {
          terminals = (queries.listSessions() as any[]).filter(
            (s: any) => s.handle && s.type === 'terminal' && s.id !== message.senderId
          );
          getId = (t: any) => t.id;
          getHandle = (t: any) => t.handle;
        }

        const knownHandles = terminals.map(getHandle).filter(Boolean) as string[];
        const { targets, isAllParticipants } = parseMentions(message.content, knownHandles);

        const terminalsToSend = isAllParticipants
          ? terminals.filter((t: any) => !excludedHandles.includes(getHandle(t)))
          : terminals.filter((t: any) => targets.includes(getHandle(t)) && !excludedHandles.includes(getHandle(t)));

        for (const terminal of terminalsToSend) {
          const target: RouteTarget = {
            sessionId: getId(terminal),
            handle: getHandle(terminal),
            type: 'terminal',
          };
          const routedMessage = isAllParticipants ? message : { ...message, target: getHandle(terminal) };
          if (ptyAdapter.canDeliver(routedMessage, target)) {
            const result = await ptyAdapter.deliver(routedMessage, target);
            deliveries.push(result);
            this.logDelivery(message.id, result);
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
