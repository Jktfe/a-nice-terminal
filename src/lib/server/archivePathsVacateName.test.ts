import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getTerminalById, upsertTerminal } from './terminalsStore';
import { autoRebindMembershipsFromStaleTerminal, addMembership } from './roomMembershipsStore';
import { resetIdentityDbForTests } from './db';

let tmpDir: string;
beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-archpaths-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  process.env.ANT_MEMORY_VAULT_PATH = '/tmp/ant-memory-pack-test';
  resetIdentityDbForTests();
});
afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('autoRebindMembershipsFromStaleTerminal vacates the old name', () => {
  it('tags the archived old terminal name', () => {
    const oldT = upsertTerminal({ pid: 810001, pid_start: 'old', name: 'speedyc' });
    const newT = upsertTerminal({ pid: 810002, pid_start: 'new', name: 'speedyc-new' });
    addMembership({ room_id: 'room-1', handle: '@speedyc', terminal_id: oldT.id });
    autoRebindMembershipsFromStaleTerminal({
      handle: '@speedyc', oldTerminalId: oldT.id, newTerminalId: newT.id, nowMs: Date.now()
    });
    expect(getTerminalById(oldT.id)?.name).toBe('[A] speedyc');
    expect(getTerminalById(oldT.id)?.status).toBe('archived');
  });
});
