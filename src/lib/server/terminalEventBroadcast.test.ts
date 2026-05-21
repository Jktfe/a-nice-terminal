import { afterEach, describe, expect, it } from 'vitest';
import {
  broadcastTerminalEvent,
  subscribeTerminalEvents
} from './terminalEventBroadcast';

// Reset global state between tests
afterEach(() => {
  const g = globalThis as unknown as { __antTerminalEventBroadcast?: { subscribers: Set<unknown> } };
  if (g.__antTerminalEventBroadcast) {
    g.__antTerminalEventBroadcast.subscribers.clear();
  }
});

describe('terminalEventBroadcast', () => {
  it('broadcasts events to subscribers', () => {
    const received: Array<{ sessionId: string; event: unknown }> = [];
    const unsub = subscribeTerminalEvents((sessionId, event) => {
      received.push({ sessionId, event });
    });

    broadcastTerminalEvent('sess-1', { kind: 'message', text: 'hello', trust: 'medium', ts_ms: 1, source: 'test' });
    expect(received.length).toBe(1);
    expect(received[0].sessionId).toBe('sess-1');
    expect((received[0].event as { text: string }).text).toBe('hello');

    unsub();
  });

  it('delivers to multiple subscribers', () => {
    const a: unknown[] = [];
    const b: unknown[] = [];
    const unsub1 = subscribeTerminalEvents((_, e) => a.push(e));
    const unsub2 = subscribeTerminalEvents((_, e) => b.push(e));

    broadcastTerminalEvent('s', { kind: 'raw', text: 'x', trust: 'raw', ts_ms: 1, source: 't' });
    expect(a.length).toBe(1);
    expect(b.length).toBe(1);

    unsub1();
    unsub2();
  });

  it('unsubscribe removes listener', () => {
    const received: unknown[] = [];
    const unsub = subscribeTerminalEvents((_, e) => received.push(e));

    broadcastTerminalEvent('s', { kind: 'message', text: 'before', trust: 'medium', ts_ms: 1, source: 't' });
    expect(received.length).toBe(1);

    unsub();
    broadcastTerminalEvent('s', { kind: 'message', text: 'after', trust: 'medium', ts_ms: 2, source: 't' });
    expect(received.length).toBe(1);
  });

  it('survives a throwing subscriber', () => {
    const received: unknown[] = [];
    const unsub1 = subscribeTerminalEvents(() => {
      throw new Error('boom');
    });
    const unsub2 = subscribeTerminalEvents((_, e) => received.push(e));

    broadcastTerminalEvent('s', { kind: 'message', text: 'safe', trust: 'medium', ts_ms: 1, source: 't' });
    expect(received.length).toBe(1);

    unsub1();
    unsub2();
  });

  it('ignores broadcasts with no subscribers', () => {
    // should not throw
    broadcastTerminalEvent('s', { kind: 'message', text: 'lonely', trust: 'medium', ts_ms: 1, source: 't' });
  });
});
