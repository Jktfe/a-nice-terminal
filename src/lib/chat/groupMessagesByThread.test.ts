import { describe, expect, it } from 'vitest';
import { groupMessagesByThread } from './groupMessagesByThread';
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

describe('groupMessagesByThread', () => {
  it('preserves chronological order when no message has a parent', () => {
    const messages = [
      makeMessage({ id: 'a', postOrder: 1 }),
      makeMessage({ id: 'b', postOrder: 2 }),
      makeMessage({ id: 'c', postOrder: 3 })
    ];
    const grouped = groupMessagesByThread(messages);
    expect(grouped.map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('places direct children immediately after their parent in postOrder', () => {
    const messages = [
      makeMessage({ id: 'root', postOrder: 1 }),
      makeMessage({ id: 'childA', postOrder: 2, parentMessageId: 'root' }),
      makeMessage({ id: 'childB', postOrder: 3, parentMessageId: 'root' })
    ];
    const grouped = groupMessagesByThread(messages);
    expect(grouped.map((m) => m.id)).toEqual(['root', 'childA', 'childB']);
  });

  it('places nested replies under their DIRECT parent (no depth flattening)', () => {
    const messages = [
      makeMessage({ id: 'X', postOrder: 1 }),
      makeMessage({ id: 'Y', postOrder: 2, parentMessageId: 'X' }),
      makeMessage({ id: 'Z', postOrder: 3, parentMessageId: 'Y' })
    ];
    const grouped = groupMessagesByThread(messages);
    expect(grouped.map((m) => m.id)).toEqual(['X', 'Y', 'Z']);
  });

  it('keeps an orphan reply (parent missing) at its original chronological slot', () => {
    const messages = [
      makeMessage({ id: 'a', postOrder: 1 }),
      makeMessage({ id: 'b', postOrder: 2 }),
      makeMessage({ id: 'orphan', postOrder: 3, parentMessageId: 'missing' }),
      makeMessage({ id: 'c', postOrder: 4 })
    ];
    const grouped = groupMessagesByThread(messages);
    expect(grouped.map((m) => m.id)).toEqual(['a', 'b', 'orphan', 'c']);
  });

  it('never drops or duplicates: output is a permutation of input', () => {
    const messages = [
      makeMessage({ id: 'rootA', postOrder: 1 }),
      makeMessage({ id: 'rootB', postOrder: 2 }),
      makeMessage({ id: 'replyA', postOrder: 3, parentMessageId: 'rootA' }),
      makeMessage({ id: 'rootC', postOrder: 4 }),
      makeMessage({ id: 'replyB', postOrder: 5, parentMessageId: 'rootB' })
    ];
    const grouped = groupMessagesByThread(messages);
    expect(grouped).toHaveLength(messages.length);
    expect([...grouped].sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      [...messages].sort((a, b) => a.id.localeCompare(b.id))
    );
    expect(grouped.map((m) => m.id)).toEqual([
      'rootA',
      'replyA',
      'rootB',
      'replyB',
      'rootC'
    ]);
  });

  it('keeps system + system-break rows AND replies blocked by them in chronological slots', () => {
    const messages = [
      makeMessage({ id: 'A', postOrder: 1 }),
      makeMessage({ id: 'joined', postOrder: 2, kind: 'system' }),
      makeMessage({ id: 'B', postOrder: 3 }),
      makeMessage({ id: 'brk', postOrder: 4, kind: 'system-break' }),
      makeMessage({ id: 'replyA', postOrder: 5, parentMessageId: 'A' })
    ];
    const grouped = groupMessagesByThread(messages);
    // System rows act as chronological barriers: replyA cannot cross
    // `joined` (system) or `brk` (system-break) to sit under A, so it
    // stays at its original chronological slot at position 5.
    expect(grouped.map((m) => m.id)).toEqual(['A', 'joined', 'B', 'brk', 'replyA']);
  });

  it('still groups a reply under its parent when no system row sits between them', () => {
    const messages = [
      makeMessage({ id: 'A', postOrder: 1 }),
      makeMessage({ id: 'replyA', postOrder: 2, parentMessageId: 'A' }),
      makeMessage({ id: 'joined', postOrder: 3, kind: 'system' }),
      makeMessage({ id: 'B', postOrder: 4 })
    ];
    const grouped = groupMessagesByThread(messages);
    // No barrier between A and replyA (replyA comes immediately after);
    // grouping still happens. system row sits to its right untouched.
    expect(grouped.map((m) => m.id)).toEqual(['A', 'replyA', 'joined', 'B']);
  });
});
