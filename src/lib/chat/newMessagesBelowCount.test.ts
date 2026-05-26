import { describe, expect, it } from 'vitest';
import { countMessagesBelow } from './newMessagesBelowCount';

const list = (...ids: string[]) => ids.map((id) => ({ id }));

describe('countMessagesBelow', () => {
  it('N1: returns 0 when shouldFollowBottom is true (viewer at bottom)', () => {
    expect(countMessagesBelow(list('a', 'b', 'c'), 'a', true)).toBe(0);
  });

  it('N2: returns 0 when no snapshot id has been captured yet', () => {
    expect(countMessagesBelow(list('a', 'b', 'c'), null, false)).toBe(0);
  });

  it('N3: returns 0 on empty message list', () => {
    expect(countMessagesBelow([], 'a', false)).toBe(0);
  });

  it('N4: counts messages after the snapshot id', () => {
    // Snapshot was 'a'. Three messages after it.
    expect(countMessagesBelow(list('a', 'b', 'c', 'd'), 'a', false)).toBe(3);
  });

  it('N5: returns 0 when snapshot id is the last message (nothing new yet)', () => {
    expect(countMessagesBelow(list('a', 'b', 'c'), 'c', false)).toBe(0);
  });

  it('N6: returns 0 when the snapshot id is not in the list (paged out / refreshed)', () => {
    // Better to under-report than scare the user with a wild number.
    expect(countMessagesBelow(list('x', 'y', 'z'), 'a', false)).toBe(0);
  });

  it('N7: counts correctly when snapshot is mid-list', () => {
    expect(countMessagesBelow(list('a', 'b', 'c', 'd', 'e'), 'b', false)).toBe(3);
  });

  it('N8: shouldFollowBottom=true overrides everything else (even if snapshot is stale)', () => {
    // When at bottom, the count should always be 0 regardless of
    // snapshot state — the snapshot is about to re-capture anyway.
    expect(countMessagesBelow(list('a', 'b', 'c'), 'a', true)).toBe(0);
    expect(countMessagesBelow([], null, true)).toBe(0);
  });
});
