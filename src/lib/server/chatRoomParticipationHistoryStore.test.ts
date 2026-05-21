import { beforeEach, describe, expect, it } from 'vitest';
import {
  recordParticipation,
  listPriorCollaboratorsExcludingRoom,
  resetChatRoomParticipationHistoryStoreForTests
} from './chatRoomParticipationHistoryStore';

describe('chatRoomParticipationHistoryStore', () => {
  beforeEach(() => {
    resetChatRoomParticipationHistoryStoreForTests();
  });

  it('records a (handle, room) pair and surfaces it from another room', () => {
    recordParticipation({ globalHandle: '@evolveantcodex', roomId: 'roomA' });
    expect(listPriorCollaboratorsExcludingRoom('roomB')).toContain('@evolveantcodex');
  });

  it('excludes the current room from the list', () => {
    recordParticipation({ globalHandle: '@evolveantcodex', roomId: 'roomA' });
    expect(listPriorCollaboratorsExcludingRoom('roomA')).not.toContain('@evolveantcodex');
  });

  it('returns a single row per handle even when the handle appears in many rooms', () => {
    recordParticipation({ globalHandle: '@x', roomId: 'roomA' });
    recordParticipation({ globalHandle: '@x', roomId: 'roomB' });
    recordParticipation({ globalHandle: '@x', roomId: 'roomC' });

    const matches = listPriorCollaboratorsExcludingRoom('roomA');
    expect(matches.filter((handle) => handle === '@x')).toHaveLength(1);
  });

  it('still surfaces a handle if at least one of its rooms is not the excluded one', () => {
    recordParticipation({ globalHandle: '@x', roomId: 'roomA' });
    recordParticipation({ globalHandle: '@x', roomId: 'roomB' });

    expect(listPriorCollaboratorsExcludingRoom('roomA')).toContain('@x');
  });

  it('omits a handle whose only room is the excluded one', () => {
    recordParticipation({ globalHandle: '@onlyHere', roomId: 'roomA' });
    expect(listPriorCollaboratorsExcludingRoom('roomA')).toEqual([]);
  });

  it('filters case-insensitively by partial match', () => {
    recordParticipation({ globalHandle: '@evolveantcodex', roomId: 'roomA' });
    recordParticipation({ globalHandle: '@james', roomId: 'roomA' });

    const matches = listPriorCollaboratorsExcludingRoom('roomB', 'JAM');
    expect(matches).toContain('@james');
    expect(matches).not.toContain('@evolveantcodex');
  });

  it('throws when the global handle is blank', () => {
    expect(() =>
      recordParticipation({ globalHandle: '   ', roomId: 'roomA' })
    ).toThrow(/non-blank globalHandle/);
  });

  it('throws when the room id is blank', () => {
    expect(() =>
      recordParticipation({ globalHandle: '@x', roomId: '   ' })
    ).toThrow(/non-blank roomId/);
  });

  it('deduplicates the same (handle, room) recorded twice', () => {
    recordParticipation({ globalHandle: '@x', roomId: 'roomA' });
    recordParticipation({ globalHandle: '@x', roomId: 'roomA' });
    recordParticipation({ globalHandle: '@x', roomId: 'roomB' });

    expect(listPriorCollaboratorsExcludingRoom('roomA')).toEqual(['@x']);
  });

  it('returns handles sorted alphabetically', () => {
    recordParticipation({ globalHandle: '@gemini', roomId: 'roomA' });
    recordParticipation({ globalHandle: '@codex', roomId: 'roomB' });
    recordParticipation({ globalHandle: '@claude', roomId: 'roomC' });

    expect(listPriorCollaboratorsExcludingRoom('roomD')).toEqual([
      '@claude',
      '@codex',
      '@gemini'
    ]);
  });

  it('reset clears all entries', () => {
    recordParticipation({ globalHandle: '@x', roomId: 'roomA' });
    resetChatRoomParticipationHistoryStoreForTests();
    expect(listPriorCollaboratorsExcludingRoom('roomB')).toEqual([]);
  });
});
