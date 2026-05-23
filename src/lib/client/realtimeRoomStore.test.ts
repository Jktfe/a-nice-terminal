import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRealtimeRoomStore, type RealtimeRoomEvent } from './realtimeRoomStore';

/**
 * Minimal EventSource stub. The store uses onopen / onmessage / onerror
 * + close(); we mock those interactions and capture them.
 */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static reset() { FakeEventSource.instances = []; }

  url: string;
  onopen: ((this: EventSource, ev: Event) => unknown) | null = null;
  onmessage: ((this: EventSource, ev: MessageEvent) => unknown) | null = null;
  onerror: ((this: EventSource, ev: Event) => unknown) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  close() { this.closed = true; }

  // Test helpers
  emitOpen() { this.onopen?.call(this as unknown as EventSource, new Event('open')); }
  emitMessage(payload: RealtimeRoomEvent) {
    this.onmessage?.call(
      this as unknown as EventSource,
      new MessageEvent('message', { data: JSON.stringify(payload) })
    );
  }
  emitError() { this.onerror?.call(this as unknown as EventSource, new Event('error')); }
}

beforeEach(() => {
  FakeEventSource.reset();
  vi.useFakeTimers();
  // queueMicrotask runs synchronously after the current task in node;
  // vi.useFakeTimers controls setTimeout/setInterval only — microtasks
  // still flush. The store schedules its first openConnection via
  // queueMicrotask, so we need to flush before testing.
});

afterEach(() => {
  vi.useRealTimers();
});

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('createRealtimeRoomStore', () => {
  it('starts in connecting state and transitions to connected on EventSource.onopen', async () => {
    const store = createRealtimeRoomStore({
      roomId: 'r1',
      eventSourceCtor: FakeEventSource as unknown as typeof EventSource
    });
    await flushMicrotasks();
    expect(store.value.state).toBe('connecting');
    expect(FakeEventSource.instances.length).toBe(1);

    FakeEventSource.instances[0].emitOpen();
    expect(store.value.state).toBe('connected');
    store.close();
  });

  it('seeds lastSeq from the synthetic connected frame so initial UX skips catching-up flicker', async () => {
    const store = createRealtimeRoomStore({
      roomId: 'r1',
      eventSourceCtor: FakeEventSource as unknown as typeof EventSource
    });
    await flushMicrotasks();
    const es = FakeEventSource.instances[0];
    es.emitOpen();
    es.emitMessage({ type: 'connected', latest_seq: 42 });
    // lastSeq == latestSeq → caught-up, not catching-up
    expect(store.value.lastSeq).toBe(42);
    expect(store.value.latestSeq).toBe(42);
    expect(store.value.state).toBe('caught-up');
    store.close();
  });

  it('catches up when reconnecting with a known lastSeq below latest', async () => {
    const store = createRealtimeRoomStore({
      roomId: 'r1',
      eventSourceCtor: FakeEventSource as unknown as typeof EventSource
    });
    await flushMicrotasks();
    const es = FakeEventSource.instances[0];
    es.emitOpen();
    // Initial caught-up at seq 10
    es.emitMessage({ type: 'connected', latest_seq: 10 });
    expect(store.value.state).toBe('caught-up');

    // A live event during the session
    es.emitMessage({ type: 'message_added', seq: 11, message: { id: 'm1' } });
    expect(store.value.lastSeq).toBe(11);
    expect(store.value.latestSeq).toBe(11);
    expect(store.value.state).toBe('caught-up');

    store.close();
  });

  it('moves to disconnected + schedules backoff retry on EventSource.onerror', async () => {
    const store = createRealtimeRoomStore({
      roomId: 'r1',
      initialBackoffMs: 1000,
      eventSourceCtor: FakeEventSource as unknown as typeof EventSource
    });
    await flushMicrotasks();
    FakeEventSource.instances[0].emitOpen();
    FakeEventSource.instances[0].emitError();
    expect(store.value.state).toBe('disconnected');
    expect(store.value.retryInMs).not.toBeNull();
    expect(FakeEventSource.instances[0].closed).toBe(true);

    // Advance through the backoff — should spawn a new EventSource
    vi.advanceTimersByTime(1100);
    expect(FakeEventSource.instances.length).toBe(2);
    store.close();
  });

  it('escalates to unreachable after the configured timeout', async () => {
    const store = createRealtimeRoomStore({
      roomId: 'r1',
      initialBackoffMs: 1000,
      unreachableAfterMs: 5000,
      eventSourceCtor: FakeEventSource as unknown as typeof EventSource
    });
    await flushMicrotasks();
    FakeEventSource.instances[0].emitOpen(); // brief connect
    FakeEventSource.instances[0].emitError(); // fail
    // Advance past the unreachable threshold while staying in retry loop.
    vi.advanceTimersByTime(6000);
    // Trigger another error after the threshold
    FakeEventSource.instances[1]?.emitError();
    expect(store.value.state).toBe('unreachable');
    store.close();
  });

  it('close() prevents further reconnects and zeroes the state to idle', async () => {
    const store = createRealtimeRoomStore({
      roomId: 'r1',
      eventSourceCtor: FakeEventSource as unknown as typeof EventSource
    });
    await flushMicrotasks();
    FakeEventSource.instances[0].emitOpen();
    store.close();
    expect(store.value.state).toBe('idle');
    expect(FakeEventSource.instances[0].closed).toBe(true);
    // Subsequent errors do nothing
    vi.advanceTimersByTime(10000);
    expect(FakeEventSource.instances.length).toBe(1);
  });
});
