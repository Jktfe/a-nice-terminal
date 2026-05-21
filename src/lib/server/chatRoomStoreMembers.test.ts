import { beforeEach, describe, expect, it } from 'vitest';
import {
  createChatRoom,
  findChatRoomById,
  inviteAgentToRoom,
  removeMemberFromRoom,
  resetChatRoomStoreForTests,
  CannotRemoveRoomMemberError,
  __overrideRoomCreatorForTests
} from './chatRoomStore';

describe('chatRoomStore — members and invites', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
  });

  it('creates a room with the creator as the first member', () => {
    const created = createChatRoom({ name: 'with-creator', whoCreatedIt: '@you' });
    expect(created.members).toHaveLength(1);
    expect(created.members[0].handle).toBe('@you');
    expect(created.members[0].kind).toBe('human');
  });

  it('inviteAgentToRoom appends a new agent member', () => {
    const room = createChatRoom({ name: 'invite-target', whoCreatedIt: '@you' });
    const updated = inviteAgentToRoom({
      roomId: room.id,
      agentHandle: '@evolveantclaude'
    });
    expect(updated.members).toHaveLength(2);
    expect(updated.members[1].handle).toBe('@evolveantclaude');
    expect(updated.members[1].kind).toBe('agent');
  });

  it('inviteAgentToRoom prefixes a handle that is missing @', () => {
    const room = createChatRoom({ name: 'prefix-test', whoCreatedIt: '@you' });
    const updated = inviteAgentToRoom({ roomId: room.id, agentHandle: 'kimi' });
    expect(updated.members[1].handle).toBe('@kimi');
  });

  it('inviteAgentToRoom refuses to add an existing member twice', () => {
    const room = createChatRoom({ name: 'dedupe-test', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@gemini' });
    expect(() =>
      inviteAgentToRoom({ roomId: room.id, agentHandle: '@gemini' })
    ).toThrow();
  });

  it('inviteAgentToRoom refuses a blank handle', () => {
    const room = createChatRoom({ name: 'blank-test', whoCreatedIt: '@you' });
    expect(() => inviteAgentToRoom({ roomId: room.id, agentHandle: '   ' })).toThrow();
  });

  it('inviteAgentToRoom refuses an unknown roomId', () => {
    expect(() =>
      inviteAgentToRoom({ roomId: 'room_does_not_exist', agentHandle: '@anyone' })
    ).toThrow();
  });

  it('the updated room is also visible through findChatRoomById', () => {
    const room = createChatRoom({ name: 'lookup-test', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@chair' });
    const fetched = findChatRoomById(room.id);
    expect(fetched?.members.some((m) => m.handle === '@chair')).toBe(true);
  });

  describe('removeMemberFromRoom (M03 slice 5)', () => {
    it('drops a non-creator agent member and updates lastUpdate', () => {
      const room = createChatRoom({ name: 'remove-target', whoCreatedIt: '@you' });
      inviteAgentToRoom({ roomId: room.id, agentHandle: '@evolveantcodex' });

      const updated = removeMemberFromRoom({
        roomId: room.id,
        globalHandle: '@evolveantcodex'
      });

      expect(updated.members.some((member) => member.handle === '@evolveantcodex')).toBe(false);
      expect(updated.lastUpdate).toBe('just now');
    });

    it('refuses an unknown room with a plain Error', () => {
      expect(() =>
        removeMemberFromRoom({ roomId: 'doesnotexist', globalHandle: '@x' })
      ).toThrow();
    });

    it('refuses a non-member handle with a plain Error', () => {
      const room = createChatRoom({ name: 'remove-nonmember', whoCreatedIt: '@you' });
      expect(() =>
        removeMemberFromRoom({ roomId: room.id, globalHandle: '@stranger' })
      ).toThrow();
    });

    it('refuses the room creator with reason=creator', () => {
      const room = createChatRoom({ name: 'remove-creator', whoCreatedIt: '@you' });

      let raisedError: CannotRemoveRoomMemberError | null = null;
      try {
        removeMemberFromRoom({ roomId: room.id, globalHandle: '@you' });
      } catch (causeOfFailure) {
        if (causeOfFailure instanceof CannotRemoveRoomMemberError) raisedError = causeOfFailure;
      }
      expect(raisedError).not.toBeNull();
      expect(raisedError?.reason).toBe('creator');
    });

    it('refuses the last human with reason=last-human when ownership has been transferred', () => {
      // Future ownership-transfer flow is not built yet; simulate it by hand
      // so the last-human defence-in-depth guard fires distinctly from the
      // creator guard. Once a real transfer flow ships, this scenario will
      // be reachable through the public API.
      const room = createChatRoom({ name: 'last-human', whoCreatedIt: '@you' });
      inviteAgentToRoom({ roomId: room.id, agentHandle: '@codex' });
      __overrideRoomCreatorForTests(room.id, '@codex');

      let raisedError: CannotRemoveRoomMemberError | null = null;
      try {
        removeMemberFromRoom({ roomId: room.id, globalHandle: '@you' });
      } catch (causeOfFailure) {
        if (causeOfFailure instanceof CannotRemoveRoomMemberError) raisedError = causeOfFailure;
      }
      expect(raisedError).not.toBeNull();
      expect(raisedError?.reason).toBe('last-human');
    });
  });
});
