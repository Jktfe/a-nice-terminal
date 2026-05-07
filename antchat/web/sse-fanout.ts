// SSE fan-out: ONE upstream subscribeRoomStream per (roomId, handle), feeding
// N browser EventSources. Multiple browser tabs cost zero extra upstream
// connections.
//
// Lazy-init: a Bridge is created on first browser subscriber for a given
// (roomId, handle); subsequent subscribers join the existing fan-out. When
// the last browser disconnects we keep the bridge alive — the next click
// (e.g. user switches tabs) reuses it without paying the upstream-connect
// cost. closeAllBridges aborts everything on server shutdown.
//
// Frame format on the local channel matches the upstream SSE wire format
// (event: + data:), so the browser EventSource can consume directly. We
// re-encode `data` to JSON because subscribeRoomStream parses it back.

import { subscribeRoomStream } from '../../cli/lib/sse.js';
import { resolveRoom } from './proxy-routes.js';
import { logEvent } from './log.js';

interface Bridge {
  abort: AbortController;
  writers: Set<(payload: Uint8Array) => void>;
  /** True after closeAllBridges; new subscribers must build a fresh bridge. */
  closing: boolean;
}

const bridges = new Map<string, Bridge>();
const encoder = new TextEncoder();

function bridgeKey(roomId: string, handle: string | null): string {
  return `${roomId}|${handle ?? ''}`;
}

function ensureBridge(roomId: string, handle: string | null): Bridge | null {
  const key = bridgeKey(roomId, handle);
  const existing = bridges.get(key);
  if (existing && !existing.closing) return existing;

  const resolved = resolveRoom(roomId, handle);
  if (!resolved) return null;

  const writers = new Set<(payload: Uint8Array) => void>();
  const abort = subscribeRoomStream({
    serverUrl: resolved.serverUrl,
    roomId,
    token: resolved.token,
    onEvent: ({ event, data }) => {
      const eventLine = event ? `event: ${event}\n` : '';
      const dataPayload = typeof data === 'string' ? data : JSON.stringify(data);
      const frame = encoder.encode(`${eventLine}data: ${dataPayload}\n\n`);
      for (const write of writers) {
        try { write(frame); }
        catch { /* writer is dead; will be cleaned up on its own cancel callback */ }
      }
    },
    onError: (err: any) => {
      logEvent('sse_upstream_error', {
        roomId,
        handle,
        msg: err?.message || String(err),
      });
    },
  });

  const bridge: Bridge = { abort, writers, closing: false };
  bridges.set(key, bridge);
  logEvent('sse_bridge_open', { roomId, handle });
  return bridge;
}

export async function handleStream(req: Request, roomId: string): Promise<Response> {
  const url = new URL(req.url);
  const handleParam = url.searchParams.get('as');
  const bridge = ensureBridge(roomId, handleParam);
  if (!bridge) {
    return new Response(JSON.stringify({ error: 'unknown_room', detail: roomId }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  let writer: ((payload: Uint8Array) => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      writer = (payload: Uint8Array) => {
        try { controller.enqueue(payload); }
        catch { /* downstream cancelled; bridge.writers cleanup happens in cancel() */ }
      };
      bridge.writers.add(writer);
      // Initial comment so EventSource fires `open` immediately.
      controller.enqueue(encoder.encode(`: hello\n\n`));
      // 25-second comment heartbeat to keep proxies / browsers from idling out.
      heartbeat = setInterval(() => {
        try { controller.enqueue(encoder.encode(`: ka\n\n`)); }
        catch { /* stream closed; cancel() will clean up */ }
      }, 25_000);
    },
    cancel() {
      if (writer) bridge.writers.delete(writer);
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'connection': 'keep-alive',
      // Don't let any browser treat the chunked stream as something else.
      'x-content-type-options': 'nosniff',
    },
  });
}

export async function closeAllBridges(): Promise<void> {
  for (const bridge of bridges.values()) {
    bridge.closing = true;
    try { bridge.abort.abort(); }
    catch { /* already aborted */ }
  }
  bridges.clear();
}

/** Test hook: how many active bridges are open. */
export function bridgeCount(): number {
  return bridges.size;
}
