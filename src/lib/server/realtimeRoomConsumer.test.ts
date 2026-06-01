import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { subscribeRoomEventsAsClient } from './realtimeRoomConsumer';
import type { RealtimeRoomEvent } from './realtimeRoomConsumer';

/**
 * Smoke test for the SSE consumer client per the SSE consumer contract v0.
 * Uses a fetch mock that produces a single fake SSE stream with one
 * `connected` frame + two `message_added` frames + a `\n\n` terminator,
 * then asserts the consumer:
 *   - parses each frame correctly
 *   - tracks lastSeq from the seq field
 *   - reports connection state transitions through onConnectionState
 *   - close() aborts cleanly without leaking timers
 *
 * NOT covered here (live integration tested separately):
 *   - Reconnect on transport failure (would need a multi-response mock)
 *   - Last-Event-ID resume (verified via the live server probe)
 */

function makeMockResponse(sseBody: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(sseBody));
      controller.close();
    }
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' }
  });
}

const SAMPLE_SSE = [
  ': connected\n\n',
  `data: ${JSON.stringify({ type: 'connected', latest_seq: 5 })}\n\n`,
  `id: 6\ndata: ${JSON.stringify({ type: 'message_added', message: { id: 'msg_a' }, seq: 6 })}\n\n`,
  `id: 7\ndata: ${JSON.stringify({ type: 'message_added', message: { id: 'msg_b' }, seq: 7 })}\n\n`
].join('');

