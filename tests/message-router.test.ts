import { describe, expect, it } from 'vitest';
import { shouldRawForwardLinkedChatMessage } from '../src/lib/server/adapters/linked-chat-adapter.js';
import { handlesForMember, parseMentions } from '../src/lib/server/message-router.js';

describe('message router mentions', () => {
  it('returns both room alias and real handle for a member', () => {
    expect(handlesForMember({ alias: '@master-dave', handle: '@masterdave' })).toEqual([
      '@master-dave',
      '@masterdave',
    ]);
  });

  it('matches either a room alias or real handle as a targeted mention', () => {
    const knownHandles = handlesForMember({ alias: '@master-dave', handle: '@masterdave' });

    expect(parseMentions('@master-dave hello', knownHandles)).toEqual({
      targets: ['@master-dave'],
      isAllParticipants: false,
    });
    expect(parseMentions('@masterdave hello', knownHandles)).toEqual({
      targets: ['@masterdave'],
      isAllParticipants: false,
    });
  });

  it('keeps unknown mentions as all-participants broadcasts', () => {
    expect(parseMentions('@master-dave hello', ['@codex'])).toEqual({
      targets: [],
      isAllParticipants: true,
    });
  });
});

describe('linked chat source markers', () => {
  it('raw-forwards desktop linked-chat sends but skips terminal-page history writes', () => {
    expect(shouldRawForwardLinkedChatMessage({
      role: 'user',
      meta: '{}',
    }, true)).toBe(true);

    expect(shouldRawForwardLinkedChatMessage({
      role: 'user',
      meta: JSON.stringify({ source: 'terminal_direct' }),
    }, true)).toBe(false);
  });
});
