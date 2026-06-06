import { describe, expect, it } from 'vitest';
import { summariseBlock } from './blockDigest';
import type { ChatMessage } from './chatMessageStore';

function msg(partial: Partial<ChatMessage> & { id: string; body: string }): ChatMessage {
  return {
    roomId: 'r1',
    authorHandle: '@x',
    authorDisplayName: '@x',
    kind: 'human',
    postedAt: '2026-06-05T00:00:00.000Z',
    parentMessageId: null,
    discussion_id: undefined,
    deletedAtMs: null,
    ...partial
  } as ChatMessage;
}

describe('summariseBlock', () => {
  it('skips system, break and deleted messages (visible-content filter)', () => {
    const digest = summariseBlock({
      messages: [
        msg({ id: 'm1', body: 'real one', authorHandle: '@a' }),
        msg({ id: 'm2', body: 'a break', kind: 'system-break' }),
        msg({ id: 'm3', body: 'gone', deletedAtMs: 123 }),
        msg({ id: 'm4', body: 'system note', kind: 'system' })
      ]
    });
    expect(digest.consideredCount).toBe(1); // only m1 is content
    expect(digest.text).toContain('real one');
    expect(digest.text).not.toContain('gone');
    expect(digest.text).not.toContain('system note');
  });

  it('ranks reacted-to messages first but renders chronologically', () => {
    const reactions = new Map([['m3', 5]]); // the 3rd message is the most-reacted
    const digest = summariseBlock({
      messages: [
        msg({ id: 'm1', body: 'first', authorHandle: '@a' }),
        msg({ id: 'm2', body: 'second', authorHandle: '@b' }),
        msg({ id: 'm3', body: 'hot take', authorHandle: '@c' })
      ],
      reactionCountByMessageId: reactions,
      maxItems: 2
    });
    expect(digest.quotedCount).toBe(2);
    // m3 (5 reactions) + m2 (most recent of the unreacted) are selected; m1 dropped.
    expect(digest.text).toContain('hot take');
    expect(digest.text).toContain('5⭐');
    expect(digest.text).toContain('second');
    expect(digest.text).not.toContain('@a: first'); // m1 (unreacted, oldest) dropped
    // chronological render: 'second' (m2) appears before 'hot take' (m3).
    expect(digest.text.indexOf('second')).toBeLessThan(digest.text.indexOf('hot take'));
  });

  it('caps quoted items and reports the remainder', () => {
    const messages = Array.from({ length: 12 }, (_, i) =>
      msg({ id: `m${i}`, body: `line ${i}`, authorHandle: '@a' })
    );
    const digest = summariseBlock({ messages, maxItems: 8 });
    expect(digest.consideredCount).toBe(12);
    expect(digest.quotedCount).toBe(8);
    expect(digest.text).toContain('+4 more');
  });

  it('truncates long bodies to one line', () => {
    const digest = summariseBlock({
      messages: [msg({ id: 'm1', body: 'x'.repeat(500) + '\nsecond line', authorHandle: '@a' })],
      maxBodyChars: 20
    });
    expect(digest.text).toContain('…');
    expect(digest.text).not.toContain('second line');
  });

  it('returns empty text when nothing to summarise', () => {
    const digest = summariseBlock({ messages: [msg({ id: 'm1', body: '   ', authorHandle: '@a' })] });
    expect(digest.consideredCount).toBe(0);
    expect(digest.text).toBe('');
  });
});
