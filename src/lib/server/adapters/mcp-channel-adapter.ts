// ANT v3 — MCP Channel Adapter
//
// Wraps HTTP POST to an MCP channel server. Looks up the port from
// channel_registry via queries.getChannelPort(handle) and POSTs the
// message to localhost:{port}.

import type { DeliveryAdapter, RouteMessage, RouteTarget, DeliveryResult } from '../message-router.js';
import { queries } from '../db.js';

export class McpChannelAdapter implements DeliveryAdapter {
  name = 'mcp-channel';

  // Fallback ports for known handles — survives ANT server restarts
  // when the channel process registered before the server came up
  private static FALLBACK_PORTS: Record<string, number> = {
    '@claude': 8789,
  };

  canDeliver(_message: RouteMessage, target: RouteTarget): boolean {
    if (!target.handle) return false;
    const channel = queries.getChannelPort(target.handle);
    return !!channel || target.handle in McpChannelAdapter.FALLBACK_PORTS;
  }

  async deliver(message: RouteMessage, target: RouteTarget): Promise<DeliveryResult> {
    const targetId = target.handle || target.sessionId;

    try {
      const channel = queries.getChannelPort(target.handle!);
      const port = channel?.port ?? McpChannelAdapter.FALLBACK_PORTS[target.handle!];
      if (!port) {
        return {
          adapter: this.name,
          targetId,
          delivered: false,
          error: `No channel registered for handle ${target.handle}`,
        };
      }

      const url = `http://localhost:${port}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: message.id,
          sessionId: message.sessionId,
          content: message.content,
          role: message.role,
          senderId: message.senderId,
          senderName: message.senderName,
          target: message.target,
          msgType: message.msgType,
        }),
      });

      if (!response.ok) {
        const error = `HTTP ${response.status}: ${await response.text().catch(() => 'unknown')}`;
        console.error(`[mcp-channel-adapter] deliver failed for ${targetId}:`, error);
        return {
          adapter: this.name,
          targetId,
          delivered: false,
          error,
        };
      }

      return {
        adapter: this.name,
        targetId,
        delivered: true,
      };
    } catch (e: any) {
      const error = e?.message || String(e);
      console.error(`[mcp-channel-adapter] deliver failed for ${targetId}:`, error);
      return {
        adapter: this.name,
        targetId,
        delivered: false,
        error,
      };
    }
  }
}
