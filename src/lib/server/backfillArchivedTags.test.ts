import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getIdentityDb, resetIdentityDbForTests } from './db';
import { upsertTerminal, getTerminalById, backfillArchivedTerminalTags } from './terminalsStore';

let tmpDir: string;
beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-backfill-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  process.env.ANT_MEMORY_VAULT_PATH = '/tmp/ant-memory-pack-test';
  resetIdentityDbForTests();
});
afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
});

// Force a row into the legacy state: archived but UNTAGGED name (simulating a
// terminal archived before this feature shipped). Raw UPDATE bypasses the
// chokepoint so no tag is applied.
function archiveUntagged(id: string) {
  getIdentityDb().prepare(`UPDATE terminals SET status = 'archived' WHERE id = ?`).run(id);
}

describe('backfillArchivedTerminalTags', () => {
  it('tags archived squatters and frees their base name', () => {
    const a = upsertTerminal({ pid: 850001, pid_start: 'a', name: 'terminal3' });
    archiveUntagged(a.id);
    const tagged = backfillArchivedTerminalTags();
    expect(tagged).toBe(1);
    expect(getTerminalById(a.id)?.name).toBe('[A] terminal3');
  });

  it('assigns per-base sequence across multiple squatters', () => {
    const a = upsertTerminal({ pid: 850101, pid_start: 'a', name: 'terminal3' });
    archiveUntagged(a.id);
    backfillArchivedTerminalTags(); // a -> [A] terminal3
    const b = upsertTerminal({ pid: 850102, pid_start: 'b', name: 'terminal3' });
    archiveUntagged(b.id);
    backfillArchivedTerminalTags(); // b -> [A-2] terminal3
    expect(getTerminalById(b.id)?.name).toBe('[A-2] terminal3');
  });

  it('is idempotent — a second run tags nothing', () => {
    const a = upsertTerminal({ pid: 850201, pid_start: 'a', name: 'terminal3' });
    archiveUntagged(a.id);
    expect(backfillArchivedTerminalTags()).toBe(1);
    expect(backfillArchivedTerminalTags()).toBe(0);
  });

  it('leaves live terminals untouched', () => {
    const live = upsertTerminal({ pid: 850301, pid_start: 'a', name: 'terminal3' });
    backfillArchivedTerminalTags();
    expect(getTerminalById(live.id)?.name).toBe('terminal3');
  });
});
