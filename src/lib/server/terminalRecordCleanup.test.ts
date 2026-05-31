import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  upsertTerminal,
  getTerminalById,
  deleteTerminalById,
  sweepExpiredTerminals,
  setTerminalStatus
} from './terminalsStore';
import { createTerminalRecord, getTerminalRecord } from './terminalRecordsStore';
import { getIdentityDb, resetIdentityDbForTests } from './db';

let tmpDir: string;
beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-recclean-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  process.env.ANT_MEMORY_VAULT_PATH = '/tmp/ant-memory-pack-test';
  resetIdentityDbForTests();
});
afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('terminal delete removes the matching terminal_record', () => {
  it('deleteTerminalById removes BOTH the terminal and its record', () => {
    const t = upsertTerminal({ pid: 900001, pid_start: 'a', name: 'rec-del-1' });
    createTerminalRecord({ sessionId: t.id, name: 'rec-del-1' });
    expect(getTerminalRecord(t.id)).not.toBeNull();
    expect(deleteTerminalById(t.id)).toBe(true);
    expect(getTerminalById(t.id)).toBeNull();
    expect(getTerminalRecord(t.id)).toBeNull(); // no orphan
  });

  it('deleteTerminalById still returns true / is safe when no record exists', () => {
    const t = upsertTerminal({ pid: 900002, pid_start: 'b', name: 'rec-del-2' });
    expect(deleteTerminalById(t.id)).toBe(true);
    expect(getTerminalById(t.id)).toBeNull();
  });

  it('sweepExpiredTerminals removes the record for expired terminals too', () => {
    const t = upsertTerminal({ pid: 900003, pid_start: 'c', name: 'rec-del-3' });
    createTerminalRecord({ sessionId: t.id, name: 'rec-del-3' });
    // Force expiry (ttl min is 60s, so set expires_at into the past directly).
    getIdentityDb().prepare(`UPDATE terminals SET expires_at = 1 WHERE id = ?`).run(t.id);
    expect(sweepExpiredTerminals()).toBeGreaterThanOrEqual(1);
    expect(getTerminalById(t.id)).toBeNull();
    expect(getTerminalRecord(t.id)).toBeNull(); // no orphan
  });

  it('ARCHIVE (status flip) KEEPS the record — only renames + supersedes it', () => {
    const t = upsertTerminal({ pid: 900004, pid_start: 'd', name: 'rec-keep-4' });
    createTerminalRecord({ sessionId: t.id, name: 'rec-keep-4' });
    setTerminalStatus(t.id, 'archived');
    const rec = getTerminalRecord(t.id);
    expect(rec).not.toBeNull();                       // record kept
    expect(rec?.name).toBe('[A] rec-keep-4');          // renamed by the chokepoint
    expect(rec?.superseded_at_ms).not.toBeNull();      // superseded, not deleted
  });
});
