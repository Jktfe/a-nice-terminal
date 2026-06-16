import { describe, expect, it } from 'vitest';
import {
  subscribeToRoom,
  unsubscribeFromRoom,
  broadcastToRoom,
  subscriberCountForRoom,
  subscribeRoomEvents
} from './eventBroadcast';

describe('eventBroadcast', () => {
  it('broadcasts events to subscribers', () => {
    const events: Record<string, unknown>[] = [];
    const controller = {
      enqueue: (data: Uint8Array) => {
        const text = new TextDecoder().decode(data);
        const match = text.match(/data: (.+)/);
        if (match) events.push(JSON.parse(match[1]));
      }
    } as ReadableStreamDefaultController<Uint8Array>;

    subscribeToRoom('room-1', controller);
    broadcastToRoom('room-1', { type: 'test', msg: 'hello' });
    expect(events.length).toBe(1);
    expect(events[0].type).toBe('test');

    unsubscribeFromRoom('room-1', controller);
    broadcastToRoom('room-1', { type: 'test', msg: 'again' });
    expect(events.length).toBe(1); // no new event after unsubscribe
  });

  it('subscriberCountForRoom tracks subscriptions', () => {
    // Partial mock — only `enqueue` is exercised here. TS 6 tightened `as`
    // overlap checks, so cast through `unknown` for the intentional stub.
    const controller = { enqueue: () => {} } as unknown as ReadableStreamDefaultController<Uint8Array>;
    expect(subscriberCountForRoom('room-2')).toBe(0);
    subscribeToRoom('room-2', controller);
    expect(subscriberCountForRoom('room-2')).toBe(1);
    unsubscribeFromRoom('room-2', controller);
    expect(subscriberCountForRoom('room-2')).toBe(0);
  });

  it('ignores broadcasts to rooms with no subscribers', () => {
    // should not throw
    broadcastToRoom('empty-room', { type: 'test' });
    expect(subscriberCountForRoom('empty-room')).toBe(0);
  });

  it('subscribeRoomEvents forwards parsed events and unsubscribes cleanly', () => {
    const events: Record<string, unknown>[] = [];
    const unsubscribe = subscribeRoomEvents('room-3', (event) => {
      events.push(event);
    });
    expect(subscriberCountForRoom('room-3')).toBe(1);
    broadcastToRoom('room-3', { type: 'message_added', message: { id: 'msg_x' } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'message_added', message: { id: 'msg_x' } });
    expect(events[0].seq).toBeTypeOf('number');
    unsubscribe();
    expect(subscriberCountForRoom('room-3')).toBe(0);
    broadcastToRoom('room-3', { type: 'message_added', message: { id: 'msg_y' } });
    expect(events).toHaveLength(1); // no new event after unsubscribe
  });

  // server-hang-investigation-2026-05-24.md root-cause fix:
  // dead-but-not-closed consumers (desiredSize <= 0) leaked unbounded
  // buffer growth. broadcastToRoom now force-closes them and drops
  // from the roomSet so subsequent broadcasts don't keep feeding the
  // leak.
  it('closes + drops a controller whose desiredSize signals a full buffer (backpressure)', () => {
    const closes: number[] = [];
    const enqueues: Uint8Array[] = [];
    const stalledController = {
      enqueue: (data: Uint8Array) => { enqueues.push(data); },
      close: () => { closes.push(1); },
      desiredSize: 0 // buffer at/past high-water mark
    } as unknown as ReadableStreamDefaultController<Uint8Array>;

    subscribeToRoom('room-stalled', stalledController);
    expect(subscriberCountForRoom('room-stalled')).toBe(1);

    broadcastToRoom('room-stalled', { type: 'test' });

    // No enqueue should have fired (buffer was full); controller closed
    // and dropped from the roomSet.
    expect(enqueues).toHaveLength(0);
    expect(closes).toHaveLength(1);
    expect(subscriberCountForRoom('room-stalled')).toBe(0);

    // A second broadcast must NOT touch the closed controller again.
    broadcastToRoom('room-stalled', { type: 'test' });
    expect(closes).toHaveLength(1);
  });

  it('continues delivering to healthy controllers when a sibling is force-closed for backpressure', () => {
    const healthyEvents: Uint8Array[] = [];
    const stalledEnqueues: Uint8Array[] = [];

    const healthyController = {
      enqueue: (data: Uint8Array) => { healthyEvents.push(data); },
      close: () => {},
      desiredSize: 1
    } as unknown as ReadableStreamDefaultController<Uint8Array>;

    const stalledController = {
      enqueue: (data: Uint8Array) => { stalledEnqueues.push(data); },
      close: () => {},
      desiredSize: -1 // past high-water mark
    } as unknown as ReadableStreamDefaultController<Uint8Array>;

    subscribeToRoom('room-mixed', healthyController);
    subscribeToRoom('room-mixed', stalledController);
    broadcastToRoom('room-mixed', { type: 'test' });

    expect(healthyEvents).toHaveLength(1);
    expect(stalledEnqueues).toHaveLength(0);
    expect(subscriberCountForRoom('room-mixed')).toBe(1); // stalled dropped
  });

  it('still drops controllers whose enqueue throws (e.g. CLOSED state)', () => {
    const closedController = {
      enqueue: () => { throw new Error('stream is closed'); },
      close: () => {},
      desiredSize: null // typical for a closed controller
    } as unknown as ReadableStreamDefaultController<Uint8Array>;

    subscribeToRoom('room-closed', closedController);
    broadcastToRoom('room-closed', { type: 'test' });
    expect(subscriberCountForRoom('room-closed')).toBe(0);
  });
});
