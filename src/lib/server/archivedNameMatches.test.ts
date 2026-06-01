import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { upsertTerminal, setTerminalStatus } from './terminalsStore';
import { listArchivedMatchesForBase } from './archivedNameMatches';
import { resetIdentityDbForTests } from './db';

let tmpDir: string;
beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-archmatch-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  process.env.ANT_MEMORY_VAULT_PATH = '/tmp/ant-memory-pack-test';
  resetIdentityDbForTests();
});
afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('listArchivedMatchesForBase', () => {
  it('returns archived terminals whose base name equals the query', () => {
    const a = upsertTerminal({ pid: 820001, pid_start: 'a', name: 'terminal3' });
    setTerminalStatus(a.id, 'archived');
    const b = upsertTerminal({ pid: 820002, pid_start: 'b', name: 'terminal3' });
    setTerminalStatus(b.id, 'archived');
    upsertTerminal({ pid: 820003, pid_start: 'c', name: 'terminal9' });
    const matches = listArchivedMatchesForBase('terminal3');
    expect(matches.map((m) => m.id).sort()).toEqual([a.id, b.id].sort());
    expect(matches.every((m) => m.base === 'terminal3')).toBe(true);
  });
  it('returns empty when no archived matches', () => {
    expect(listArchivedMatchesForBase('terminal3')).toEqual([]);
  });
});
