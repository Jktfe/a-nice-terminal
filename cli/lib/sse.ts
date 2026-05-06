// Server-Sent Events subscriber for /mcp/room/:id/stream.
//
// Extracted from cli/commands/chat.ts so antchat can consume the same loop
// without duplicating the dedup-on-id logic. The host's broadcast loop fans
// the same message_created event out via two paths (primary delivery +
// message-router), so each id arrives twice on the SSE stream — onEvent
// callers MUST tolerate or rely on this loop's dedup.

const SEEN_CAP = 1024;

export interface RoomStreamEvent {
  // Parsed JSON payload from a `data:` SSE frame, or `null` for event-only
  // frames (e.g. `event: closed` with no body). Common shapes:
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
 *  - Accepts self-signed TLS on both Bun (`tls.rejectUnauthorized`) and
 *    Node.js (`undici` Agent dispatcher), mirroring cli/lib/api.ts so the
 *    helper works in either runtime without `NODE_TLS_REJECT_UNAUTHORIZED=0`.
 *  - Dedups duplicate `message_created` ids on a bounded LRU.
 *  - Surfaces event-only frames (e.g. `event: closed`) so callers can react
 *    to revocation without waiting for a `data:` payload.
 *  - Does NOT auto-reconnect. Reconnection policy is the caller's choice;
 *    the proxy uses exponential backoff, the chat join loop just exits.
 *
 * SSE parsing follows https://html.spec.whatwg.org/multipage/server-sent-events.html:
 *  - Frame separator is a blank line (\n\n or \r\n\r\n).
 *  - Lines may be \n or \r\n terminated.
 *  - The space after the field's colon is optional.
 *  - Lines starting with ":" are comments (heartbeats); skip silently.
 */
export function subscribeRoomStream(opts: SubscribeOptions): AbortController {
  const abort = new AbortController();
  const seen = new Set<string>();
  const seenOrder: string[] = [];

  const url = `${opts.serverUrl}/mcp/room/${encodeURIComponent(opts.roomId)}/stream?token=${encodeURIComponent(opts.token)}`;

  (async () => {
    try {
      // `RequestInit` doesn't type Bun's `tls` or undici's `dispatcher`,
      // hence `any`. Same approach as cli/lib/api.ts:request().
      const fetchOptions: any = {
        headers: { Accept: 'text/event-stream' },
        signal: abort.signal,
        // Bun honours this for self-signed local TLS; Node ignores it.
        tls: { rejectUnauthorized: false },
      };
      // Node.js fetch (undici) needs a dispatcher with the same setting.
      if (opts.serverUrl.startsWith('https://') && typeof (globalThis as any).Bun === 'undefined') {
        try {
          // @ts-ignore — undici types may not be installed in all environments.
          const { Agent } = await import('undici');
          fetchOptions.dispatcher = new Agent({ connect: { rejectUnauthorized: false } });
        } catch {
          // undici not available — rely on NODE_TLS_REJECT_UNAUTHORIZED=0
          // or a real cert chain.
        }
      }

      const res = await fetch(url, fetchOptions);
      if (!res.ok || !res.body) {
        opts.onError?.(new Error(`Stream failed: HTTP ${res.status}`));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      // Find the next frame boundary, accepting either CRLF or LF blank
      // lines. Returns -1 if no full frame is buffered yet, otherwise the
      // index *after* the boundary in `buf`.
      const findFrameEnd = (s: string): number => {
        const a = s.indexOf('\n\n');
        const b = s.indexOf('\r\n\r\n');
        if (a < 0 && b < 0) return -1;
        if (a < 0) return b + 4;
        if (b < 0) return a + 2;
        return (a < b ? a + 2 : b + 4);
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        let end: number;
        while ((end = findFrameEnd(buf)) > 0) {
          // Slice off the frame including its trailing blank line.
          const boundaryLen = buf.slice(end - 4, end) === '\r\n\r\n' ? 4 : 2;
          const frame = buf.slice(0, end - boundaryLen);
          buf = buf.slice(end);

          let eventName: string | null = null;
          const dataLines: string[] = [];
          for (const line of frame.split(/\r?\n/)) {
            if (!line || line.startsWith(':')) continue; // comment / heartbeat
            const colonIdx = line.indexOf(':');
            if (colonIdx <= 0) continue;
            const field = line.slice(0, colonIdx);
            let val = line.slice(colonIdx + 1);
            if (val.startsWith(' ')) val = val.slice(1);
            if (field === 'event') eventName = val.trim() || null;
            else if (field === 'data') dataLines.push(val);
          }

          // Drop frames that carry neither a body nor an event name (i.e.
          // truly empty); but surface event-only frames like `event: closed`
          // so revocation/teardown signals reach the caller.
          if (dataLines.length === 0 && !eventName) continue;

          let data: unknown = null;
          if (dataLines.length > 0) {
            try { data = JSON.parse(dataLines.join('\n')); }
            catch { continue; }

            // Dedup message_created by id (broadcast double-delivers).
            const obj = data as { type?: unknown; id?: unknown };
            if (obj && obj.type === 'message_created' && typeof obj.id === 'string') {
              if (seen.has(obj.id)) continue;
              seen.add(obj.id);
              seenOrder.push(obj.id);
              if (seenOrder.length > SEEN_CAP) {
                const drop = seenOrder.shift();
                if (drop) seen.delete(drop);
              }
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
