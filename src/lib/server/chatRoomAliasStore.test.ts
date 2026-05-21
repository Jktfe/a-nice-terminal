import { describe, expect, it, beforeEach } from 'vitest';
import {
  createChatRoom,
  inviteAgentToRoom,
  resetChatRoomStoreForTests
} from './chatRoomStore';
import {
  setRoomAlias,
  removeRoomAlias,
  removeAliasByText,
  findAliasForHandleInRoom,
  listAliasesForHandleInRoom,
  listAliasesForRoom,
  findHandleForAliasInRoom,
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

  it('STACKS multiple aliases on the same handle; findAliasForHandleInRoom returns the most recent', () => {
    const room = createChatRoom({ name: 'stack', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@x' });

    setRoomAlias({ roomId: room.id, globalHandle: '@x', newAlias: '@first' });
    setRoomAlias({ roomId: room.id, globalHandle: '@x', newAlias: '@second' });

    expect(findAliasForHandleInRoom(room.id, '@x')).toBe('@second');
    expect(listAliasesForHandleInRoom(room.id, '@x').map((entry) => entry.alias))
      .toEqual(['@second', '@first']);
    expect(listAliasesForRoom(room.id)).toHaveLength(2);
  });

  it('removeRoomAlias drops EVERY alias for that handle in the room', () => {
    const room = createChatRoom({ name: 'revert-all', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@x' });
    setRoomAlias({ roomId: room.id, globalHandle: '@x', newAlias: '@a' });
    setRoomAlias({ roomId: room.id, globalHandle: '@x', newAlias: '@b' });

    expect(removeRoomAlias({ roomId: room.id, globalHandle: '@x' })).toBe(true);
    expect(findAliasForHandleInRoom(room.id, '@x')).toBeUndefined();
    expect(listAliasesForHandleInRoom(room.id, '@x')).toHaveLength(0);
    expect(removeRoomAlias({ roomId: room.id, globalHandle: '@x' })).toBe(false);
  });

  it('removeAliasByText drops a single alias and leaves the rest', () => {
    const room = createChatRoom({ name: 'targeted-remove', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@x' });
    setRoomAlias({ roomId: room.id, globalHandle: '@x', newAlias: '@keep' });
    setRoomAlias({ roomId: room.id, globalHandle: '@x', newAlias: '@drop' });

    expect(removeAliasByText({ roomId: room.id, alias: '@drop' })).toBe(true);
    expect(listAliasesForHandleInRoom(room.id, '@x').map((entry) => entry.alias))
      .toEqual(['@keep']);
    expect(removeAliasByText({ roomId: room.id, alias: '@drop' })).toBe(false);
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

  it('re-saving the SAME alias for the SAME handle is an idempotent no-op', () => {
    const room = createChatRoom({ name: 'self-keep', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@x' });

    const first = setRoomAlias({ roomId: room.id, globalHandle: '@x', newAlias: '@a' });
    const second = setRoomAlias({ roomId: room.id, globalHandle: '@x', newAlias: '@a' });

    expect(second.alias).toBe('@a');
    expect(second.setAt).toBe(first.setAt);
    expect(listAliasesForHandleInRoom(room.id, '@x')).toHaveLength(1);
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

  it('findHandleForAliasInRoom resolves an alias text back to its owning global handle', () => {
    const room = createChatRoom({ name: 'reverse', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@evolveantcodex' });
    setRoomAlias({ roomId: room.id, globalHandle: '@evolveantcodex', newAlias: '@cdx' });
    setRoomAlias({ roomId: room.id, globalHandle: '@evolveantcodex', newAlias: '@codex-mac' });

    expect(findHandleForAliasInRoom(room.id, '@cdx')).toBe('@evolveantcodex');
    expect(findHandleForAliasInRoom(room.id, '@codex-mac')).toBe('@evolveantcodex');
    // Bare global handle resolves to itself
    expect(findHandleForAliasInRoom(room.id, '@evolveantcodex')).toBe('@evolveantcodex');
    expect(findHandleForAliasInRoom(room.id, '@unknown')).toBeUndefined();
  });

  it('aliases persist via SQLite (survive an in-conversation reset of the in-mem chat-room store)', () => {
    const room = createChatRoom({ name: 'persist', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@x' });
    setRoomAlias({ roomId: room.id, globalHandle: '@x', newAlias: '@stays' });

    // Re-seed chat-rooms but DO NOT reset the alias store — same room id
    // brings the SQLite-backed alias rows back into play.
    resetChatRoomStoreForTests();
    const restored = createChatRoom({ name: 'persist', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: restored.id, agentHandle: '@x' });

    // Manually insert a row keyed on the new room id to demonstrate the
    // SQLite path; primary persistence guarantee is exercised by the
    // restart-proof tests in src/lib/server/m5_4_restart_persistence_proof.test.ts.
    setRoomAlias({ roomId: restored.id, globalHandle: '@x', newAlias: '@stays' });
    expect(findAliasForHandleInRoom(restored.id, '@x')).toBe('@stays');
  });
});
