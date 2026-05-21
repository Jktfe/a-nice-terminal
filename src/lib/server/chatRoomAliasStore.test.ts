import { describe, expect, it, beforeEach } from 'vitest';
import {
  createChatRoom,
  inviteAgentToRoom,
  resetChatRoomStoreForTests
} from './chatRoomStore';
import {
  setRoomAlias,
  removeRoomAlias,
  findAliasForHandleInRoom,
  listAliasesForRoom,
  findCollisionForAlias,
  resetChatRoomAliasStoreForTests,
  RoomAliasCollisionError
} from './chatRoomAliasStore';

beforeEach(() => {
  resetChatRoomStoreForTests();
  resetChatRoomAliasStoreForTests();
});

describe('chatRoomAliasStore', () => {
  it('saves and looks up a per-room alias', () => {
    const room = createChatRoom({ name: 'alias-target', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@evolveantcodex' });

    const entry = setRoomAlias({
      roomId: room.id,
      globalHandle: '@evolveantcodex',
      newAlias: '@cdx'
    });

    expect(entry.alias).toBe('@cdx');
    expect(findAliasForHandleInRoom(room.id, '@evolveantcodex')).toBe('@cdx');
  });

  it('returns undefined when no alias has been set', () => {
    const room = createChatRoom({ name: 'no-alias', whoCreatedIt: '@you' });
    expect(findAliasForHandleInRoom(room.id, '@you')).toBeUndefined();
  });

  it('prefixes a bare alias with @', () => {
    const room = createChatRoom({ name: 'prefix', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@x' });

    const entry = setRoomAlias({
      roomId: room.id,
      globalHandle: '@x',
      newAlias: 'shortname'
    });

    expect(entry.alias).toBe('@shortname');
  });

  it('replaces a previous alias for the same member', () => {
    const room = createChatRoom({ name: 'replace', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@x' });

    setRoomAlias({ roomId: room.id, globalHandle: '@x', newAlias: '@first' });
    setRoomAlias({ roomId: room.id, globalHandle: '@x', newAlias: '@second' });

    expect(findAliasForHandleInRoom(room.id, '@x')).toBe('@second');
    expect(listAliasesForRoom(room.id)).toHaveLength(1);
  });

  it('removeRoomAlias drops the alias and reports it existed', () => {
    const room = createChatRoom({ name: 'revert', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@x' });
    setRoomAlias({ roomId: room.id, globalHandle: '@x', newAlias: '@a' });

    expect(removeRoomAlias({ roomId: room.id, globalHandle: '@x' })).toBe(true);
    expect(findAliasForHandleInRoom(room.id, '@x')).toBeUndefined();
    expect(removeRoomAlias({ roomId: room.id, globalHandle: '@x' })).toBe(false);
  });

  it('rejects a blank alias', () => {
    const room = createChatRoom({ name: 'blank', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@x' });

    expect(() =>
      setRoomAlias({ roomId: room.id, globalHandle: '@x', newAlias: '   ' })
    ).toThrow();
  });

  it('rejects an unknown room', () => {
    expect(() =>
      setRoomAlias({
        roomId: 'roomdoesnotexist',
        globalHandle: '@x',
        newAlias: '@a'
      })
    ).toThrow();
  });

  it('rejects setting an alias for a non-member', () => {
    const room = createChatRoom({ name: 'nonmember', whoCreatedIt: '@you' });

    expect(() =>
      setRoomAlias({
        roomId: room.id,
        globalHandle: '@evolveantcodex',
        newAlias: '@cdx'
      })
    ).toThrow();
  });

  it('collision with another member global handle throws RoomAliasCollisionError', () => {
    const room = createChatRoom({ name: 'global-collide', whoCreatedIt: '@evolveantclaude' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@evolveantcodex' });

    expect(() =>
      setRoomAlias({
        roomId: room.id,
        globalHandle: '@evolveantclaude',
        newAlias: '@evolveantcodex'
      })
    ).toThrow(RoomAliasCollisionError);
  });

  it('collision with another member alias exposes collidesWith for client suggestions', () => {
    const room = createChatRoom({ name: 'alias-collide', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@evolveantcodex' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@evolveantclaude' });

    setRoomAlias({ roomId: room.id, globalHandle: '@evolveantcodex', newAlias: '@cdx' });

    let raisedCollision: RoomAliasCollisionError | null = null;
    try {
      setRoomAlias({
        roomId: room.id,
        globalHandle: '@evolveantclaude',
        newAlias: '@cdx'
      });
    } catch (causeOfFailure) {
      if (causeOfFailure instanceof RoomAliasCollisionError) raisedCollision = causeOfFailure;
    }

    expect(raisedCollision).not.toBeNull();
    expect(raisedCollision?.collidesWith).toBe('@evolveantcodex');
    expect(raisedCollision?.alias).toBe('@cdx');
  });

  it('a member can re-save the same alias without colliding with themselves', () => {
    const room = createChatRoom({ name: 'self-keep', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@x' });

    setRoomAlias({ roomId: room.id, globalHandle: '@x', newAlias: '@a' });
    setRoomAlias({ roomId: room.id, globalHandle: '@x', newAlias: '@a' });

    expect(findAliasForHandleInRoom(room.id, '@x')).toBe('@a');
  });

  it('findCollisionForAlias returns the existing global handle for a match', () => {
    const room = createChatRoom({ name: 'lookup-collision', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@evolveantcodex' });

    expect(
      findCollisionForAlias({
        roomId: room.id,
        candidateAlias: '@evolveantcodex'
      })
    ).toBe('@evolveantcodex');
  });

  it('listAliasesForRoom returns every alias set in that room', () => {
    const room = createChatRoom({ name: 'list', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@a' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@b' });
    setRoomAlias({ roomId: room.id, globalHandle: '@a', newAlias: '@aaa' });
    setRoomAlias({ roomId: room.id, globalHandle: '@b', newAlias: '@bbb' });

    expect(listAliasesForRoom(room.id)).toHaveLength(2);
  });
});
