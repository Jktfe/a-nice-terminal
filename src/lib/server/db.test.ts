import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getIdentityDb, resetIdentityDbForTests } from './db';

let tmpDir: string;
let dbFile: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-freshdb-'));
  dbFile = join(tmpDir, 'test.db');
  process.env.ANT_FRESH_DB_PATH = dbFile;
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
});

describe('getIdentityDb', () => {
  it('creates the db file + applies schema on first call', () => {
    const db = getIdentityDb();
    const tableNames = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all()
      .map((row) => (row as { name: string }).name);
    expect(tableNames).toContain('terminals');
    expect(tableNames).toContain('room_memberships');
  });

  it('returns the SAME instance on subsequent calls (globalThis singleton)', () => {
    const first = getIdentityDb();
    const second = getIdentityDb();
    expect(second).toBe(first);
  });

  it('schema migration is idempotent (re-run does not error)', () => {
    const first = getIdentityDb();
    resetIdentityDbForTests();
    const second = getIdentityDb();
    expect(second).not.toBe(first);
    const cols = second
      .prepare(`PRAGMA table_info(terminals)`)
      .all() as { name: string }[];
    expect(cols.some((c) => c.name === 'name')).toBe(true);
    expect(cols.some((c) => c.name === 'tmux_target_pane')).toBe(true);
  });
});
