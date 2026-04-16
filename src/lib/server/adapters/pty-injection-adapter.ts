// ANT v3 — PTY Injection Adapter
//
// Uses the SAME ptm.write() path as the WS terminal_input handler in server.ts.
// This is exposed on globalThis.__antPtmWrite by server.ts after the PTY daemon connects.
// Falls back to ptyClient.write() if globalThis isn't set yet.

import type { DeliveryAdapter, RouteMessage, RouteTarget, DeliveryResult } from '../message-router.js';

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
      const replyCmd = `ant chat send ${message.sessionId} --msg "your reply" --server ${serverUrl}`;
      const plainText = `[${header}] '${message.content.slice(0, 300)}' (reply with: ${replyCmd})`;

      // Two-call protocol: text first, then \r 150ms later
      ptmWrite(target.sessionId, plainText);
      setTimeout(() => { ptmWrite(target.sessionId, '\r'); }, 150);

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
