// ANT v3 — PTY Injection Adapter
//
// Uses the SAME ptm.write() path as the WS terminal_input handler in server.ts.
// This is exposed on globalThis.__antPtmWrite by server.ts after the PTY daemon connects.
// Falls back to ptyClient.write() if globalThis isn't set yet.

import type { DeliveryAdapter, RouteMessage, RouteTarget, DeliveryResult } from '../message-router.js';
import { queries } from '../db.js';

function ptmWrite(sessionId: string, data: string): void {
  const write = (globalThis as any).__antPtmWrite;
  if (write) {
    write(sessionId, data);
  } else {
    // Fallback to ptyClient (auto-connects to daemon)
    import('../pty-client.js').then(m => m.ptyClient.write(sessionId, data)).catch(() => {});
  }
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
      const serverUrl = process.env.ANT_SERVER_URL || `https://localhost:${process.env.ANT_PORT || '6458'}`;
      const replyCmd = `ant chat send ${message.sessionId} --msg YOURREPLY --server ${serverUrl}`;
      // Sanitise message content: strip characters that shells interpret as syntax
      // (quotes, parens, backticks, $, semicolons) to prevent Gemini/other CLIs from choking
      const safeContent = message.content.slice(0, 2000).replace(/['"`()$;\\|&<>{}[\]!#~]/g, '');

      // Parent-context snippet for replies — gives terminal agents thread context
      let replyContext = '';
      if (message.replyTo) {
        try {
          const parent = queries.getMessage(message.replyTo) as any;
          if (parent?.content) {
            const snippet = parent.content.slice(0, 120).replace(/['"`()$;\\|&<>{}[\]!#~\n\r]/g, '').trim();
            const sender = parent.sender_id?.startsWith('@') ? parent.sender_id : (parent.role === 'user' ? 'James' : 'someone');
            replyContext = ` (replying to ${sender}: ${snippet})`;
          }
        } catch {}
      }

      const routingHint = 'Routing: plain replies stay in the chat only; include @handle to notify one agent; use @everyone to notify all.';
      const plainText = `[${header}] ${safeContent}${replyContext} -- reply with: ${replyCmd} -- ${routingHint}`;

      // Two-call protocol: text first, then \r after a beat.
      // Claude Code requires a second \r (empty line) to submit the prompt —
      // a single \r just adds a continuation line (quote> mode).
      const needsDoubleReturn = target.cliFlag === 'claude-code';
      const submitDelay = needsDoubleReturn ? 200 : 150;

      ptmWrite(target.sessionId, plainText);
      setTimeout(() => {
        ptmWrite(target.sessionId, '\r');
        if (needsDoubleReturn) {
          setTimeout(() => { ptmWrite(target.sessionId, '\r'); }, 150);
        }
      }, submitDelay);

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
