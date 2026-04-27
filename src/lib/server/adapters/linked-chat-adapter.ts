import type { DeliveryAdapter, RouteMessage, RouteTarget, DeliveryResult } from '../message-router.js';

function ptmWrite(sessionId: string, data: string): void {
  const write = (globalThis as any).__antPtmWrite;
  if (write) {
    write(sessionId, data);
  } else {
    import('../pty-client.js').then(m => m.ptyClient.write(sessionId, data)).catch(() => {});
  }
}

async function markTerminalRead(message: RouteMessage, target: RouteTarget): Promise<void> {
  try {
    const { queries } = await import('../db.js');
    queries.markRead(message.id, target.sessionId);
    const reads = queries.getReadsForMessage(message.id);
    const { broadcast } = await import('../ws-broadcast.js');
    broadcast(message.sessionId, {
      type: 'message_read',
      sessionId: message.sessionId,
      messageId: message.id,
      readerId: target.sessionId,
      reads,
    });
  } catch {}
}

// ANT v3 — Linked Chat Adapter
//
// Handles fan-out from a chat session to its linked terminal sessions.
// Two modes per terminal, controlled by auto_forward_chat:
//
//   auto_forward_chat = 1 (default) + role === 'user' + sender_id set →
//     raw keystrokes (content + \r). Lets the user answer interactive
//     prompts like "Ok to proceed? (y)" directly from the linked chat.
//
//   auto_forward_chat = 0, or role !== 'user' →
//     ANSI notification block. Right for AI-to-AI broadcasts in
//     multi-agent rooms where we don't want text executed as input.
//
// For agent_response messages, routes the response through the agent
// event bus back to the terminal.

function parseMeta(meta: string | null | undefined): Record<string, unknown> {
  try {
    return JSON.parse(meta || '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function isTerminalDirectMessage(message: Pick<RouteMessage, 'meta'>): boolean {
  return parseMeta(message.meta).source === 'terminal_direct';
}

export function shouldRawForwardLinkedChatMessage(
  message: Pick<RouteMessage, 'role' | 'meta'>,
  autoForward: boolean,
): boolean {
  return message.role === 'user' && autoForward && !isTerminalDirectMessage(message);
}

export class LinkedChatAdapter implements DeliveryAdapter {
  name = 'linked-chat';

  canDeliver(message: RouteMessage, target: RouteTarget): boolean {
    return target.type === 'terminal';
  }

  async deliver(message: RouteMessage, target: RouteTarget): Promise<DeliveryResult> {
    try {
      // ── agent_response: route through the agent event bus ────────────
      if (message.msgType === 'agent_response') {
        return await this.deliverAgentResponse(message, target);
      }

      // ── Normal message fan-out ──────────────────────────────────────
      return await this.deliverFanOut(message, target);
    } catch (e: any) {
      const error = e?.message || String(e);
      console.error(`[linked-chat-adapter] deliver failed for terminal ${target.sessionId}:`, error);
      return {
        adapter: this.name,
        targetId: target.sessionId,
        delivered: false,
        error,
      };
    }
  }

  private async deliverAgentResponse(message: RouteMessage, target: RouteTarget): Promise<DeliveryResult> {
    try {
      const { handleResponse } = await import('../agent-event-bus.js');
      const payload = JSON.parse(message.content);
      // AgentEventCard sends { type, event_content, choice } — merge type
      // into choice to form a valid UserChoice for the driver
      const userChoice = { type: payload.type, ...payload.choice };
      const meta = parseMeta(message.meta);
      await handleResponse(target.sessionId, payload.event_content, userChoice, payload.event_id ?? null, {
        responseMsgId: message.id,
        responderId: message.senderId,
        responderName: message.senderName,
        justification: payload.justification ?? payload.reason ?? null,
        source: String(payload.source ?? meta.source ?? 'linked_chat'),
      });

      return {
        adapter: this.name,
        targetId: target.sessionId,
        delivered: true,
      };
    } catch (e: any) {
      const error = e?.message || String(e);
      console.error(`[linked-chat-adapter] agent_response failed for ${target.sessionId}:`, error);
      return {
        adapter: this.name,
        targetId: target.sessionId,
        delivered: false,
        error,
      };
    }
  }

  private async deliverFanOut(message: RouteMessage, target: RouteTarget): Promise<DeliveryResult> {

    // Resolve auto_forward_chat from the target session
    const { queries } = await import('../db.js');
    const terminalSession: any = queries.getSession(target.sessionId);
    const autoForward = terminalSession?.auto_forward_chat !== 0;

    // Terminal-page sends already wrote to the PTY over WS. Linked-chat page
    // sends have no sender_id too, but still need adapter injection.
    const alreadySentToTerminal = isTerminalDirectMessage(message);
    const rawMode = shouldRawForwardLinkedChatMessage(message, autoForward);

    if (rawMode) {
      // Two-call protocol: text first, then \r 150ms later
      ptmWrite(target.sessionId, message.content.trimEnd());
      setTimeout(() => { ptmWrite(target.sessionId, '\r'); }, 150);
    } else if (alreadySentToTerminal) {
      // Terminal page already sent via WS, skip adapter injection.
      return {
        adapter: this.name,
        targetId: target.sessionId,
        delivered: true, // intentionally skipped, not an error
      };
    } else {
      // ANSI notification block
      const notification =
        `\r\n\x1b[36m\u250c\u2500 ANT broadcast \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\x1b[0m\r\n` +
        `\x1b[36m\u2502\x1b[0m From: \x1b[33m${message.senderName}\x1b[0m\r\n` +
        `\x1b[36m\u2502\x1b[0m ${message.content.slice(0, 200).replace(/['"`()$;\\|&<>{}[\]!#~]/g, '')}\r\n` +
        `\x1b[36m\u2502\x1b[0m Reply: \x1b[90mant msg ${message.sessionId} YOURREPLY\x1b[0m\r\n` +
        `\x1b[36m\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\x1b[0m\r\n`;
      ptmWrite(target.sessionId, notification);
    }
    await markTerminalRead(message, target);

    return {
      adapter: this.name,
      targetId: target.sessionId,
      delivered: true,
    };
  }
}
