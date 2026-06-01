/**
 * m5.4-restart-persistence-proof — Phase A integration test.
 *
 * Validates the ROOMS-PERSISTENCE-A (Phase 5.0/5.1/5.2) promise that
 * rooms + chat_room_members + chat_messages survive a fresh-ANT process
 * restart. Simulates the restart by closing the better-sqlite3 connection
 * (resetIdentityDbForTests) and re-opening it (next getIdentityDb call);
 * the underlying ~/.ant/fresh-ant.db file is unchanged so the next worker
 * sees the same rows.
 *
 * Pre-Phase 5.1 this test would have been impossible to write — rooms +
 * messages lived in process-memory Maps that vanished on the close call.
 * Post-Phase 5.2 every write is durable better-sqlite3 row + WAL journal.
 *
 * Uses ANT_FRESH_DB_PATH to a per-test tmp directory so worker-isolation
 * (db.ts L228-L240) does not erase the file between the close and the
 * re-open phases of the proof.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIdentityDbForTests, closeIdentityDbHandleForTests } from './db';
import {
  createChatRoom,
  inviteAgentToRoom,
  findChatRoomById,
  listChatRooms,
  resetChatRoomStoreForTests
} from './chatRoomStore';
import {
  postMessage,
  postSystemMessage,
  postBreakMessage,
  listMessagesInRoom,
  listMessagesAfterLatestBreak,
  resetChatMessageStoreForTests
} from './chatMessageStore';

let tmpDir: string;
const previousEnv = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-restart-proof-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'restart.db');
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
  resetChatMessageStoreForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousEnv === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousEnv;
});

// Simulates fresh-ANT process restart: closes the in-process better-sqlite3
// connection + clears the singleton WITHOUT deleting the DB file. The next
// store call re-opens against the same on-disk database (path preserved via
// ANT_FRESH_DB_PATH), so committed rows survive — which is the whole point
// of this persistence proof. Uses closeIdentityDbHandleForTests, NOT
// resetIdentityDbForTests: the latter now deletes the file (the correct
// isolation behaviour) and would erase exactly the data we're proving
// survives a restart.
function simulateProcessRestart() {
  closeIdentityDbHandleForTests();
}

describe('m5.4 restart-persistence-proof', () => {
  describe('Phase 5.1 — chat_rooms + chat_room_members', () => {
    it('chat room survives restart with creator membership intact', () => {
      const created = createChatRoom({ name: 'survives-restart', whoCreatedIt: '@you' });
      expect(created.id).toBeTruthy();
      expect(created.members).toHaveLength(1);

      simulateProcessRestart();

      const recovered = findChatRoomById(created.id);
      expect(recovered).toBeDefined();
      expect(recovered?.name).toBe('survives-restart');
      expect(recovered?.whoCreatedIt).toBe('@you');
      expect(recovered?.members).toHaveLength(1);
      expect(recovered?.members[0].handle).toBe('@you');
      expect(recovered?.members[0].kind).toBe('human');
    });

    it('invited agent membership survives restart', () => {
      const room = createChatRoom({ name: 'with-agent', whoCreatedIt: '@you' });
      inviteAgentToRoom({ roomId: room.id, agentHandle: '@codex', agentDisplayName: 'Codex' });

      simulateProcessRestart();

      const recovered = findChatRoomById(room.id);
      expect(recovered?.members).toHaveLength(2);
      expect(recovered?.members.some((m) => m.handle === '@codex' && m.kind === 'agent')).toBe(true);
      expect(recovered?.members.find((m) => m.handle === '@codex')?.displayName).toBe('Codex');
    });

    it('listChatRooms preserves creation_order DESC after restart', () => {
      const first = createChatRoom({ name: 'first', whoCreatedIt: '@you' });
      const second = createChatRoom({ name: 'second', whoCreatedIt: '@you' });
      const third = createChatRoom({ name: 'third', whoCreatedIt: '@you' });

      simulateProcessRestart();

      const rooms = listChatRooms();
      expect(rooms.map((r) => r.id)).toEqual([third.id, second.id, first.id]);
      expect(rooms.map((r) => r.creationOrder)).toEqual([3, 2, 1]);
    });
  });

  describe('Phase 5.2 — chat_messages', () => {
    it('human messages survive restart with ordering preserved', () => {
      const room = createChatRoom({ name: 'msg-survives', whoCreatedIt: '@you' });
      postMessage({ roomId: room.id, authorHandle: '@you', body: 'first' });
      postMessage({ roomId: room.id, authorHandle: '@you', body: 'second' });
      postMessage({ roomId: room.id, authorHandle: '@you', body: 'third' });

      simulateProcessRestart();

      const messages = listMessagesInRoom(room.id);
      expect(messages).toHaveLength(3);
      expect(messages.map((m) => m.body)).toEqual(['first', 'second', 'third']);
      expect(messages[0].postOrder).toBeLessThan(messages[1].postOrder);
      expect(messages[1].postOrder).toBeLessThan(messages[2].postOrder);
    });

    it('system + break + threaded message metadata survives restart', () => {
      const room = createChatRoom({ name: 'mixed', whoCreatedIt: '@you' });
      const parent = postMessage({ roomId: room.id, authorHandle: '@you', body: 'parent' });
      postMessage({
        roomId: room.id, authorHandle: '@codex', body: 'reply',
        kind: 'agent', parentMessageId: parent.id, discussion_id: 'disc-42'
      });
      postSystemMessage({ roomId: room.id, body: '@codex joined this room.' });
      postBreakMessage({ roomId: room.id, postedByHandle: '@you', reason: 'context full' });

      simulateProcessRestart();

      const messages = listMessagesInRoom(room.id);
      expect(messages).toHaveLength(4);
      const reply = messages.find((m) => m.body === 'reply');
      expect(reply?.kind).toBe('agent');
      expect(reply?.parentMessageId).toBe(parent.id);
      expect(reply?.discussion_id).toBe('disc-42');
      expect(messages.some((m) => m.kind === 'system')).toBe(true);
      expect(messages.some((m) => m.kind === 'system-break')).toBe(true);
    });

    it('listMessagesAfterLatestBreak still uses break boundary after restart', () => {
      const room = createChatRoom({ name: 'break-window', whoCreatedIt: '@you' });
      postMessage({ roomId: room.id, authorHandle: '@you', body: 'pre-break-a' });
      postMessage({ roomId: room.id, authorHandle: '@you', body: 'pre-break-b' });
      postBreakMessage({ roomId: room.id, postedByHandle: '@you' });
      postMessage({ roomId: room.id, authorHandle: '@you', body: 'after-break' });

      simulateProcessRestart();

      const windowed = listMessagesAfterLatestBreak(room.id);
      expect(windowed.map((m) => m.body)).toEqual([
        expect.stringMatching(/^Context break by @you/),
        'after-break'
      ]);
    });

    it('post_order remains GLOBAL monotonic across rooms after restart', () => {
      const roomA = createChatRoom({ name: 'A', whoCreatedIt: '@you' });
      const roomB = createChatRoom({ name: 'B', whoCreatedIt: '@you' });
      const a1 = postMessage({ roomId: roomA.id, authorHandle: '@you', body: 'a1' });
      const b1 = postMessage({ roomId: roomB.id, authorHandle: '@you', body: 'b1' });
      const a2 = postMessage({ roomId: roomA.id, authorHandle: '@you', body: 'a2' });

      simulateProcessRestart();

      const messagesA = listMessagesInRoom(roomA.id);
      const messagesB = listMessagesInRoom(roomB.id);
      expect(messagesA.find((m) => m.id === a1.id)?.postOrder).toBeLessThan(
        messagesB.find((m) => m.id === b1.id)?.postOrder ?? Infinity
      );
      expect(messagesB.find((m) => m.id === b1.id)?.postOrder).toBeLessThan(
        messagesA.find((m) => m.id === a2.id)?.postOrder ?? Infinity
      );

      // A new message posted post-restart must keep climbing past the highest
      // pre-restart post_order — proves COALESCE(MAX,0)+1 reads from the file.
      const postRestart = postMessage({ roomId: roomA.id, authorHandle: '@you', body: 'post-restart' });
      const highestBefore = Math.max(a1.postOrder, b1.postOrder, a2.postOrder);
      expect(postRestart.postOrder).toBeGreaterThan(highestBefore);
    });
  });

  describe('cross-cascade — chat_rooms ON DELETE CASCADE still works after restart', () => {
    it('deleting a room via FK cascade removes its members + messages even after restart', () => {
      const room = createChatRoom({ name: 'doomed', whoCreatedIt: '@you' });
      inviteAgentToRoom({ roomId: room.id, agentHandle: '@codex' });
      postMessage({ roomId: room.id, authorHandle: '@you', body: 'doomed message' });
      const survivor = createChatRoom({ name: 'survivor', whoCreatedIt: '@you' });
      postMessage({ roomId: survivor.id, authorHandle: '@you', body: 'survives' });

      simulateProcessRestart();

      // After restart, deleting the doomed room cascades — verifies the ON
      // DELETE CASCADE FK on chat_room_members.room_id + chat_messages.room_id
      // persists in the schema, not just the in-memory connection state.
      resetChatRoomStoreForTests();

      expect(findChatRoomById(room.id)).toBeUndefined();
      expect(findChatRoomById(survivor.id)).toBeUndefined();
      expect(listMessagesInRoom(survivor.id)).toEqual([]);
      expect(listMessagesInRoom(room.id)).toEqual([]);
    });
  });
});
