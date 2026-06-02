import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listRoomHealth } from './roomHealthStore';
import { createChatRoom, resetChatRoomStoreForTests, archiveChatRoom, softDeleteChatRoom } from './chatRoomStore';
import { getIdentityDb, resetIdentityDbForTests } from './db';

// ROOM-HEALTH read-model (workstream C, plan room-identity-stage-full-delivery
// -2026-06-02). Pure READ-ONLY projection of the core identity invariant chain
// for every LIVE terminal so drift is DETECTED before a human hits a 403.
//
// Invariant chain (per live terminal = terminal_records.superseded_at_ms IS NULL
// joined to terminals.status='live'):
//   1. hasHandle      — terminal_records.handle is non-empty
//   2. isMember       — >=1 non-revoked room_membership for that terminal
//   3. linkedRoomLive — linked_chat_room_id is NULL OR points at a live room
//                       (chat_rooms row exists, not archived, not deleted)
//   healthy = hasHandle AND isMember AND linkedRoomLive

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-room-health-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
});

/** Insert a row into `terminals` with an explicit id so it can be joined
 *  to a terminal_records row on session_id = id. */
function insertTerminal(args: {
  id: string;
  name: string;
  status?: 'live' | 'archived' | 'deleted';
}): void {
  const db = getIdentityDb();
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO terminals
       (id, pid, pid_start, name, source, meta, created_at, updated_at, status)
       VALUES (?, 1234, 'pstart', ?, 'test', '{}', ?, ?, ?)`
  ).run(args.id, args.name, now, now, args.status ?? 'live');
}

/** Insert a terminal_records row (the canonical handle / linked-room store). */
function insertTerminalRecord(args: {
  sessionId: string;
  handle?: string | null;
  linkedChatRoomId?: string | null;
  supersededAtMs?: number | null;
}): void {
  const db = getIdentityDb();
  const now = Date.now();
  db.prepare(
    `INSERT INTO terminal_records
       (session_id, name, auto_forward_chat, created_at_ms, updated_at_ms,
        handle, linked_chat_room_id, superseded_at_ms)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?)`
  ).run(
    args.sessionId,
    `record-${args.sessionId}`,
    now,
    now,
    args.handle ?? null,
    args.linkedChatRoomId ?? null,
    args.supersededAtMs ?? null
  );
}

function addMembershipRow(args: { roomId: string; handle: string; terminalId: string; revokedAtMs?: number | null }): void {
  const db = getIdentityDb();
  db.prepare(
    `INSERT INTO room_memberships (id, room_id, handle, terminal_id, created_at, revoked_at_ms)
       VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    `mem-${args.terminalId}-${args.roomId}`,
    args.roomId,
    args.handle,
    args.terminalId,
    Math.floor(Date.now() / 1000),
    args.revokedAtMs ?? null
  );
}

