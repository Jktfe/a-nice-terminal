import { describe, expect, it } from 'vitest';
import {
  subscribeToRoom,
  unsubscribeFromRoom,
  broadcastToRoom,
  subscriberCountForRoom
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
    const controller = { enqueue: () => {} } as ReadableStreamDefaultController<Uint8Array>;
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
});
