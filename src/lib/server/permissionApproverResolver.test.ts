import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getIdentityDb, resetIdentityDbForTests } from './db';
import { bindHandle } from './handleBindingsStore';
import { resolveApproversFor } from './permissionApproverResolver';

let tmpDir: string;
const prev = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-approver-resolver-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (prev === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = prev;
});

describe('resolveApproversFor — handle targets (AC3 Step 3 scaffolding)', () => {
  it('returns the handle owners[] from the clean core, first owner preferred', () => {
    bindHandle({ handle: '@dave', pane: '%1', pid: 1, pidStart: null });
    getIdentityDb()
      .prepare(`UPDATE handles SET owners = ? WHERE handle = ?`)
      .run(JSON.stringify(['@JWPK', '@extracheck']), '@dave');
    expect(resolveApproversFor({ targetKind: 'handle', targetId: '@dave' })).toEqual([
      { handle: '@JWPK', role: 'owner', preferred: true },
      { handle: '@extracheck', role: 'owner', preferred: false }
    ]);
  });

  it('returns [] for an unknown handle or a handle with no owners yet', () => {
    expect(resolveApproversFor({ targetKind: 'handle', targetId: '@ghost' })).toEqual([]);
    bindHandle({ handle: '@orphan', pane: '%2', pid: 2, pidStart: null });
    expect(resolveApproversFor({ targetKind: 'handle', targetId: '@orphan' })).toEqual([]);
  });
});
