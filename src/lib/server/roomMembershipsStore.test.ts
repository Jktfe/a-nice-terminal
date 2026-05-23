import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIdentityDbForTests } from './db';
import { upsertTerminal } from './terminalsStore';
import {
  addMembership,
  getRoomScopedHandle,
  getTerminalIdByHandle,
  listMembershipsForRoom,
  listAllMembershipsForRoomIncludingRevoked,
  listMembershipsForTerminal,
  removeMembership
} from './roomMembershipsStore';
import { getIdentityDb } from './db';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-memberships-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
});

function makeTerminal(name: string): string {
  return upsertTerminal({ pid: 100, pid_start: 'pst', name }).id;
}

describe('addMembership', () => {
  it('inserts a new membership and normalises handle prefix', () => {
    const tid = makeTerminal('t1');
    const m = addMembership({ room_id: 'roomA', handle: 'claude2', terminal_id: tid });
    expect(m.handle).toBe('@claude2');
    expect(m.terminal_id).toBe(tid);
  });

  it('preserves existing @ prefix', () => {
    const tid = makeTerminal('t1');
    const m = addMembership({ room_id: 'roomA', handle: '@claude2', terminal_id: tid });
    expect(m.handle).toBe('@claude2');
  });

  it('is idempotent for same (room, handle, terminal)', () => {
    const tid = makeTerminal('t1');
    const first = addMembership({ room_id: 'roomA', handle: '@x', terminal_id: tid });
    const second = addMembership({ room_id: 'roomA', handle: '@x', terminal_id: tid });
    expect(second.id).toBe(first.id);
  });

  it('UPDATEs terminal_id when same (room, handle) re-bound to a different terminal', () => {
    const tid1 = makeTerminal('t1');
    const tid2 = makeTerminal('t2');
    const first = addMembership({ room_id: 'roomA', handle: '@x', terminal_id: tid1 });
    const second = addMembership({ room_id: 'roomA', handle: '@x', terminal_id: tid2 });
    expect(second.id).toBe(first.id);
    expect(second.terminal_id).toBe(tid2);
  });

  it('allows the same handle in different rooms (room-scoped)', () => {
    const tid = makeTerminal('t1');
    const a = addMembership({ room_id: 'roomA', handle: '@x', terminal_id: tid });
    const b = addMembership({ room_id: 'roomB', handle: '@x', terminal_id: tid });
    expect(a.id).not.toBe(b.id);
  });
});

describe('lookups', () => {
  it('getRoomScopedHandle returns the handle for (room_id, terminal_id)', () => {
    const tid = makeTerminal('t1');
    addMembership({ room_id: 'r1', handle: '@one', terminal_id: tid });
    expect(getRoomScopedHandle('r1', tid)).toBe('@one');
    expect(getRoomScopedHandle('r1', 'nonsense')).toBeNull();
  });

  it('getTerminalIdByHandle returns the terminal_id', () => {
    const tid = makeTerminal('t1');
    addMembership({ room_id: 'r1', handle: '@one', terminal_id: tid });
    expect(getTerminalIdByHandle('r1', 'one')).toBe(tid);
    expect(getTerminalIdByHandle('r1', '@one')).toBe(tid);
    expect(getTerminalIdByHandle('r1', 'missing')).toBeNull();
  });

  it('listMembershipsForRoom returns all rows in that room', () => {
    const t1 = makeTerminal('t1');
    const t2 = makeTerminal('t2');
    addMembership({ room_id: 'r1', handle: '@a', terminal_id: t1 });
    addMembership({ room_id: 'r1', handle: '@b', terminal_id: t2 });
    addMembership({ room_id: 'r2', handle: '@c', terminal_id: t1 });
    const rows = listMembershipsForRoom('r1');
    expect(rows.length).toBe(2);
  });

  it('listMembershipsForTerminal returns all rows for that terminal', () => {
    const tid = makeTerminal('t1');
    addMembership({ room_id: 'r1', handle: '@a', terminal_id: tid });
    addMembership({ room_id: 'r2', handle: '@a', terminal_id: tid });
    expect(listMembershipsForTerminal(tid).length).toBe(2);
  });
});

