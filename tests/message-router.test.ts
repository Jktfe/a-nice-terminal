import { describe, expect, it } from 'vitest';
import { shouldRawForwardLinkedChatMessage } from '../src/lib/server/adapters/linked-chat-adapter.js';
import {
  handlesForMember,
  parseMentions,
  resolveRoomFanout,
  shouldDeliverLinkedChatToTerminal,
} from '../src/lib/server/message-router.js';

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

  it('allows coordinator terminals to type into another terminal linked chat', () => {
    expect(shouldDeliverLinkedChatToTerminal('target-terminal', 'coordinator-terminal')).toBe(true);
    expect(shouldDeliverLinkedChatToTerminal('target-terminal', 'target-terminal')).toBe(false);
  });
});

describe('room fan-out scope', () => {
  const handles = ['@claude', '@gemini', '@codex'];

  it('keeps terminal acknowledgements chat-visible only', () => {
    expect(resolveRoomFanout('on it', handles, 'terminal')).toEqual({
      targets: [],
      isAllParticipants: true,
      shouldFanOutToTerminals: false,
    });
  });

  it('routes terminal-originated active mentions to the named terminal', () => {
    expect(resolveRoomFanout('@gemini can you help', handles, 'terminal')).toEqual({
      targets: ['@gemini'],
      isAllParticipants: false,
      shouldFanOutToTerminals: true,
    });
  });

  it('lets terminal-originated @everyone fan out to all terminals', () => {
    expect(resolveRoomFanout('@everyone status update', handles, 'terminal')).toEqual({
      targets: [],
      isAllParticipants: true,
      shouldFanOutToTerminals: true,
    });
  });

  it('does not treat terminal-originated unknown mentions as broadcasts', () => {
    expect(resolveRoomFanout('@unknown on it', handles, 'terminal')).toEqual({
      targets: [],
      isAllParticipants: true,
      shouldFanOutToTerminals: false,
    });
  });

  it('preserves human broadcast behaviour', () => {
    expect(resolveRoomFanout('can someone check this', handles, null)).toEqual({
      targets: [],
      isAllParticipants: true,
      shouldFanOutToTerminals: true,
    });
  });
});