describe('listRoomHealth', () => {
  it('returns [] when there are no live terminals', () => {
    expect(listRoomHealth()).toEqual([]);
  });

  it('marks a fully-wired terminal healthy (handle + member + null linked room)', () => {
    const room = createChatRoom({ name: 'coord', whoCreatedIt: '@you' });
    insertTerminal({ id: 'sess-ok', name: 'term-ok' });
    insertTerminalRecord({ sessionId: 'sess-ok', handle: '@ok', linkedChatRoomId: null });
    addMembershipRow({ roomId: room.id, handle: '@ok', terminalId: 'sess-ok' });

    const out = listRoomHealth();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      handle: '@ok',
      terminalId: 'sess-ok',
      hasHandle: true,
      isMember: true,
      linkedRoomLive: true,
      healthy: true,
      brokenReason: null
    });
  });

  it('marks healthy when linked_chat_room_id points at a LIVE room', () => {
    const linked = createChatRoom({ name: 'Terminal: alpha', whoCreatedIt: '@you' });
    insertTerminal({ id: 'sess-link', name: 'term-link' });
    insertTerminalRecord({ sessionId: 'sess-link', handle: '@link', linkedChatRoomId: linked.id });
    addMembershipRow({ roomId: linked.id, handle: '@link', terminalId: 'sess-link' });

    const out = listRoomHealth();
    expect(out).toHaveLength(1);
    expect(out[0].linkedRoomLive).toBe(true);
    expect(out[0].healthy).toBe(true);
  });

  it('flags a terminal with an empty handle as broken (no-handle)', () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    insertTerminal({ id: 'sess-nohandle', name: 'term-nohandle' });
    insertTerminalRecord({ sessionId: 'sess-nohandle', handle: '', linkedChatRoomId: null });
    addMembershipRow({ roomId: room.id, handle: '@x', terminalId: 'sess-nohandle' });

    const out = listRoomHealth();
    expect(out).toHaveLength(1);
    expect(out[0].hasHandle).toBe(false);
    expect(out[0].healthy).toBe(false);
    expect(out[0].brokenReason).toBe('no-handle');
  });

  it('flags a terminal with a NULL handle as broken (no-handle)', () => {
    insertTerminal({ id: 'sess-null-handle', name: 'term-null-handle' });
    insertTerminalRecord({ sessionId: 'sess-null-handle', handle: null, linkedChatRoomId: null });

    const out = listRoomHealth();
    expect(out).toHaveLength(1);
    expect(out[0].hasHandle).toBe(false);
    expect(out[0].brokenReason).toBe('no-handle');
  });

  it('flags a handled terminal with no membership as broken (no-membership)', () => {
    insertTerminal({ id: 'sess-noroom', name: 'term-noroom' });
    insertTerminalRecord({ sessionId: 'sess-noroom', handle: '@orphan', linkedChatRoomId: null });

    const out = listRoomHealth();
    expect(out).toHaveLength(1);
    expect(out[0].hasHandle).toBe(true);
    expect(out[0].isMember).toBe(false);
    expect(out[0].brokenReason).toBe('no-membership');
  });

  it('treats a revoked-only membership as no-membership', () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    insertTerminal({ id: 'sess-revoked', name: 'term-revoked' });
    insertTerminalRecord({ sessionId: 'sess-revoked', handle: '@rev', linkedChatRoomId: null });
    addMembershipRow({ roomId: room.id, handle: '@rev', terminalId: 'sess-revoked', revokedAtMs: Date.now() });

    const out = listRoomHealth();
    expect(out).toHaveLength(1);
    expect(out[0].isMember).toBe(false);
    expect(out[0].brokenReason).toBe('no-membership');
  });

  it('flags a terminal whose linked room was ARCHIVED as broken (dangling-linked-room)', () => {
    const room = createChatRoom({ name: 'to-archive', whoCreatedIt: '@you' });
    insertTerminal({ id: 'sess-arch', name: 'term-arch' });
    insertTerminalRecord({ sessionId: 'sess-arch', handle: '@arch', linkedChatRoomId: room.id });
    addMembershipRow({ roomId: room.id, handle: '@arch', terminalId: 'sess-arch' });
    archiveChatRoom(room.id);

    const out = listRoomHealth();
    expect(out).toHaveLength(1);
    expect(out[0].linkedRoomLive).toBe(false);
    expect(out[0].brokenReason).toBe('dangling-linked-room');
  });

  it('flags a terminal whose linked room was DELETED as broken (dangling-linked-room)', () => {
    const room = createChatRoom({ name: 'to-delete', whoCreatedIt: '@you' });
    insertTerminal({ id: 'sess-del', name: 'term-del' });
    insertTerminalRecord({ sessionId: 'sess-del', handle: '@del', linkedChatRoomId: room.id });
    addMembershipRow({ roomId: room.id, handle: '@del', terminalId: 'sess-del' });
    softDeleteChatRoom(room.id);

    const out = listRoomHealth();
    expect(out).toHaveLength(1);
    expect(out[0].linkedRoomLive).toBe(false);
    expect(out[0].brokenReason).toBe('dangling-linked-room');
  });

  it('flags a terminal whose linked room id does not exist at all (dangling-linked-room)', () => {
    insertTerminal({ id: 'sess-ghost', name: 'term-ghost' });
    insertTerminalRecord({ sessionId: 'sess-ghost', handle: '@ghost', linkedChatRoomId: 'no-such-room' });

    const out = listRoomHealth();
    expect(out).toHaveLength(1);
    expect(out[0].linkedRoomLive).toBe(false);
    // linked-room failure takes precedence over the missing membership so the
    // reason points at the most actionable break.
    expect(out[0].brokenReason).toBe('dangling-linked-room');
  });

  it('excludes superseded terminal_records (recycled pane)', () => {
    insertTerminal({ id: 'sess-super', name: 'term-super' });
    insertTerminalRecord({
      sessionId: 'sess-super',
      handle: '@super',
      linkedChatRoomId: null,
      supersededAtMs: Date.now()
    });

    expect(listRoomHealth()).toEqual([]);
  });

  it('excludes archived/deleted terminals (only status=live counts)', () => {
    insertTerminal({ id: 'sess-arch-t', name: 'term-arch-t', status: 'archived' });
    insertTerminalRecord({ sessionId: 'sess-arch-t', handle: '@a', linkedChatRoomId: null });
    insertTerminal({ id: 'sess-del-t', name: 'term-del-t', status: 'deleted' });
    insertTerminalRecord({ sessionId: 'sess-del-t', handle: '@d', linkedChatRoomId: null });

    expect(listRoomHealth()).toEqual([]);
  });

  it('falls back to terminal_records.name when handle is missing for the name field', () => {
    insertTerminal({ id: 'sess-name', name: 'term-name' });
    insertTerminalRecord({ sessionId: 'sess-name', handle: null, linkedChatRoomId: null });

    const out = listRoomHealth();
    expect(out[0].name).toBe('record-sess-name');
    expect(out[0].handle).toBeNull();
  });

  it('reports a mixed fleet with correct healthy/broken classification', () => {
    const room = createChatRoom({ name: 'mixed', whoCreatedIt: '@you' });
    // healthy
    insertTerminal({ id: 's1', name: 't1' });
    insertTerminalRecord({ sessionId: 's1', handle: '@one', linkedChatRoomId: null });
    addMembershipRow({ roomId: room.id, handle: '@one', terminalId: 's1' });
    // broken: no membership
    insertTerminal({ id: 's2', name: 't2' });
    insertTerminalRecord({ sessionId: 's2', handle: '@two', linkedChatRoomId: null });

    const out = listRoomHealth();
    expect(out).toHaveLength(2);
    const healthy = out.filter((r) => r.healthy);
    const broken = out.filter((r) => !r.healthy);
    expect(healthy).toHaveLength(1);
    expect(broken).toHaveLength(1);
    expect(healthy[0].terminalId).toBe('s1');
    expect(broken[0].terminalId).toBe('s2');
  });
});