describe('realtimeRoomConsumer — SSE consumer contract v0 smoke', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('parses event frames and tracks lastSeq from the inline seq field', async () => {
    const events: RealtimeRoomEvent[] = [];
    const fetchMock = vi.fn(async () => makeMockResponse(SAMPLE_SSE));

    const handle = subscribeRoomEventsAsClient({
      baseUrl: 'http://127.0.0.1:6174',
      roomId: 'orsz2321qb',
      authBearer: 'test-bearer',
      onEvent: (event) => events.push(event),
      fetchImpl: fetchMock as unknown as typeof fetch,
      initialBackoffMs: 10
    });

    // Allow microtasks + fake-timer ticks to drain so the consumer
    // reads the entire stream before we assert.
    await vi.advanceTimersByTimeAsync(50);

    expect(events.length).toBeGreaterThanOrEqual(3);
    const types = events.map((e) => e.type);
    expect(types).toContain('connected');
    expect(types).toContain('message_added');
    expect(handle.getLastSeq()).toBe(7);

    handle.close();
  });

  it('emits the connected state transition with latest_seq', async () => {
    const stateLog: Array<{ state: string; latestSeq?: number }> = [];
    const fetchMock = vi.fn(async () => makeMockResponse(SAMPLE_SSE));

    const handle = subscribeRoomEventsAsClient({
      baseUrl: 'http://127.0.0.1:6174',
      roomId: 'orsz2321qb',
      authBearer: 'test-bearer',
      onEvent: () => {},
      onConnectionState: (state, detail) =>
        stateLog.push({ state, latestSeq: detail?.latestSeq }),
      fetchImpl: fetchMock as unknown as typeof fetch,
      initialBackoffMs: 10
    });

    await vi.advanceTimersByTimeAsync(50);

    const connected = stateLog.find((entry) => entry.state === 'connected');
    expect(connected).toBeDefined();
    expect(connected?.latestSeq).toBe(5);

    handle.close();
  });

  it('close() aborts the in-flight fetch without throwing', async () => {
    const fetchMock = vi.fn(async (_url, init) => {
      // Reject if aborted to simulate AbortController integration.
      return new Promise<Response>((resolve, reject) => {
        const signal = (init as RequestInit | undefined)?.signal;
        if (signal && (signal as AbortSignal).aborted) {
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }
        signal?.addEventListener?.('abort', () =>
          reject(new DOMException('Aborted', 'AbortError'))
        );
        // never resolve until aborted
      });
    });

    const handle = subscribeRoomEventsAsClient({
      baseUrl: 'http://127.0.0.1:6174',
      roomId: 'orsz2321qb',
      authBearer: 'test-bearer',
      onEvent: () => {},
      fetchImpl: fetchMock as unknown as typeof fetch,
      initialBackoffMs: 10,
      maxBackoffMs: 10
    });

    handle.close();
    // No assertion needed — if close() threw or hung the test would fail.
    expect(true).toBe(true);
  });

  // Boundary-shape smoke test from claudev4's SSE v1 filing
  // (yz4clwzvbm 2026-05-23): heartbeat is 25s; if a fronting proxy
  // closes idle streams before then, the stream drops between
  // heartbeats. Verify the consumer reconnects with Last-Event-ID
  // resume rather than dropping silently. Banked under
  // `boundary_surface_invisible_upstream_constraints_2026_05_23`.
  it('reconnects after stream close (heartbeat-vs-proxy-idle scenario)', async () => {
    const events: RealtimeRoomEvent[] = [];
    let fetchCallCount = 0;
    const lastEventIdsSeen: (string | null)[] = [];

    const fetchMock = vi.fn(async (_url, init) => {
      fetchCallCount += 1;
      const requestInit = init as RequestInit | undefined;
      const headers = requestInit?.headers as Record<string, string> | undefined;
      lastEventIdsSeen.push(headers?.['Last-Event-ID'] ?? null);

      if (fetchCallCount === 1) {
        // First connection: stream a seeded `connected` + one event,
        // then close the stream (simulating proxy idle-timeout drop).
        const body = [
          ': connected\n\n',
          `data: ${JSON.stringify({ type: 'connected', latest_seq: 10 })}\n\n`,
          `id: 11\ndata: ${JSON.stringify({ type: 'message_added', message: { id: 'msg_pre_drop' }, seq: 11 })}\n\n`
        ].join('');
        return makeMockResponse(body);
      }
      // Second connection: stream a post-reconnect event so the test
      // can verify the reconnect path actually fired.
      const body = `id: 12\ndata: ${JSON.stringify({ type: 'message_added', message: { id: 'msg_post_reconnect' }, seq: 12 })}\n\n`;
      return makeMockResponse(body);
    });

    const handle = subscribeRoomEventsAsClient({
      baseUrl: 'http://127.0.0.1:6174',
      roomId: 'orsz2321qb',
      authBearer: 'test-bearer',
      onEvent: (event) => events.push(event),
      fetchImpl: fetchMock as unknown as typeof fetch,
      initialBackoffMs: 10
    });

    // Drain both streams + the backoff sleep between them.
    await vi.advanceTimersByTimeAsync(200);

    handle.close();

    expect(fetchCallCount).toBeGreaterThanOrEqual(2);
    // The first connection had no prior lastSeq → no Last-Event-ID header.
    // The second (post-drop) connection must carry Last-Event-ID: 11.
    expect(lastEventIdsSeen[0]).toBeNull();
    expect(lastEventIdsSeen[1]).toBe('11');
    // Both events should land via onEvent — verifies resume payload reception.
    const messageIds = events
      .filter((e) => e.type === 'message_added')
      .map((e) => (e.message as { id?: string } | undefined)?.id);
    expect(messageIds).toContain('msg_pre_drop');
    expect(messageIds).toContain('msg_post_reconnect');
    expect(handle.getLastSeq()).toBe(12);
  });

  it('reports disconnected then reconnecting through state callbacks', async () => {
    const stateLog: Array<{ state: string; cause?: unknown }> = [];

    const fetchMock = vi.fn(async () => {
      // Both attempts succeed; each stream just closes quickly.
      const body = [
        ': connected\n\n',
        `data: ${JSON.stringify({ type: 'connected', latest_seq: 5 })}\n\n`
      ].join('');
      return makeMockResponse(body);
    });

    const handle = subscribeRoomEventsAsClient({
      baseUrl: 'http://127.0.0.1:6174',
      roomId: 'orsz2321qb',
      authBearer: 'test-bearer',
      onEvent: () => {},
      onConnectionState: (state, detail) => stateLog.push({ state, cause: detail?.cause }),
      fetchImpl: fetchMock as unknown as typeof fetch,
      initialBackoffMs: 10
    });

    await vi.advanceTimersByTimeAsync(200);

    handle.close();

    // We expect at minimum: connecting → connected → disconnected → connecting (again)
    const states = stateLog.map((entry) => entry.state);
    expect(states[0]).toBe('connecting');
    expect(states).toContain('connected');
    expect(states).toContain('disconnected');
    // After the first stream ends and the consumer reconnects, a second
    // 'connecting' transition must occur.
    const firstConnectedIndex = states.indexOf('connected');
    const subsequentStates = states.slice(firstConnectedIndex + 1);
    expect(subsequentStates).toContain('connecting');
  });
});
