import { beforeEach, describe, expect, it } from 'vitest';
import { createChatRoom, resetChatRoomStoreForTests } from './chatRoomStore';
import {
  getContextBreakEnforcement,
  resetContextBreakSettingsForTests,
  setContextBreakEnforcement
} from './contextBreakSettingsStore';

describe('contextBreakSettingsStore', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
    resetContextBreakSettingsForTests();
  });

  it('defaults every room to hard server-side context-break enforcement', () => {
    const room = createChatRoom({ name: 'default-hard', whoCreatedIt: '@you' });

    expect(getContextBreakEnforcement(room.id)).toBe('hard');
  });

  it('persists per-room enforcement without affecting other rooms', () => {
    const roomA = createChatRoom({ name: 'off-room', whoCreatedIt: '@you' });
    const roomB = createChatRoom({ name: 'hard-room', whoCreatedIt: '@you' });

    setContextBreakEnforcement(roomA.id, 'off');

    expect(getContextBreakEnforcement(roomA.id)).toBe('off');
    expect(getContextBreakEnforcement(roomB.id)).toBe('hard');
  });

  it('rejects unknown enforcement modes', () => {
    const room = createChatRoom({ name: 'bad-mode', whoCreatedIt: '@you' });

    expect(() => setContextBreakEnforcement(room.id, 'maybe' as never)).toThrow(
      'Unknown context-break enforcement mode.'
    );
  });
});
