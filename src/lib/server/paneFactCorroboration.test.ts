import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIdentityDbForTests } from './db';
import { listLedger } from './identityLedgerStore';
import { corroboratePaneFact } from './paneFactCorroboration';

let tmpDir: string;
const prev = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-pane-corroborate-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (prev === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = prev;
});

const panesListing = (lines: string[]) => () => ({
  status: 0,
  stdout: lines.join('\n') + '\n',
  stderr: ''
});

describe('corroboratePaneFact — the daemon verifies, never trusts', () => {
  it('corroborates when the presented pane hosts a pid from the caller chain', () => {
    const result = corroboratePaneFact('%41', [{ pid: 9001, pid_start: null }, { pid: 700, pid_start: null }], {
      listPanePids: panesListing(['%40 123', '%41 700'])
    });
    expect(result).toEqual({ pane: '%41', corroborated: true });
    expect(listLedger({})).toHaveLength(0);
  });

  it('treats a pane the caller does not occupy as ABSENT and ledgers the spoof signature', () => {
    const result = corroboratePaneFact('%41', [{ pid: 9001, pid_start: null }], {
      listPanePids: panesListing(['%41 700', '%42 9001'])
    });
    expect(result).toEqual({ pane: null, corroborated: false });
    const rows = listLedger({}).filter((e) => e.kind === 'pane.uncorroborated');
    expect(rows).toHaveLength(1);
    expect(rows[0].detail).toMatchObject({
      presented_pane: '%41',
      pane_pid: 700,
      caller_pids: [9001]
    });
  });

  it('treats an unknown pane as ABSENT and ledgers it', () => {
    const result = corroboratePaneFact('%99', [{ pid: 9001, pid_start: null }], {
      listPanePids: panesListing(['%41 700'])
    });
    expect(result).toEqual({ pane: null, corroborated: false });
    expect(listLedger({}).filter((e) => e.kind === 'pane.uncorroborated')).toHaveLength(1);
  });

  it('tmux unreachable → absent WITHOUT a spoof row (no evidence either way)', () => {
    const result = corroboratePaneFact('%41', [{ pid: 700, pid_start: null }], {
      listPanePids: () => ({ status: 1, stdout: '', stderr: 'no server running' })
    });
    expect(result).toEqual({ pane: null, corroborated: false });
    expect(listLedger({})).toHaveLength(0);
  });

  it('no pane presented → absent, silent', () => {
    const result = corroboratePaneFact(null, [{ pid: 700, pid_start: null }], {
      listPanePids: panesListing(['%41 700'])
    });
    expect(result).toEqual({ pane: null, corroborated: false });
    expect(listLedger({})).toHaveLength(0);
  });
});
