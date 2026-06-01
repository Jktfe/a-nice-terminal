import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIdentityDbForTests } from './db';
import {
  upsertTerminal,
  getTerminalById,
  getTerminalByName,
  lookupTerminalByPidChain,
  listAllTerminals,
  deleteTerminalById,
  sweepExpiredTerminals,
  touchLastMessageSentAt,
  touchLastPtyByteAt
} from './terminalsStore';
import { getIdentityDb } from './db';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-terminals-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
});

describe('upsertTerminal', () => {
  it('inserts a new row and returns it', () => {
    const t = upsertTerminal({ pid: 1234, pid_start: 'Tue May 13 00:00:00 2026', name: 'claude2-main' });
    expect(t.pid).toBe(1234);
    expect(t.name).toBe('claude2-main');
    expect(t.pane_status).toBe('unknown');
    expect(t.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('UPDATEs an existing row when same name is registered again', () => {
    const first = upsertTerminal({ pid: 1000, pid_start: 't1', name: 'c2' });
    const second = upsertTerminal({ pid: 2000, pid_start: 't2', name: 'c2' });
    expect(second.id).toBe(first.id);
    expect(second.pid).toBe(2000);
  });

  it('clamps ttl below 60s to 60s', () => {
    const t = upsertTerminal({ pid: 11, pid_start: null, name: 'c-ttl-low', ttlSeconds: 10 });
    expect(t.expires_at).toBeGreaterThanOrEqual(Math.floor(Date.now() / 1000) + 59);
  });

  it('clamps ttl above 24h to 24h', () => {
    const t = upsertTerminal({ pid: 12, pid_start: null, name: 'c-ttl-high', ttlSeconds: 99999999 });
    const maxExpected = Math.floor(Date.now() / 1000) + 24 * 60 * 60 + 1;
    expect(t.expires_at).toBeLessThanOrEqual(maxExpected);
  });
});

describe('getTerminalById / getTerminalByName', () => {
  it('returns null for unknown id and name', () => {
    expect(getTerminalById('nope')).toBeNull();
    expect(getTerminalByName('nope')).toBeNull();
  });

  it('returns the inserted row', () => {
    const t = upsertTerminal({ pid: 7, pid_start: 'x', name: 'lookup-test' });
    expect(getTerminalById(t.id)?.name).toBe('lookup-test');
    expect(getTerminalByName('lookup-test')?.id).toBe(t.id);
  });
});

describe('lookupTerminalByPidChain', () => {
  // 2026-05-29: pid_start is now ISO-normalised at every boundary so
  // these strings must be parseable lstart-shaped values rather than
  // arbitrary tokens. Unparseable strings collapse to null at the
  // normaliser boundary (correct behaviour — see test below) which
  // would defeat the assertions these tests are guarding.
  it('matches by (pid, pid_start) tuple', () => {
    upsertTerminal({ pid: 4242, pid_start: 'Fri 29 May 11:11:24 2026', name: 'chain-target' });
    const found = lookupTerminalByPidChain([
      { pid: 9999, pid_start: 'Fri 29 May 09:00:00 2026' },
      { pid: 4242, pid_start: 'Fri 29 May 11:11:24 2026' }
    ]);
    expect(found?.name).toBe('chain-target');
  });

  it('returns null when no chain entry matches', () => {
    upsertTerminal({ pid: 100, pid_start: 'Fri 29 May 10:00:00 2026', name: 'only-startA' });
    const result = lookupTerminalByPidChain([{ pid: 100, pid_start: 'Fri 29 May 11:00:00 2026' }]);
    expect(result).toBeNull();
  });

  it('null chain pid_start does NOT match a non-null row pid_start (PID-reuse guard)', () => {
    upsertTerminal({ pid: 555, pid_start: 'Fri 29 May 11:11:24 2026', name: 'strict-null-test' });
    const result = lookupTerminalByPidChain([{ pid: 555, pid_start: null }]);
    expect(result).toBeNull();
  });

  it('null chain pid_start matches when the row pid_start is also null', () => {
    upsertTerminal({ pid: 556, pid_start: null, name: 'both-null-test' });
    const result = lookupTerminalByPidChain([{ pid: 556, pid_start: null }]);
    expect(result?.name).toBe('both-null-test');
  });

  it('returns null for empty chain', () => {
    expect(lookupTerminalByPidChain([])).toBeNull();
  });

  // 2026-05-29 regression: pid_start is now ISO-normalised at every
  // boundary, so the same wall-clock moment expressed in different
  // locale forms must resolve to the SAME row. Before the fix, en_GB
  // ("Fri 29 May ...") and en_US ("Thu May 29 ...") strings caused
  // pidChain lookup to silently fail — the 4-hour silence forensic
  // across 19 agents.
  it('matches across locale formats (day-month vs month-day) via ISO normalisation', () => {
    upsertTerminal({
      pid: 7777,
      pid_start: 'Fri 29 May 11:11:24 2026',
      name: 'locale-regression'
    });
    const found = lookupTerminalByPidChain([
      { pid: 7777, pid_start: 'Thu May 29 11:11:24 2026' }
    ]);
    expect(found?.name).toBe('locale-regression');
  });
});

describe('listAll / delete / sweep', () => {
  it('listAllTerminals returns rows newest-first', async () => {
    upsertTerminal({ pid: 1, pid_start: 'a', name: 't-one' });
    await new Promise((r) => setTimeout(r, 1100));
    upsertTerminal({ pid: 2, pid_start: 'b', name: 't-two' });
    const rows = listAllTerminals();
    expect(rows.length).toBe(2);
    expect(rows[0].name).toBe('t-two');
  });

  it('deleteTerminalById removes the row', () => {
    const t = upsertTerminal({ pid: 99, pid_start: 'x', name: 'gone' });
    expect(deleteTerminalById(t.id)).toBe(true);
    expect(getTerminalById(t.id)).toBeNull();
  });

  it('sweepExpiredTerminals removes rows past expires_at', () => {
    upsertTerminal({ pid: 1, pid_start: 'live', name: 'fresh', ttlSeconds: 3600 });
    upsertTerminal({ pid: 2, pid_start: 'old', name: 'stale-row', ttlSeconds: 60 });
    const removed = sweepExpiredTerminals();
    expect(removed).toBe(0);
  });

  // M3.4a-v2 T3d Q5 touchpoints (cascade tertiary source).
  it('touchLastMessageSentAt bumps last_message_sent_at_ms on the row and returns true', () => {
    const t = upsertTerminal({ pid: 9001, pid_start: 'tp1', name: 'msg-touch' });
    const db = getIdentityDb();
    const before = db.prepare(`SELECT last_message_sent_at_ms FROM terminals WHERE id = ?`).get(t.id) as { last_message_sent_at_ms: number | null };
    expect(before.last_message_sent_at_ms).toBeNull();
    expect(touchLastMessageSentAt(t.id, 1_700_000_000_000)).toBe(true);
    const after = db.prepare(`SELECT last_message_sent_at_ms FROM terminals WHERE id = ?`).get(t.id) as { last_message_sent_at_ms: number };
    expect(after.last_message_sent_at_ms).toBe(1_700_000_000_000);
  });

  it('touchLastMessageSentAt returns false for unknown terminal_id and is best-effort silent', () => {
    expect(touchLastMessageSentAt('does-not-exist')).toBe(false);
  });

  it('touchLastPtyByteAt bumps last_pty_byte_at_ms on the row and returns true', () => {
    const t = upsertTerminal({ pid: 9002, pid_start: 'tp2', name: 'pty-touch' });
    const db = getIdentityDb();
    const before = db.prepare(`SELECT last_pty_byte_at_ms FROM terminals WHERE id = ?`).get(t.id) as { last_pty_byte_at_ms: number | null };
    expect(before.last_pty_byte_at_ms).toBeNull();
    expect(touchLastPtyByteAt(t.id, 1_700_000_001_000)).toBe(true);
    const after = db.prepare(`SELECT last_pty_byte_at_ms FROM terminals WHERE id = ?`).get(t.id) as { last_pty_byte_at_ms: number };
    expect(after.last_pty_byte_at_ms).toBe(1_700_000_001_000);
  });

  it('touchLastPtyByteAt returns false for unknown terminal_id (best-effort silent)', () => {
    expect(touchLastPtyByteAt('orphan')).toBe(false);
  });

  it('touchLastMessageSentAt does NOT mutate last_pty_byte_at_ms and vice versa (T3d isolation invariant)', () => {
    const t = upsertTerminal({ pid: 9003, pid_start: 'tp3', name: 'isolation' });
    touchLastMessageSentAt(t.id, 100);
    const db = getIdentityDb();
    const row = db.prepare(`SELECT last_message_sent_at_ms, last_pty_byte_at_ms FROM terminals WHERE id = ?`).get(t.id) as { last_message_sent_at_ms: number; last_pty_byte_at_ms: number | null };
    expect(row.last_message_sent_at_ms).toBe(100);
    expect(row.last_pty_byte_at_ms).toBeNull();
    touchLastPtyByteAt(t.id, 200);
    const after = db.prepare(`SELECT last_message_sent_at_ms, last_pty_byte_at_ms FROM terminals WHERE id = ?`).get(t.id) as { last_message_sent_at_ms: number; last_pty_byte_at_ms: number };
    expect(after.last_message_sent_at_ms).toBe(100);
    expect(after.last_pty_byte_at_ms).toBe(200);
  });
});
