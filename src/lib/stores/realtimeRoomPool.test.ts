// Refcounted-pool contract for SSE room subscriptions.
//
// Regression — see RoomCardActivity's pool import: prior implementation
// opened one EventSource per card, blowing past Chrome's HTTP/1.1 cap
// (~6 per origin) when /rooms rendered 8+ cards. The 7th+ socket queued
// and starved SvelteKit's client-navigation fetch, so clicks on room
// cards stalled with no URL change. The pool guarantees one source per
// roomId regardless of subscriber count.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Minimal EventSource stub: we only assert on refcount + delivery here,
// not real SSE behaviour. The pool's contract is "one source per
// roomId, closed on last unsubscribe, replay on late subscribe."
class FakeEventSource {
  static all: FakeEventSource[] = [];
  static reset() { FakeEventSource.all = []; }
  url: string;
  onmessage: ((msg: MessageEvent) => void) | null = null;
  closed = false;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.all.push(this);
  }
  close(): void { this.closed = true; }
  emit(payload: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent);
  }
}

beforeEach(() => {
  FakeEventSource.reset();
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('EventSource', FakeEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function loadPool() {
  // Re-import each test so the module-level pool resets cleanly.
  vi.resetModules();
  return await import('./realtimeRoomPool.svelte');
}

describe('realtimeRoomPool', () => {
  it('opens exactly one EventSource per roomId regardless of subscriber count', async () => {
    const { subscribeToSharedRoomEvents, _poolSnapshot } = await loadPool();
    const handles = [
      subscribeToSharedRoomEvents('room-a'),
      subscribeToSharedRoomEvents('room-a'),
      subscribeToSharedRoomEvents('room-a'),
      subscribeToSharedRoomEvents('room-b')
    ];
    expect(FakeEventSource.all.length).toBe(2); // one per roomId
    expect(_poolSnapshot().refCounts).toEqual({ 'room-a': 3, 'room-b': 1 });
    for (const handle of handles) handle.close();
  });

  it('closes the underlying source only when the last subscriber unsubscribes', async () => {
    const { subscribeToSharedRoomEvents } = await loadPool();
    const h1 = subscribeToSharedRoomEvents('room-x');
    const h2 = subscribeToSharedRoomEvents('room-x');
    const source = FakeEventSource.all[0];
    expect(source.closed).toBe(false);
    h1.close();
    expect(source.closed).toBe(false);
    h2.close();
    expect(source.closed).toBe(true);
  });

  it('fans server events out to every subscriber on the same room', async () => {
    const { subscribeToSharedRoomEvents } = await loadPool();
    const receivedByA: Record<string, unknown>[] = [];
    const receivedByB: Record<string, unknown>[] = [];
    const h1 = subscribeToSharedRoomEvents('room-fan', (event) => receivedByA.push(event));
    const h2 = subscribeToSharedRoomEvents('room-fan', (event) => receivedByB.push(event));
    FakeEventSource.all[0].emit({ type: 'agent_activity', handle: '@x' });
    FakeEventSource.all[0].emit({ type: 'message_added', id: 'm1' });
    expect(receivedByA.length).toBe(2);
    expect(receivedByB.length).toBe(2);
    expect(receivedByA[0].type).toBe('agent_activity');
    h1.close();
    h2.close();
  });

  it('reuses a single source for 8+ subscribers (the rooms-index repro case)', async () => {
    const { subscribeToSharedRoomEvents } = await loadPool();
    const handles = Array.from({ length: 8 }, () => subscribeToSharedRoomEvents('room-busy'));
    expect(FakeEventSource.all.length).toBe(1);
    // Same single source caught the load that would have spawned 8 connections.
    for (const handle of handles) handle.close();
    expect(FakeEventSource.all[0].closed).toBe(true);
  });
});
