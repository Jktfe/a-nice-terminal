import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIdentityDbForTests } from './db';
import { appendLedger } from './identityLedgerStore';
import { buildSoakReport } from './soakReport';

let tmpDir: string;
const prev = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-soak-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (prev === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = prev;
});

describe('buildSoakReport — the public flatline counter', () => {
  it('counts only rows since the window start, grouped by signature', () => {
    appendLedger({ kind: 'resolver.disagreement', handle: '@old', actor: 'resolver', atMs: 1000,
      detail: { legacy_handle: '@old', witness_handle: null } });
    appendLedger({ kind: 'resolver.disagreement', handle: '@a', actor: 'resolver', atMs: 5000,
      detail: { legacy_handle: '@a', witness_handle: null } });
    appendLedger({ kind: 'resolver.disagreement', handle: '@b', actor: 'resolver', atMs: 6000,
      detail: { legacy_handle: '@b', witness_handle: '@c' } });
    appendLedger({ kind: 'resolver.disagreement', handle: '@r', actor: 'resolver', atMs: 7000,
      detail: { surface: 'register', requested_handle: '@r', granted_handle: '@r-1', contract_outcome: 'refuse' } });
    appendLedger({ kind: 'pane.uncorroborated', actor: 'daemon', atMs: 8000,
      detail: { presented_pane: '%9' } });

    const report = buildSoakReport({ sinceMs: 4000 });
    expect(report.windowStartMs).toBe(4000);
    expect(report.total).toBe(4);
    expect(report.signatures['nothing-witnessed']).toBe(1);
    expect(report.signatures['witness-mismatch']).toBe(1);
    expect(report.signatures['register-divergence']).toBe(1);
    expect(report.signatures['pane-uncorroborated']).toBe(1);
    expect(report.clean).toBe(false);
    expect(report.rows).toHaveLength(4);
  });

  it('a quiet window reports clean', () => {
    appendLedger({ kind: 'resolver.disagreement', handle: '@old', actor: 'resolver', atMs: 1000,
      detail: { legacy_handle: '@old', witness_handle: null } });
    const report = buildSoakReport({ sinceMs: 2000 });
    expect(report.total).toBe(0);
    expect(report.clean).toBe(true);
  });
});
