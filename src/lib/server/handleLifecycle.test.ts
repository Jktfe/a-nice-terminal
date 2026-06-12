import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getIdentityDb, resetIdentityDbForTests } from './db';
import { claimHandle, isMember } from './roomHandleLeaseClean';
import { bindHandle, getLiveBinding } from './handleBindingsStore';
import { listLedger } from './identityLedgerStore';
import { retireHandle } from './handleLifecycle';

let tmpDir: string;
const prev = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-handle-lifecycle-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (prev === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = prev;
});

function activeLeaseCount(handle: string): number {
  return (
    getIdentityDb()
      .prepare(`SELECT COUNT(*) AS n FROM room_handle_lease WHERE handle = ? AND active = 1`)
      .get(handle) as { n: number }
  ).n;
}

describe('retireHandle — the RETIRE verb (JWPK ruling msg_as5tbdtaf9, 2026-06-12)', () => {
  it('retires every active room claim, tombstones the binding, and ledgers the act', () => {
    claimHandle('room-a', '@straggler', 'sess-1');
    claimHandle('room-b', '@straggler', 'sess-1');
    claimHandle('room-c', '@straggler', 'sess-1');
    bindHandle({ handle: '@straggler', pane: '%5', pid: 4242, pidStart: 'x', terminalId: 't_str' });
    expect(activeLeaseCount('@straggler')).toBe(3);
    expect(getLiveBinding('@straggler')).not.toBeNull();

    const res = retireHandle('@straggler', { reason: 'operator-retire', actor: '@JWPK' });

    expect(res.roomsRetired).toBe(3);
    expect(res.bindingTombstoned).toBe(true);
    expect(activeLeaseCount('@straggler')).toBe(0);
    expect(getLiveBinding('@straggler')).toBeNull();

    const retired = listLedger({}).filter(
      (e) => e.kind === 'handle.retired' && e.handle === '@straggler'
    );
    expect(retired).toHaveLength(1);
  });

  it('is a safe summary when the handle holds nothing (idempotent re-retire)', () => {
    const res = retireHandle('@ghost', { reason: 'operator-retire', actor: '@JWPK' });
    expect(res.roomsRetired).toBe(0);
    expect(res.bindingTombstoned).toBe(false);
    expect(activeLeaseCount('@ghost')).toBe(0);
  });

  it('the retired handle stops being a posting identity (isMember false after retire)', () => {
    claimHandle('room-x', '@temp', 'sess-9');
    expect(isMember('room-x', 'sess-9')).toBe(true);

    retireHandle('@temp', { reason: 'operator-retire', actor: '@JWPK' });

    expect(isMember('room-x', 'sess-9')).toBe(false);
    expect(activeLeaseCount('@temp')).toBe(0);
  });

  it('accepts a bare (no-@) handle and canonicalises it', () => {
    claimHandle('room-q', '@bare', 'sess-2');
    const res = retireHandle('bare', { reason: 'operator-retire', actor: '@JWPK' });
    expect(res.handle).toBe('@bare');
    expect(res.roomsRetired).toBe(1);
    expect(activeLeaseCount('@bare')).toBe(0);
  });
});
