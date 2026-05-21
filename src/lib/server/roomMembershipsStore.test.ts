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
