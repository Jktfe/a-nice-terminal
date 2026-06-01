import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  setRoomChair,
  getRoomChair,
  listChairHistoryForRoom,
  resetChairHandoffStoreForTests,
  ChairTargetNotMemberError
} from './chairHandoffStore';
import { createChatRoom, inviteAgentToRoom, resetChatRoomStoreForTests } from './chatRoomStore';
import { resetIdentityDbForTests } from './db';

beforeEach(() => {
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
  resetChairHandoffStoreForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
});

describe('chairHandoffStore.setRoomChair', () => {
  it('initial handoff sets current_chair_handle + appends history row with NULL from_handle', () => {
    const room = createChatRoom({ name: 'r1', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@codex' });
    const result = setRoomChair({ roomId: room.id, toHandle: '@codex', setBy: '@you' });
    expect(result.changed).toBe(true);
    expect(result.currentChairHandle).toBe('@codex');
    expect(getRoomChair(room.id)).toBe('@codex');
    const history = listChairHistoryForRoom(room.id);
    expect(history).toHaveLength(1);
    expect(history[0].from_handle).toBeNull();
    expect(history[0].to_handle).toBe('@codex');
    expect(history[0].set_by).toBe('@you');
  });

  it('handing off to the current chair is idempotent — no new history row, changed=false', () => {
    const room = createChatRoom({ name: 'r2', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@codex' });
    setRoomChair({ roomId: room.id, toHandle: '@codex', setBy: '@you' });
    const result = setRoomChair({ roomId: room.id, toHandle: '@codex', setBy: '@you' });
    expect(result.changed).toBe(false);
    expect(listChairHistoryForRoom(room.id)).toHaveLength(1);
  });

  it('subsequent handoff appends history row with previous chair as from_handle', () => {
    const room = createChatRoom({ name: 'r3', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@codex' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@kimi' });
    setRoomChair({ roomId: room.id, toHandle: '@codex', setBy: '@you', nowMs: 100 });
    setRoomChair({ roomId: room.id, toHandle: '@kimi', setBy: '@codex', nowMs: 200 });
    const history = listChairHistoryForRoom(room.id);
    expect(history).toHaveLength(2);
    expect(history[0].from_handle).toBe('@codex');
    expect(history[0].to_handle).toBe('@kimi');
    expect(history[0].set_by).toBe('@codex');
    expect(history[1].from_handle).toBeNull();
    expect(history[1].to_handle).toBe('@codex');
  });

  it('throws ChairTargetNotMemberError when toHandle is not a room member', () => {
    const room = createChatRoom({ name: 'r4', whoCreatedIt: '@you' });
    expect(() =>
      setRoomChair({ roomId: room.id, toHandle: '@stranger', setBy: '@you' })
    ).toThrow(ChairTargetNotMemberError);
    expect(getRoomChair(room.id)).toBeNull();
    expect(listChairHistoryForRoom(room.id)).toEqual([]);
  });

  it('throws plain Error when room does not exist', () => {
    expect(() =>
      setRoomChair({ roomId: 'phantom', toHandle: '@x', setBy: '@you' })
    ).toThrow(/No room found/);
  });

  it('listChairHistoryForRoom returns newest-first ordered by set_at_ms', () => {
    const room = createChatRoom({ name: 'r5', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@a' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@b' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@c' });
    setRoomChair({ roomId: room.id, toHandle: '@a', setBy: '@you', nowMs: 100 });
    setRoomChair({ roomId: room.id, toHandle: '@b', setBy: '@you', nowMs: 200 });
    setRoomChair({ roomId: room.id, toHandle: '@c', setBy: '@you', nowMs: 300 });
    const history = listChairHistoryForRoom(room.id);
    expect(history.map((h) => h.to_handle)).toEqual(['@c', '@b', '@a']);
    expect(history.map((h) => h.set_at_ms)).toEqual([300, 200, 100]);
  });

  it('history rows cascade-delete when room is removed', () => {
    const room = createChatRoom({ name: 'doomed', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@codex' });
    setRoomChair({ roomId: room.id, toHandle: '@codex', setBy: '@you' });
    expect(listChairHistoryForRoom(room.id)).toHaveLength(1);
    resetChatRoomStoreForTests();
    expect(listChairHistoryForRoom(room.id)).toEqual([]);
  });
});
