import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getIdentityDb, resetIdentityDbForTests } from './db';
import { createChatRoom, archiveChatRoom } from './chatRoomStore';
import { createTerminalRecord } from './terminalRecordsStore';
import {
  reconcileLiveTerminalLinkedChats,
  findLiveTerminalLinkedChatViolations
} from './terminalLinkedChatReconciler';

let tmpDir: string;
const prev = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-reconcile-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (prev === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = prev;
});

function roomArchivedAtMs(roomId: string): number | null {
  const row = getIdentityDb()
    .prepare(`SELECT archived_at_ms FROM chat_rooms WHERE id = ?`)
    .get(roomId) as { archived_at_ms: number | null } | undefined;
  return row?.archived_at_ms ?? null;
}

describe('terminalLinkedChatReconciler — "live terminal -> live linked chat" invariant', () => {
  it('un-archives the linked chat of a live terminal (the homebrew/antios picker bug)', () => {
    const room = createChatRoom({ name: 'Terminal: homebrewclaude', whoCreatedIt: '@you' });
    archiveChatRoom(room.id); // the 2026-05-29 batch-archive scenario
    // Live terminal (no terminals row -> NULL status -> treated live) linked to it.
    createTerminalRecord({ sessionId: 'homebrewclaude', linkedChatRoomId: room.id, name: 'auto:homebrewclaude' });

    expect(roomArchivedAtMs(room.id)).not.toBeNull(); // archived -> hidden from picker

    const violations = findLiveTerminalLinkedChatViolations();
    expect(violations).toHaveLength(1);
    expect(violations[0].roomId).toBe(room.id);

    const restored = reconcileLiveTerminalLinkedChats();
    expect(restored).toHaveLength(1);
    expect(restored[0].sessionId).toBe('homebrewclaude');
    expect(roomArchivedAtMs(room.id)).toBeNull(); // invariant restored -> picker shows it
  });

  it('is idempotent — a second run finds nothing to do', () => {
    const room = createChatRoom({ name: 'Terminal: x', whoCreatedIt: '@you' });
    archiveChatRoom(room.id);
    createTerminalRecord({ sessionId: 's', linkedChatRoomId: room.id, name: 'auto:x' });

    expect(reconcileLiveTerminalLinkedChats()).toHaveLength(1);
    expect(reconcileLiveTerminalLinkedChats()).toHaveLength(0); // already healed
    expect(findLiveTerminalLinkedChatViolations()).toHaveLength(0);
  });

  it('leaves a NON-archived linked chat alone', () => {
    const room = createChatRoom({ name: 'Terminal: live', whoCreatedIt: '@you' });
    createTerminalRecord({ sessionId: 's2', linkedChatRoomId: room.id, name: 'auto:live' });
    expect(reconcileLiveTerminalLinkedChats()).toHaveLength(0);
    expect(roomArchivedAtMs(room.id)).toBeNull();
  });
});
