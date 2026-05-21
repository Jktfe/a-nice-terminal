import { describe, expect, it } from 'vitest';
import { countDirectRepliesByParent } from './countDirectRepliesByParent';
import type { ChatMessage, ChatMessageKind } from '$lib/server/chatMessageStore';

function makeMessage(input: {
  id: string;
  postOrder: number;
  kind?: ChatMessageKind;
  parentMessageId?: string;
}): ChatMessage {
  return {
    id: input.id,
    roomId: 'room1',
    authorHandle: '@a',
    authorDisplayName: 'A',
    kind: input.kind ?? 'human',
    body: 'body',
    postedAt: `2026-05-12T00:00:0${input.postOrder}Z`,
    postOrder: input.postOrder,
    ...(input.parentMessageId !== undefined && { parentMessageId: input.parentMessageId })
  };
}

describe('countDirectRepliesByParent', () => {
  it('returns empty Map when no message has a parent', () => {
    const messages = [
      makeMessage({ id: 'a', postOrder: 1 }),
      makeMessage({ id: 'b', postOrder: 2 }),
      makeMessage({ id: 'c', postOrder: 3 })
    ];
    const counts = countDirectRepliesByParent(messages);
    expect(counts.size).toBe(0);
  });

  it('counts multiple direct replies under the same parent', () => {
    const messages = [
      makeMessage({ id: 'root', postOrder: 1 }),
      makeMessage({ id: 'r1', postOrder: 2, parentMessageId: 'root' }),
      makeMessage({ id: 'r2', postOrder: 3, parentMessageId: 'root' })
    ];
    const counts = countDirectRepliesByParent(messages);
    expect(counts.get('root')).toBe(2);
    expect(counts.size).toBe(1);
  });

  it('counts nested chain X→Y→Z as direct-only X→1, Y→1', () => {
    const messages = [
      makeMessage({ id: 'X', postOrder: 1 }),
      makeMessage({ id: 'Y', postOrder: 2, parentMessageId: 'X' }),
      makeMessage({ id: 'Z', postOrder: 3, parentMessageId: 'Y' })
    ];
    const counts = countDirectRepliesByParent(messages);
    expect(counts.get('X')).toBe(1);
    expect(counts.get('Y')).toBe(1);
    expect(counts.size).toBe(2);
  });

  it('records orphan parent ids even when the parent is absent from the list', () => {
    const messages = [
      makeMessage({ id: 'a', postOrder: 1 }),
      makeMessage({ id: 'orphan', postOrder: 2, parentMessageId: 'missing-id' })
    ];
    const counts = countDirectRepliesByParent(messages);
    expect(counts.get('missing-id')).toBe(1);
    // Consumer using `counts.get(message.id) ?? 0` on the 2 visible rows
    // never reads the orphan key, so no visible badge is produced.
  });

  it('system + system-break rows never increment counts', () => {
    const messages = [
      makeMessage({ id: 'A', postOrder: 1 }),
      makeMessage({ id: 'joined', postOrder: 2, kind: 'system' }),
      makeMessage({ id: 'B', postOrder: 3 }),
      makeMessage({ id: 'brk', postOrder: 4, kind: 'system-break' }),
      makeMessage({ id: 'replyA', postOrder: 5, parentMessageId: 'A' })
    ];
    const counts = countDirectRepliesByParent(messages);
    expect(counts.get('A')).toBe(1);
    expect(counts.size).toBe(1);
    expect(counts.get('joined')).toBeUndefined();
    expect(counts.get('brk')).toBeUndefined();
  });
});
