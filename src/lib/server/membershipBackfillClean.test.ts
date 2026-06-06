import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getIdentityDb, resetIdentityDbForTests } from './db';
import { createSession } from './antSessionStore';
import { isMember, listMembers, resolveMember } from './membershipStore';
import { backfillFromLegacy } from './membershipBackfillClean';
import { listLeases, resolveMember as resolveLeaseMember } from './roomHandleLeaseClean';

let tmpDir: string;
const prev = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-backfill-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (prev === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = prev;
});

/** Insert a legacy terminals row (FK target for room_memberships.terminal_id). */
function seedTerminal(id: string): void {
  const db = getIdentityDb();
  const now = Date.now();
  db.prepare(
    `INSERT INTO terminals (id, pid, name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, 1000 + Math.floor(Math.random() * 1000), `term-${id}`, now, now);
}

/** Insert a legacy room_memberships row. */
function seedLegacyMembership(id: string, roomId: string, handle: string, terminalId: string): void {
  const db = getIdentityDb();
  db.prepare(
    `INSERT INTO room_memberships (id, room_id, handle, terminal_id, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, roomId, handle, terminalId, Date.now());
}

describe('membershipBackfillClean — legacy room_memberships -> clean room_membership', () => {
  it('returns an all-zero report on a fresh DB (no legacy rows)', () => {
    expect(backfillFromLegacy()).toEqual({ scanned: 0, inserted: 0, skipped: 0 });
  });

  it('maps an active legacy row to the durable session bound to its terminal', () => {
    seedTerminal('t1');
    const session = createSession({ kind: 'local-cli', label: 'alice', terminalId: 't1' });
    seedLegacyMembership('m1', 'roomA', '@alice', 't1');

    const report = backfillFromLegacy();
    expect(report).toEqual({ scanned: 1, inserted: 1, skipped: 0 });
    expect(resolveMember('roomA', '@alice')).toBe(session.id);
    expect(resolveLeaseMember('roomA', '@alice')).toBe(session.id);
  });

  it('writes the membership with NULL session when no session is bound to the terminal', () => {
    seedTerminal('t2'); // terminal exists but no ant_sessions row references it
    seedLegacyMembership('m2', 'roomB', '@bob', 't2');

    const report = backfillFromLegacy();
    expect(report).toEqual({ scanned: 1, inserted: 1, skipped: 0 });
    expect(listMembers('roomB')).toHaveLength(1);
    expect(resolveMember('roomB', '@bob')).toBeNull(); // membership preserved, session unknown
    expect(listLeases('roomB')).toHaveLength(0); // no runtime yet, so no active lease can be claimed
  });

  it('skips synthetic browser-session handles before they reach the clean membership writer', () => {
    seedTerminal('t-bs');
    createSession({ kind: 'web-session', label: 'browser', terminalId: 't-bs' });
    seedLegacyMembership('m-bs', 'roomBrowser', '@browser-bs_deadbeef', 't-bs');

    const report = backfillFromLegacy();

    expect(report).toEqual({ scanned: 1, inserted: 0, skipped: 1 });
    expect(isMember('roomBrowser', '@browser-bs_deadbeef')).toBe(false);
    expect(listMembers('roomBrowser')).toHaveLength(0);
    expect(listLeases('roomBrowser')).toHaveLength(0);
  });

  it('is lossless across multiple rooms/handles', () => {
    seedTerminal('t1');
    seedTerminal('t2');
    createSession({ kind: 'local-cli', label: 'a', terminalId: 't1' });
    seedLegacyMembership('m1', 'roomA', '@alice', 't1');
    seedLegacyMembership('m2', 'roomA', '@bob', 't2');
    seedLegacyMembership('m3', 'roomB', '@alice', 't1');

    const report = backfillFromLegacy();
    expect(report.scanned).toBe(3);
    expect(report.inserted).toBe(3);
    expect(listMembers('roomA').map((m) => m.handle).sort()).toEqual(['@alice', '@bob']);
    expect(listMembers('roomB').map((m) => m.handle)).toEqual(['@alice']);
  });

  it('skips soft-revoked legacy rows (revoked_at_ms set)', () => {
    seedTerminal('t1');
    seedLegacyMembership('m1', 'roomA', '@alice', 't1');
    // soft-revoke via the ALTER-added column
    getIdentityDb()
      .prepare(`UPDATE room_memberships SET revoked_at_ms = ? WHERE id = 'm1'`)
      .run(Date.now());

    const report = backfillFromLegacy();
    expect(report.scanned).toBe(0); // revoked row not scanned
    expect(listMembers('roomA')).toHaveLength(0);
  });

  it('is idempotent — re-running upserts the same rows, count stable, no duplicates', () => {
    seedTerminal('t1');
    createSession({ kind: 'local-cli', label: 'a', terminalId: 't1' });
    seedLegacyMembership('m1', 'roomA', '@alice', 't1');

    const first = backfillFromLegacy();
    const second = backfillFromLegacy();
    expect(first).toEqual(second);
    expect(listMembers('roomA')).toHaveLength(1); // no duplicate row
    expect(listLeases('roomA')).toHaveLength(1); // no duplicate lease
  });

  it('prefers the most-recently-seen session when a terminal had several', () => {
    seedTerminal('t1');
    const older = createSession({ kind: 'local-cli', label: 'old', terminalId: 't1' });
    const newer = createSession({ kind: 'local-cli', label: 'new', terminalId: 't1' });
    // make `newer` strictly the most recently seen
    getIdentityDb().prepare(`UPDATE ant_sessions SET last_seen_at_ms = ? WHERE id = ?`).run(1, older.id);
    getIdentityDb().prepare(`UPDATE ant_sessions SET last_seen_at_ms = ? WHERE id = ?`).run(2, newer.id);
    seedLegacyMembership('m1', 'roomA', '@alice', 't1');

    backfillFromLegacy();
    expect(resolveMember('roomA', '@alice')).toBe(newer.id);
  });
});
