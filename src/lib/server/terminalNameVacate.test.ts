import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getTerminalById,
  getLiveTerminalByName,
  setTerminalStatus,
  upsertTerminal
} from './terminalsStore';
import { createTerminalRecord, getTerminalRecord } from './terminalRecordsStore';
import { resetIdentityDbForTests } from './db';

let tmpDir: string;
beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-vacate-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  process.env.ANT_MEMORY_VAULT_PATH = '/tmp/ant-memory-pack-test';
  resetIdentityDbForTests();
});
afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
});

function hash(s: string): number {
  let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h;
}
function makeTerminal(name: string) {
  return upsertTerminal({ pid: 1_000_000 + (Math.abs(hash(name)) % 100_000),
    pid_start: name, name });
}

describe('setTerminalStatus archives by vacating the name', () => {
  it('tags terminals.name [A] <base> on archive', () => {
    const t = makeTerminal('terminal3');
    setTerminalStatus(t.id, 'archived');
    expect(getTerminalById(t.id)?.name).toBe('[A] terminal3');
    expect(getLiveTerminalByName('terminal3')).toBeNull();
  });

  it('increments to [A-2] when [A] <base> already exists', () => {
    const first = makeTerminal('terminal3');
    setTerminalStatus(first.id, 'archived');
    const second = makeTerminal('terminal3');
    setTerminalStatus(second.id, 'archived');
    expect(getTerminalById(second.id)?.name).toBe('[A-2] terminal3');
  });

  it('is idempotent — re-archiving an already-tagged row does not double-tag', () => {
    const t = makeTerminal('terminal3');
    setTerminalStatus(t.id, 'archived');
    setTerminalStatus(t.id, 'archived');
    expect(getTerminalById(t.id)?.name).toBe('[A] terminal3');
  });

  it('also vacates the matching terminal_records.name', () => {
    const t = makeTerminal('terminal3');
    createTerminalRecord({ sessionId: t.id, name: 'terminal3' });
    setTerminalStatus(t.id, 'archived');
    expect(getTerminalRecord(t.id)?.name).toBe('[A] terminal3');
    expect(getTerminalRecord(t.id)?.superseded_at_ms).not.toBeNull();
  });

  it('restores the base name on revive when the base is free', () => {
    const t = makeTerminal('terminal3');
    setTerminalStatus(t.id, 'archived');
    setTerminalStatus(t.id, 'live');
    expect(getTerminalById(t.id)?.name).toBe('terminal3');
    expect(getLiveTerminalByName('terminal3')?.id).toBe(t.id);
  });

  it('keeps the tag on revive when a live terminal already owns the base', () => {
    const archived = makeTerminal('terminal3');
    setTerminalStatus(archived.id, 'archived');
    makeTerminal('terminal3');
    setTerminalStatus(archived.id, 'live');
    expect(getTerminalById(archived.id)?.name).toBe('[A] terminal3');
  });

  it('returns false for an unknown terminalId', () => {
    expect(setTerminalStatus('nope', 'archived')).toBe(false);
  });

  it('restores terminal_records.name on revive when the base is free', () => {
    const t = makeTerminal('terminal3');
    createTerminalRecord({ sessionId: t.id, name: 'terminal3' });
    setTerminalStatus(t.id, 'archived');
    expect(getTerminalRecord(t.id)?.superseded_at_ms).not.toBeNull();
    setTerminalStatus(t.id, 'live');
    expect(getTerminalRecord(t.id)?.name).toBe('terminal3');
    expect(getTerminalRecord(t.id)?.superseded_at_ms).toBeNull();
  });

  it('does not rename on delete', () => {
    const t = makeTerminal('terminal3');
    setTerminalStatus(t.id, 'deleted');
    expect(getTerminalById(t.id)?.name).toBe('terminal3');
  });
});
