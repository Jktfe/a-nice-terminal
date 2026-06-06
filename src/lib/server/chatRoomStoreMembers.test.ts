import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createChatRoom,
  findChatRoomById,
  inviteAgentToRoom,
  removeMemberFromRoom,
  resetChatRoomStoreForTests,
  updateRoomMemberPresentation,
  CannotRemoveRoomMemberError,
  __overrideRoomCreatorForTests
} from './chatRoomStore';
import { getIdentityDb } from './db';
import { getMemberPresentation } from './membershipPresentationStore';
import { isMember as cleanIsMember } from './membershipStore';

describe('chatRoomStore — members and invites', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
  });

  describe('R3 read-flip — ANT_ROSTER_READ=clean sources the roster from room_membership', () => {
    const prev = process.env.ANT_ROSTER_READ;
    beforeEach(() => {
      process.env.ANT_ROSTER_READ = 'clean';
    });
    afterEach(() => {
      if (prev === undefined) delete process.env.ANT_ROSTER_READ;
      else process.env.ANT_ROSTER_READ = prev;
    });

    it('findChatRoomById reads members from the clean tables, with presentation + kind preserved', () => {
      const room = createChatRoom({ name: 'r3-clean-read', whoCreatedIt: '@you' });
      inviteAgentToRoom({ roomId: room.id, agentHandle: '@tony' });
      updateRoomMemberPresentation({
        roomId: room.id,
        globalHandle: '@tony',
        displayColor: '#5566ff',
        displayIcon: 'robot'
      });

      const fetched = findChatRoomById(room.id);
      const tony = fetched?.members.find((m) => m.handle === '@tony');
      const creator = fetched?.members.find((m) => m.handle === '@you');

      // membership sourced from room_membership (both creator + invitee present)
      expect(creator).toBeTruthy();
      expect(tony).toBeTruthy();
      // presentation sourced from room_member_presentation
      expect(tony?.displayColor).toBe('#5566ff');
      expect(tony?.displayIcon).toBe('robot');
      // kind resolution preserved through the shared mapper
      expect(tony?.kind).toBe('agent');
      // oldest-first ordering contract: creator before invitee
      expect(fetched?.members[0].handle).toBe('@you');
    });
  });

  it('member-add additively populates the clean room_membership roster (R3)', () => {
    const room = createChatRoom({ name: 'r3-roster-mirror', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@vera' });
    // both the creator and the invited agent land in the clean roster
    expect(cleanIsMember(room.id, '@you')).toBe(true);
    expect(cleanIsMember(room.id, '@vera')).toBe(true);
    // a non-member is absent
    expect(cleanIsMember(room.id, '@nobody')).toBe(false);
  });

  it('member-remove additively clears the clean roster row (R3)', () => {
    const room = createChatRoom({ name: 'r3-roster-remove', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@vera' });
    expect(cleanIsMember(room.id, '@vera')).toBe(true);
    removeMemberFromRoom({ roomId: room.id, globalHandle: '@vera' });
    expect(cleanIsMember(room.id, '@vera')).toBe(false);
  });

  it('updateRoomMemberPresentation additively mirrors into room_member_presentation (R3)', () => {
    const room = createChatRoom({ name: 'r3-presentation-mirror', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@tony' });
    updateRoomMemberPresentation({
      roomId: room.id,
      globalHandle: '@tony',
      displayColor: '#abc123',
      displayIcon: 'robot'
    });
    const p = getMemberPresentation(room.id, '@tony');
    expect(p?.display_color).toBe('#abc123');
    expect(p?.display_icon).toBe('robot');
    expect(p?.member_kind).toBe('agent');
  });

  it('creates a room with the creator as the first member', () => {
    const created = createChatRoom({ name: 'with-creator', whoCreatedIt: '@you' });
    expect(created.members).toHaveLength(1);
    expect(created.members[0].handle).toBe('@you');
    expect(created.members[0].kind).toBe('human');
  });

  it('does not classify case-variant browser-session synthetic handles as real agents', () => {
    getIdentityDb().pragma('foreign_keys = OFF');
    getIdentityDb()
      .prepare(
        `INSERT INTO room_memberships (id, room_id, handle, terminal_id, created_at)
         VALUES ('synthetic-binding', 'some-room', '@BROWSER-BS_ABC123', 'terminal-bs', 0)`
      )
      .run();

    const created = createChatRoom({ name: 'synthetic-creator', whoCreatedIt: '@BROWSER-BS_ABC123' });

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