describe('revoked_at_ms helper-level filter (M4 T1.1 cross-slice fix)', () => {
  function markRevoked(membershipId: string, atMs: number = Date.now()): void {
    getIdentityDb().prepare(`UPDATE room_memberships SET revoked_at_ms = ? WHERE id = ?`).run(atMs, membershipId);
  }

  it('listMembershipsForRoom EXCLUDES revoked rows by default', () => {
    const t1 = makeTerminal('t1');
    const t2 = makeTerminal('t2');
    const m1 = addMembership({ room_id: 'r1', handle: '@active', terminal_id: t1 });
    const m2 = addMembership({ room_id: 'r1', handle: '@gone', terminal_id: t2 });
    markRevoked(m2.id);
    const active = listMembershipsForRoom('r1');
    expect(active.map((m) => m.handle)).toEqual(['@active']);
    expect(active.find((m) => m.id === m1.id)).toBeDefined();
  });

  it('listAllMembershipsForRoomIncludingRevoked INCLUDES revoked rows for audit', () => {
    const t1 = makeTerminal('t1');
    const t2 = makeTerminal('t2');
    addMembership({ room_id: 'r1', handle: '@active', terminal_id: t1 });
    const m2 = addMembership({ room_id: 'r1', handle: '@gone', terminal_id: t2 });
    markRevoked(m2.id);
    const all = listAllMembershipsForRoomIncludingRevoked('r1');
    expect(all.length).toBe(2);
    expect(all.find((m) => m.handle === '@gone')).toBeDefined();
  });

  it('listMembershipsForTerminal EXCLUDES revoked rows', () => {
    const tid = makeTerminal('t1');
    const m1 = addMembership({ room_id: 'r1', handle: '@a', terminal_id: tid });
    const m2 = addMembership({ room_id: 'r2', handle: '@a', terminal_id: tid });
    markRevoked(m2.id);
    expect(listMembershipsForTerminal(tid).map((m) => m.id)).toEqual([m1.id]);
  });

  it('getRoomScopedHandle returns null on revoked membership (security: revoked remote cannot resolve handle)', () => {
    const tid = makeTerminal('t1');
    const m = addMembership({ room_id: 'r1', handle: '@bridge', terminal_id: tid });
    expect(getRoomScopedHandle('r1', tid)).toBe('@bridge');
    markRevoked(m.id);
    expect(getRoomScopedHandle('r1', tid)).toBeNull();
  });

  it('getTerminalIdByHandle returns null on revoked membership', () => {
    const tid = makeTerminal('t1');
    const m = addMembership({ room_id: 'r1', handle: '@bridge', terminal_id: tid });
    markRevoked(m.id);
    expect(getTerminalIdByHandle('r1', '@bridge')).toBeNull();
  });
});

describe('removeMembership', () => {
  it('removes the row and returns true', () => {
    const tid = makeTerminal('t1');
    addMembership({ room_id: 'r1', handle: '@gone', terminal_id: tid });
    expect(removeMembership('r1', '@gone')).toBe(true);
    expect(getRoomScopedHandle('r1', tid)).toBeNull();
  });

  it('returns false when nothing was removed', () => {
    expect(removeMembership('r1', '@nope')).toBe(false);
  });
});

describe('β3 agent-join system message', () => {
  it('posts a system message on first agent join', async () => {
    const { createChatRoom } = await import('./chatRoomStore');
    const { listMessagesInRoom } = await import('./chatMessageStore');
    const room = createChatRoom({ name: 'join-test-1', whoCreatedIt: '@you' });
    const tid = makeTerminal('agent-t');
    addMembership({ room_id: room.id, handle: '@speedyclaude', terminal_id: tid });
    const msgs = listMessagesInRoom(room.id);
    const systemMsgs = msgs.filter((m) => m.kind === 'system');
    expect(systemMsgs).toHaveLength(1);
    expect(systemMsgs[0].body).toContain('context discipline');
    expect(systemMsgs[0].body).toContain('system-break');
    expect(systemMsgs[0].body).toContain('Memory files');
  });

  it('does NOT post a system message for human handles', async () => {
    const { createChatRoom } = await import('./chatRoomStore');
    const { listMessagesInRoom } = await import('./chatMessageStore');
    const { getIdentityDb } = await import('./db');
    // Register @human-tester as a human owner so resolveHumanOwnership
    // returns kind='human'. owners table requires NOT NULL password_hash
    // + updated_at_ms (per schema in db.ts).
    const db = getIdentityDb();
    const now = Date.now();
    db.prepare(
      `INSERT INTO owners (id, primary_handle, password_hash, created_at_ms, updated_at_ms)
       VALUES (?, ?, ?, ?, ?)`
    ).run('owner-1', '@human-tester', 'test-hash', now, now);
    db.prepare(
      `INSERT INTO owner_handles (handle, owner_id, assigned_at_ms) VALUES (?, ?, ?)`
    ).run('@human-tester', 'owner-1', now);
    const room = createChatRoom({ name: 'join-test-2', whoCreatedIt: '@you' });
    const tid = makeTerminal('human-t');
    addMembership({ room_id: room.id, handle: '@human-tester', terminal_id: tid });
    const msgs = listMessagesInRoom(room.id);
    expect(msgs.filter((m) => m.kind === 'system')).toHaveLength(0);
  });

  it('does NOT re-post when addMembership is called again for same (room, handle)', async () => {
    // Per kimi's review note: second addMembership with same (room_id, handle)
    // returns the EXISTING row via the early-return branch — no INSERT fires,
    // so no second preamble. The earlier version of this test relied on the
    // UNIQUE constraint throwing, which masked the actual "early return"
    // path. We now exercise both the same-terminal case (no-op) and the
    // different-terminal case (terminal_id update, still no INSERT).
    const { createChatRoom } = await import('./chatRoomStore');
    const { listMessagesInRoom } = await import('./chatMessageStore');
    const room = createChatRoom({ name: 'join-test-3', whoCreatedIt: '@you' });
    const tid1 = makeTerminal('agent-t2');
    const tid2 = makeTerminal('agent-t2b');
    addMembership({ room_id: room.id, handle: '@speedycodex', terminal_id: tid1 });
    addMembership({ room_id: room.id, handle: '@speedycodex', terminal_id: tid1 }); // same term
    addMembership({ room_id: room.id, handle: '@speedycodex', terminal_id: tid2 }); // rebind term
    const msgs = listMessagesInRoom(room.id);
    expect(msgs.filter((m) => m.kind === 'system')).toHaveLength(1);
  });
});
