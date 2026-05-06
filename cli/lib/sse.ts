// Server-Sent Events subscriber for /mcp/room/:id/stream.
//
// Extracted from cli/commands/chat.ts so antchat can consume the same loop
// without duplicating the dedup-on-id logic. The host's broadcast loop fans
// the same message_created event out via two paths (primary delivery +
// message-router), so each id arrives twice on the SSE stream — onMessage
// callers MUST tolerate or rely on this loop's dedup.

const SEEN_CAP = 1024;

export interface RoomStreamEvent {
  // Parsed JSON payload from a `data:` SSE frame. Common shapes:
  //   { type: 'message_created', sessionId, id, role, content, sender_id, target, ... }
  //   { type: 'task_created'|'task_updated', sessionId, task: {...} }
  //   { reason: 'revoked' }     (only when frame had `event: closed`)
  data: unknown;
  // Non-empty when the frame had an `event:` line. Useful for `closed` etc.
  event: string | null;
}

export interface SubscribeOptions {
  serverUrl: string;
  roomId: string;
  // Per-room bearer token. SSE requires one (the master apiKey is not
  // accepted on /mcp/room/:id/stream).
  token: string;
  onEvent: (ev: RoomStreamEvent) => void;
  // Optional: invoked once per low-level error so callers can log.
  onError?: (err: unknown) => void;
}

/**
 * Open a long-lived SSE connection to /mcp/room/:id/stream and dispatch each
 * event to onEvent. Returns an AbortController; abort() to disconnect.
 *
 * Behaviour:
 *  - Accepts self-signed TLS (mirrors cli/lib/api.ts).
 *  - Dedups duplicate `message_created` ids on a bounded LRU.
 *  - Emits a synthesised `{event:'closed', data:{reason:'revoked'}}` when the
 *    server explicitly hangs up the stream with that reason — callers can
 *    use that signal to exit cleanly without reconnecting.
 *  - Does NOT auto-reconnect. Reconnection policy is the caller's choice;
 *    the proxy uses exponential backoff, the chat join loop just exits.
 */
export function subscribeRoomStream(opts: SubscribeOptions): AbortController {
  const abort = new AbortController();
  const seen = new Set<string>();
  const seenOrder: string[] = [];

  const url = `${opts.serverUrl}/mcp/room/${encodeURIComponent(opts.roomId)}/stream?token=${encodeURIComponent(opts.token)}`;

  (async () => {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'text/event-stream' },
        signal: abort.signal,
        // @ts-ignore — bun + node both honour this for self-signed local TLS.
        tls: { rejectUnauthorized: false },
      });
      if (!res.ok || !res.body) {
        opts.onError?.(new Error(`Stream failed: HTTP ${res.status}`));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        // SSE frames are separated by a blank line; each frame is one or
        // more `field: value` lines. We surface `event:` (if any) and
        // concatenated `data:` lines.
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);

          let eventName: string | null = null;
          const dataLines: string[] = [];
          for (const line of frame.split('\n')) {
            if (line.startsWith('event: ')) eventName = line.slice(7).trim() || null;
            else if (line.startsWith('data: ')) dataLines.push(line.slice(6));
          }
          if (dataLines.length === 0) continue;

          let data: unknown;
          try { data = JSON.parse(dataLines.join('\n')); }
          catch { continue; }

          // Dedup message_created by id (broadcast double-delivers).
          const obj = data as { type?: string; id?: string };
          if (obj?.type === 'message_created' && typeof obj.id === 'string') {
            if (seen.has(obj.id)) continue;
            seen.add(obj.id);
            seenOrder.push(obj.id);
            if (seenOrder.length > SEEN_CAP) {
              const drop = seenOrder.shift();
              if (drop) seen.delete(drop);
            }
          }

          opts.onEvent({ data, event: eventName });
        }
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') opts.onError?.(err);
    }
  })();

  return abort;
}
