import { beforeEach, describe, expect, it, vi } from 'vitest';

class FakeEventSource {
  static CLOSED = 2;
  static all: FakeEventSource[] = [];

  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(public readonly url: string) {
    FakeEventSource.all.push(this);
  }

  close() {
    this.closed = true;
    this.readyState = FakeEventSource.CLOSED;
  }

  emitErrorClosed() {
    this.readyState = FakeEventSource.CLOSED;
    this.onerror?.();
  }
}

async function loadRealtimeRoom() {
  vi.resetModules();
  return await import('./realtimeRoom.svelte');
}

beforeEach(() => {
  FakeEventSource.all = [];
  vi.stubGlobal('window', {});
  vi.stubGlobal('document', {
    addEventListener: vi.fn(),
    visibilityState: 'visible'
  });
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.useFakeTimers();
});

describe('realtimeRoom', () => {
  it('notifies subscribers when the EventSource closes so callers can remint auth', async () => {
    const { subscribeToRoomEvents } = await loadRealtimeRoom();
    const onDisconnect = vi.fn();

    const handle = subscribeToRoomEvents('room-auth-refresh', { onDisconnect });
    FakeEventSource.all[0].emitErrorClosed();

    expect(onDisconnect).toHaveBeenCalledTimes(1);
    handle.close();
  });
});
