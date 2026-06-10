import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getIdentityDb, resetIdentityDbForTests } from './db';
import { appendLedger, listLedger } from './identityLedgerStore';

let tmpDir: string;
const prev = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-identity-ledger-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (prev === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = prev;
});

describe('identityLedgerStore — append-only', () => {
  it('appendLedger writes a row and listLedger reads it back newest-first', () => {
    appendLedger({ kind: 'binding.claimed', handle: '@dave', actor: 'daemon', detail: { pane: '%1' } });
    appendLedger({ kind: 'binding.tombstoned', handle: '@dave', actor: 'daemon', detail: { reason: 'pane-not-found' } });
    const rows = listLedger({ handle: '@dave' });
    expect(rows).toHaveLength(2);
    expect(rows[0].kind).toBe('binding.tombstoned');
    expect(rows[0].detail).toEqual({ reason: 'pane-not-found' });
    expect(rows[1].kind).toBe('binding.claimed');
  });

  it('listLedger filters by handle and respects limit', () => {
    appendLedger({ kind: 'binding.claimed', handle: '@a', actor: 'daemon' });
    appendLedger({ kind: 'binding.claimed', handle: '@b', actor: 'daemon' });
    appendLedger({ kind: 'binding.superseded', handle: '@a', actor: 'daemon' });
    expect(listLedger({ handle: '@a' })).toHaveLength(2);
    expect(listLedger({ handle: '@a', limit: 1 })).toHaveLength(1);
    expect(listLedger({})).toHaveLength(3);
  });

  it('the ledger table refuses UPDATE and DELETE (append-only triggers)', () => {
    appendLedger({ kind: 'binding.claimed', handle: '@dave', actor: 'daemon' });
    const db = getIdentityDb();
    expect(() => db.prepare(`UPDATE identity_ledger SET kind = 'forged'`).run()).toThrow();
    expect(() => db.prepare(`DELETE FROM identity_ledger`).run()).toThrow();
  });
});

describe('clean-core schema exists with safe defaults', () => {
  it('handles is a fresh table with owners, approval, vacated_at_ms, lineage', () => {
    const cols = (getIdentityDb().prepare(`PRAGMA table_info(handles)`).all() as { name: string }[])
      .map((c) => c.name);
    expect(cols).toContain('handle');
    expect(cols).toContain('owners');
    expect(cols).toContain('approval');
    expect(cols).toContain('vacated_at_ms');
    expect(cols).toContain('created_by');
  });

  it('chat_rooms has owners and approval', () => {
    const cols = (getIdentityDb().prepare(`PRAGMA table_info(chat_rooms)`).all() as { name: string }[])
      .map((c) => c.name);
    expect(cols).toContain('owners');
    expect(cols).toContain('approval');
  });
});
