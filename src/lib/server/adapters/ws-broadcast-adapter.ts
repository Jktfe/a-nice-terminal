// ANT v3 — WebSocket Broadcast Adapter
//
// Wraps the existing broadcast() singleton from ws-broadcast.ts.
// Delivers messages to all WS clients joined to the message's session,
// with optional target filtering (e.g. @handle → only that client).

import type { DeliveryAdapter, RouteMessage, RouteTarget, DeliveryResult } from '../message-router.js';

export class WsBroadcastAdapter implements DeliveryAdapter {
  name = 'ws-broadcast';

  canDeliver(_message: RouteMessage, _target: RouteTarget): boolean {
    // WS broadcast is always available for any session
    return true;
  }

  async deliver(message: RouteMessage, target: RouteTarget): Promise<DeliveryResult> {
    try {
      const { broadcast } = await import('../ws-broadcast.js');

      const msg = {
        type: 'message_created',
        sessionId: message.sessionId,
        id: message.id,
        session_id: message.sessionId,
        role: message.role,
        content: message.content,
        format: 'text',
        status: 'complete',
        sender_id: message.senderId || null,
        target: message.target || null,
        reply_to: message.replyTo || null,
        msg_type: message.msgType,
      };

      broadcast(message.sessionId, msg, message.target || null);

      return {
        adapter: this.name,
        targetId: target.sessionId,
        delivered: true,
      };
    } catch (e: any) {
      const error = e?.message || String(e);
      console.error(`[ws-broadcast-adapter] deliver failed for session ${message.sessionId}:`, error);
      return {
        adapter: this.name,
        targetId: target.sessionId,
        delivered: false,
        error,
      };
    }
  }
}
