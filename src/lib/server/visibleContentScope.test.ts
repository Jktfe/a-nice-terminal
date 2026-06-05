import { describe, expect, it } from 'vitest';
import { filterVisibleMessages, visibleContentSkipReason } from './visibleContentScope';
import type { ChatMessage } from './chatMessageStore';

function msg(partial: Partial<ChatMessage> & { id: string; body?: string }): ChatMessage {
  const { id, ...rest } = partial;
  return {
    id,
    roomId: 'r1',
    authorHandle: '@agent',
    authorDisplayName: '@agent',
    kind: 'human',
    body: partial.body ?? 'body',
    postedAt: '2026-06-05T00:00:00.000Z',
    postOrder: 1,
    parentMessageId: null,
    discussion_id: undefined,
    deletedAtMs: null,
    ...rest
  } as ChatMessage;
}

describe('visibleContentScope', () => {
  it('explains each reason a retained message is hidden from normal reads', () => {
    const currentBlockIds = new Set(['current']);
    expect(visibleContentSkipReason(msg({ id: 'old' }), { currentBlockIds })).toBe('non_current_block');
    expect(
      visibleContentSkipReason(msg({ id: 'current', deletedAtMs: 123 }), { currentBlockIds })
    ).toBe('message_deleted');
    expect(
      visibleContentSkipReason(msg({ id: 'current', authorHandle: '@browser-bs_tmp' }), {
        currentBlockIds
      })
    ).toBe('synthetic_browser_session');
    expect(visibleContentSkipReason(msg({ id: 'current' }), { currentBlockIds })).toBeNull();
  });

  it('keeps all content when currentBlockIds is omitted but still skips deleted and synthetic rows', () => {
    const messages = [
      msg({ id: 'old', body: 'old visible' }),
      msg({ id: 'deleted', body: 'deleted', deletedAtMs: 123 }),
      msg({ id: 'browser', body: 'synthetic', authorHandle: '@browser-bs_tmp' })
    ];

    expect(filterVisibleMessages(messages, {}).map((message) => message.id)).toEqual(['old']);
  });
});
