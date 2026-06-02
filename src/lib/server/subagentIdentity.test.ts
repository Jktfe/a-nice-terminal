import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIdentityDbForTests } from './db';
import { createSession } from './antSessionStore';
import { createRoomHandleLease } from './roomHandleLeaseStore';
import { createSubagentSession, mintSubagentLease, isSubagentOf } from './subagentIdentity';

let tmpDir: string;
const prev = process.env.ANT_FRESH_DB_PATH;
const ROOM = 'room-sub';

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-sub-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (prev === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = prev;
});

describe('subagentIdentity (C3) — child identity + namespaced lease', () => {
  it('creates a subagent as a child of its parent', () => {
    const parent = createSession({ kind: 'local-cli', label: 'auto:speedy' });
    const sub = createSubagentSession({ parentSessionId: parent.id, label: 'reviewer' });
    expect(sub.kind).toBe('subagent');
    expect(sub.parent_session_id).toBe(parent.id);
    expect(isSubagentOf(sub.id, parent.id)).toBe(true);
    expect(isSubagentOf(parent.id, parent.id)).toBe(false); // parent is not its own subagent
  });

  it('cannot orphan a subagent (parent must exist)', () => {
    expect(() => createSubagentSession({ parentSessionId: 'ghost' })).toThrow(/does not exist/);
  });

  it('mints a namespaced @parent/role lease bound to the subagent session', () => {
    const parent = createSession({ kind: 'local-cli', label: 'auto:speedy' });
    const sub = createSubagentSession({ parentSessionId: parent.id, label: 'reviewer' });
    const lease = mintSubagentLease({ roomId: ROOM, subagentSessionId: sub.id, parentHandle: '@speedy', role: 'reviewer' });
    expect(lease.sessionId).toBe(sub.id); // attributable to the child, not the parent
    expect(lease.handle).toContain('speedy');
    expect(lease.handle).toContain('reviewer'); // @parent/role shape
  });

  it('collision on the same parent/role gets an integer suffix (still unique, still attributable)', () => {
    const parent = createSession({ kind: 'local-cli', label: 'auto:speedy' });
    const subA = createSubagentSession({ parentSessionId: parent.id, label: 'reviewer-a' });
    const subB = createSubagentSession({ parentSessionId: parent.id, label: 'reviewer-b' });
    const a = mintSubagentLease({ roomId: ROOM, subagentSessionId: subA.id, parentHandle: '@speedy', role: 'reviewer' });
    const b = mintSubagentLease({ roomId: ROOM, subagentSessionId: subB.id, parentHandle: '@speedy', role: 'reviewer' });
    expect(b.handle).not.toBe(a.handle); // suffix resolves the collision
    expect(b.sessionId).toBe(subB.id);
  });
});
