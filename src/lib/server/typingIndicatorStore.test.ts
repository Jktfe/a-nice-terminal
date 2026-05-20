import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  listActiveTypersInRoom,
  recordTypingHeartbeat,
  resetTypingIndicatorStoreForTests
} from './typingIndicatorStore';

function freezeDateNowAt(epochMilliseconds: number) {
  return vi.spyOn(Date, 'now').mockReturnValue(epochMilliseconds);
}

describe('typingIndicatorStore', () => {
  beforeEach(() => {
    resetTypingIndicatorStoreForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('recordTypingHeartbeat then listActiveTypersInRoom returns the typer', () => {
    recordTypingHeartbeat({ roomId: 'r1', memberHandle: '@you' });
    const typers = listActiveTypersInRoom('r1');
    expect(typers).toHaveLength(1);
    expect(typers[0].memberHandle).toBe('@you');
  });

  it('listActiveTypersInRoom returns an empty array when the room has had no heartbeat', () => {
    expect(listActiveTypersInRoom('unknown-room')).toEqual([]);
  });

  it('two members typing at once both show up, sorted by handle', () => {
    recordTypingHeartbeat({ roomId: 'r1', memberHandle: '@second' });
    recordTypingHeartbeat({ roomId: 'r1', memberHandle: '@first' });
    const typers = listActiveTypersInRoom('r1');
    expect(typers.map((t) => t.memberHandle)).toEqual(['@first', '@second']);
  });

  it('a typer that has not heartbeat in the last 5 seconds is dropped', () => {
    const dateNowSpy = freezeDateNowAt(1_000_000);
    recordTypingHeartbeat({ roomId: 'r1', memberHandle: '@you' });

    dateNowSpy.mockReturnValue(1_000_000 + 10 * 1000); // 10 seconds later
    expect(listActiveTypersInRoom('r1')).toEqual([]);
  });

  it('recordTypingHeartbeat refuses a blank handle', () => {
    expect(() =>
      recordTypingHeartbeat({ roomId: 'r1', memberHandle: '   ' })
    ).toThrow();
  });

  it('recording two heartbeats from the same member only keeps the latest', () => {
    const dateNowSpy = freezeDateNowAt(2_000_000);
    recordTypingHeartbeat({ roomId: 'r1', memberHandle: '@you' });

    dateNowSpy.mockReturnValue(2_000_000 + 2 * 1000); // 2 seconds later
    recordTypingHeartbeat({ roomId: 'r1', memberHandle: '@you' });

    const typers = listActiveTypersInRoom('r1');
    expect(typers).toHaveLength(1);
    expect(typers[0].lastTypedAtMillisecondsAgo).toBeLessThan(1000);
  });

  it('rooms are isolated — a heartbeat in r1 does not show in r2', () => {
    recordTypingHeartbeat({ roomId: 'r1', memberHandle: '@you' });
    expect(listActiveTypersInRoom('r2')).toEqual([]);
  });
});
