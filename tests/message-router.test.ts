import { describe, expect, it } from 'vitest';
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
