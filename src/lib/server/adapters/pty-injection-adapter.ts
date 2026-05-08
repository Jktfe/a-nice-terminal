// ANT v3 — PTY Injection Adapter
//
// Uses the SAME ptm.write() path as the WS terminal_input handler in server.ts.
// This is exposed on globalThis.__antPtmWrite by server.ts after the PTY daemon connects.
// Falls back to ptyClient.write() if globalThis isn't set yet.

import type { DeliveryAdapter, RouteMessage, RouteTarget, DeliveryResult } from '../message-router.js';
import { queries } from '../db.js';
import { capturePromptInput } from '../prompt-capture.js';
import { loadMessagesForAgentContext } from '../chat-context.js';

function ptmWrite(sessionId: string, data: string): void {
  const write = (globalThis as any).__antPtmWrite;
  if (write) {
    write(sessionId, data);
  } else {
    // Fallback to ptyClient (auto-connects to daemon)
    import('../pty-client.js').then(m => m.ptyClient.write(sessionId, data)).catch(() => {});
  }
}

function sanitizeInline(value: string, max = 2000): string {
  return value
    .slice(0, max)
    .replace(/[\n\r]+/g, ' ')
    .replace(/['"`()$;\\|&<>{}[\]!#~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function roomContextSnippet(roomId: string, currentMessageId: string, maxMessages = 6): string {
  try {
    const messages = loadMessagesForAgentContext(roomId, { limit: maxMessages + 1 })
      .filter((m) => m.id !== currentMessageId)
      .slice(-maxMessages);
    if (messages.length === 0) return 'none';
    return messages.map((m) => {
      const speaker = m.sender_id || (m.role === 'user' ? 'user' : m.role || 'unknown');
      return `${sanitizeInline(speaker, 80)}: ${sanitizeInline(m.content, 160)}`;
    }).join(' | ');
  } catch {
    return 'unavailable';
  }
}

function markTerminalRead(message: RouteMessage, target: RouteTarget): void {
  try {
    queries.markRead(message.id, target.sessionId);
    const reads = queries.getReadsForMessage(message.id);
    import('../ws-broadcast.js').then(({ broadcast }) => {
      broadcast(message.sessionId, {
        type: 'message_read',
        sessionId: message.sessionId,
        messageId: message.id,
        readerId: target.sessionId,
        reads,
      });
    }).catch(() => {});
  } catch {}
}

export class PtyInjectionAdapter implements DeliveryAdapter {
  name = 'pty-injection';

  canDeliver(_message: RouteMessage, target: RouteTarget): boolean {
    return target.type === 'terminal';
  }

  async deliver(message: RouteMessage, target: RouteTarget): Promise<DeliveryResult> {
    try {
      // Two formats depending on whether this is targeted or broadcast:
      // Targeted (@mention): [antchat message for you] 'message' [reply instructions]
      // Broadcast (all):     [antchat message for all participants] 'message' [reply instructions]
      const isTargeted = message.target && message.target !== '@everyone' && target.handle && message.target === target.handle;
      const header = isTargeted ? 'antchat message for you' : 'antchat message for all participants';
      const replyCmd = `ant chat send ${message.sessionId} --msg YOURREPLY`;
      const room = queries.getSession(message.sessionId) as any;
      const roomName = sanitizeInline(room?.name || 'unknown room', 120);
      const roomId = sanitizeInline(message.sessionId, 80);
      const sourceLabel = `${roomName || 'unknown room'} id ${roomId}`;
      // Sanitise message content: strip characters that shells interpret as syntax
      // (quotes, parens, backticks, $, semicolons) to prevent Gemini/other CLIs from choking
      const safeContent = sanitizeInline(message.content);
      const boundedContext = roomContextSnippet(message.sessionId, message.id);

      // Parent-context snippet for replies — gives terminal agents thread context
      let replyContext = '';
      if (message.replyTo) {
        try {
          const parent = queries.getMessage(message.replyTo) as any;
          if (parent?.content) {
            const snippet = sanitizeInline(parent.content, 120);
            const sender = parent.sender_id?.startsWith('@') ? parent.sender_id : (parent.role === 'user' ? 'James' : 'someone');
            replyContext = ` (replying to ${sender}: ${snippet})`;
          }
        } catch {}
      }

      const routingHint = 'Routing: plain replies post to the room and notify idle agents only; include @handle to interrupt one agent; use @everyone to interrupt all.';
      const plainText = `[${header}] room: ${sourceLabel} -- bounded room context: ${boundedContext} -- ${safeContent}${replyContext} -- reply with: ${replyCmd} -- ${routingHint}`;

      // Two-call protocol: text first, then \r after a beat.
      // Claude Code requires a second \r (empty line) to submit the prompt —
      // a single \r just adds a continuation line (quote> mode).
      const needsDoubleReturn = target.cliFlag === 'claude-code';
      const submitDelay = needsDoubleReturn ? 200 : 150;

      ptmWrite(target.sessionId, plainText);
      capturePromptInput(target.sessionId, plainText, {
        captureSource: 'chat_injection',
        transport: this.name,
        messageId: message.id,
        roomId: message.sessionId,
        target: message.target,
      });
      setTimeout(() => {
        ptmWrite(target.sessionId, '\r');
        if (needsDoubleReturn) {
          setTimeout(() => { ptmWrite(target.sessionId, '\r'); }, 150);
        }
      }, submitDelay);
      markTerminalRead(message, target);

      return {
        adapter: this.name,
        targetId: target.sessionId,
        delivered: true,
      };
    } catch (e: any) {
      const error = e?.message || String(e);
      console.error(`[pty-injection-adapter] deliver failed for terminal ${target.sessionId}:`, error);
      return {
        adapter: this.name,
        targetId: target.sessionId,
        delivered: false,
        error,
      };
    }
  }
}
