/**
 * Tests for the CLI SSE consumer — JWPK Tauri msg_oiu700bmel
 * 2026-05-29. Covers parseSseBlock (the small + pure-function half)
 * and startSseSubscriber's dispatch + reconnect behaviour.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  parseSseBlock,
  startSseSubscriber
} from './ant-cli-realtime-sse.mjs';

describe('parseSseBlock', () => {
  it('parses a standard id + data record', () => {
    const block = 'id: 42\ndata: {"type":"message_added","seq":42}';
    const parsed = parseSseBlock(block);
    expect(parsed).toMatchObject({
      id: '42',
      eventType: 'message',
      data: { type: 'message_added', seq: 42 }
    });
  });

  it('strips exactly one leading space after the colon per spec', () => {
    const block = 'data: {"ok":true}';
    expect(parseSseBlock(block)?.data).toEqual({ ok: true });
    const noSpace = parseSseBlock('data:{"ok":true}');
    expect(noSpace?.data).toEqual({ ok: true });
  });

  it('joins multi-line data with newlines (spec-compliant)', () => {
    const block = 'data: line one\ndata: line two';
    const parsed = parseSseBlock(block);
    // parses as text; not JSON. JSON.parse fails, data=null.
    expect(parsed?.data).toBeNull();
  });

  it('returns null on heartbeat / comment-only blocks', () => {
    expect(parseSseBlock(': heartbeat')).toBeNull();
    expect(parseSseBlock(': connected')).toBeNull();
  });

  it('returns null when no data field is present', () => {
    expect(parseSseBlock('id: 99\nevent: foo')).toBeNull();
  });

  it('returns null on empty / non-string input', () => {
    expect(parseSseBlock('')).toBeNull();
    expect(parseSseBlock(null)).toBeNull();
    expect(parseSseBlock(undefined)).toBeNull();
  });

  it('handles event field for custom event types', () => {
    const block = 'event: typing\ndata: {"who":"@you"}';
    const parsed = parseSseBlock(block);
    expect(parsed?.eventType).toBe('typing');
    expect(parsed?.data).toEqual({ who: '@you' });
  });

  it('reports data:null when JSON parse fails (caller decides to skip)', () => {
    const block = 'data: this is not json{{{';
    const parsed = parseSseBlock(block);
    expect(parsed).not.toBeNull();
    expect(parsed?.data).toBeNull();
  });

  it('parses CRLF-terminated lines (HTTP proxy / spec-allowed)', () => {
    // gemini-code-assist flagged that proxies sometimes rewrite LF to
    // CRLF; we must not let the `\r` end up in the parsed field value.
    const block = 'id: 42\r\ndata: {"x":1}';
    const parsed = parseSseBlock(block);
    expect(parsed).toMatchObject({
      id: '42',
      eventType: 'message',
      data: { x: 1 }
    });
  });
});

describe('startSseSubscriber', () => {
  let controller;
  afterEach(() => {
    if (controller) controller.stop();
    controller = null;
    vi.restoreAllMocks();
  });

  function makeSseBody(blocks) {
    // Glue blocks with the `\n\n` SSE separator; emit as one chunk.
    const text = blocks.map((b) => `${b}\n\n`).join('');
    const bytes = new TextEncoder().encode(text);
    return {
      getReader() {
        let sent = false;
        return {
          async read() {
            if (sent) return { value: undefined, done: true };
            sent = true;
            return { value: bytes, done: false };
          }
        };
      }
    };
  }

  function makeRuntime(fetchImpl) {
    return {
      serverUrl: 'http://localhost:6174',
      fetchImpl,
      config: {}
    };
  }

  it('dispatches each parsed event via onEvent', async () => {
    const events = [];
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: makeSseBody([
        ': connected',
        'id: 1\ndata: {"type":"connected","latest_seq":1}',
        'id: 2\ndata: {"type":"message_added","message":{"id":"m1","body":"hi","authorHandle":"@you"},"seq":2}'
      ])
    }));
    controller = startSseSubscriber({
      runtime: makeRuntime(fetchImpl),
      roomId: 'r_test',
      onEvent: (event) => events.push(event),
      sleepImpl: async () => undefined
    });
    // Give the loop a tick to drain the stub stream.
    await new Promise((resolve) => setTimeout(resolve, 50));
    controller.stop();
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.find((e) => e.data?.type === 'message_added')).toBeDefined();
  });

  it('sends Authorization Bearer when room token is in config', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: makeSseBody(['id: 0\ndata: {"type":"connected"}'])
    }));
    controller = startSseSubscriber({
      runtime: {
        serverUrl: 'http://localhost:6174',
        fetchImpl,
        config: { tokens: { r_test: { token: 'tok_abc' } } }
      },
      roomId: 'r_test',
      onEvent: () => {},
      sleepImpl: async () => undefined
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    controller.stop();
    const callArgs = fetchImpl.mock.calls[0];
    expect(callArgs[1].headers.authorization).toBe('Bearer tok_abc');
    // URL stays bare when bearer is sent (no pidChain query param).
    expect(callArgs[0]).not.toContain('pidChain=');
  });

  it('falls back to pidChain query param when no room token is configured', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: makeSseBody(['id: 0\ndata: {"type":"connected"}'])
    }));
    controller = startSseSubscriber({
      runtime: { serverUrl: 'http://localhost:6174', fetchImpl, config: {} },
      roomId: 'r_test',
      onEvent: () => {},
      sleepImpl: async () => undefined
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    controller.stop();
    const callArgs = fetchImpl.mock.calls[0];
    expect(callArgs[0]).toContain('pidChain=');
    expect(callArgs[1].headers.authorization).toBeUndefined();
  });

  it('sets Last-Event-ID on reconnect after the first id is seen', async () => {
    let connection = 0;
    const fetchImpl = vi.fn(async () => {
      connection += 1;
      if (connection === 1) {
        return {
          ok: true,
          status: 200,
          body: makeSseBody(['id: 99\ndata: {"type":"message_added","message":{"id":"m"}}'])
        };
      }
      return {
        ok: true,
        status: 200,
        body: makeSseBody(['id: 100\ndata: {"type":"connected"}'])
      };
    });
    controller = startSseSubscriber({
      runtime: makeRuntime(fetchImpl),
      roomId: 'r_test',
      onEvent: () => {},
      sleepImpl: async () => undefined
    });
    // Two connections worth of drain + a reconnect sleep tick.
    await new Promise((resolve) => setTimeout(resolve, 80));
    controller.stop();
    expect(fetchImpl.mock.calls.length).toBeGreaterThanOrEqual(2);
    const secondCallHeaders = fetchImpl.mock.calls[1][1].headers;
    expect(secondCallHeaders['last-event-id']).toBe('99');
  });

  it('invokes onError + reconnects when fetch throws', async () => {
    const errors = [];
    let attemptNumber = 0;
    const fetchImpl = vi.fn(async () => {
      attemptNumber += 1;
      if (attemptNumber === 1) throw new Error('connect refused');
      return {
        ok: true,
        status: 200,
        body: makeSseBody(['id: 0\ndata: {"type":"connected"}'])
      };
    });
    controller = startSseSubscriber({
      runtime: makeRuntime(fetchImpl),
      roomId: 'r_test',
      onEvent: () => {},
      onError: (err, attempt) => errors.push({ msg: err.message, attempt }),
      sleepImpl: async () => undefined
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    controller.stop();
    expect(errors[0]).toMatchObject({ msg: 'connect refused', attempt: 1 });
    // Second fetch happened because of reconnect.
    expect(fetchImpl.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('drains a stream with CRLF block delimiters (HTTP proxy / spec-allowed)', async () => {
    // Build a chunk that uses CRLF line endings AND CRLFCRLF block
    // delimiters, matching what some HTTP proxies emit. Both blocks
    // must still dispatch via onEvent.
    const text =
      'id: 1\r\ndata: {"type":"connected","latest_seq":1}\r\n\r\n' +
      'id: 2\r\ndata: {"type":"message_added","message":{"id":"m2"},"seq":2}\r\n\r\n';
    const bytes = new TextEncoder().encode(text);
    const events = [];
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: {
        getReader() {
          let sent = false;
          return {
            async read() {
              if (sent) return { value: undefined, done: true };
              sent = true;
              return { value: bytes, done: false };
            }
          };
        }
      }
    }));
    controller = startSseSubscriber({
      runtime: makeRuntime(fetchImpl),
      roomId: 'r_test',
      onEvent: (event) => events.push(event),
      sleepImpl: async () => undefined
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    controller.stop();
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.find((e) => e.data?.type === 'connected')).toBeDefined();
    expect(events.find((e) => e.data?.type === 'message_added')).toBeDefined();
    // And the id field must not carry a trailing \r.
    expect(events[0].id).toBe('1');
    expect(events[1].id).toBe('2');
  });

  it('stop() halts the loop and aborts any in-flight fetch', async () => {
    let abortSignal;
    const fetchImpl = vi.fn(async (url, init) => {
      abortSignal = init.signal;
      // Never resolves until aborted.
      return new Promise((_, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    });
    controller = startSseSubscriber({
      runtime: makeRuntime(fetchImpl),
      roomId: 'r_test',
      onEvent: () => {},
      sleepImpl: async () => undefined
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.stop();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(abortSignal?.aborted).toBe(true);
  });
});
