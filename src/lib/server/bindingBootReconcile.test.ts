import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIdentityDbForTests } from './db';
import { bindHandle, getLiveBinding, getHandleRow } from './handleBindingsStore';
import { listLedger } from './identityLedgerStore';
import { reconcileBindingsAtBoot } from './bindingBootReconcile';

let tmpDir: string;
const prev = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-boot-reconcile-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (prev === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = prev;
});

const tmuxListing = (panes: string[]) => () => ({
  status: 0,
  stdout: panes.join('\n') + (panes.length ? '\n' : ''),
  stderr: ''
});

const tmuxDown = () => ({
  status: 1,
  stdout: '',
  stderr: 'no server running on /private/tmp/tmux-501/default'
});

describe('reconcileBindingsAtBoot', () => {
  it('tombstones bindings whose pane is absent and leaves observed panes alone (powercut case)', () => {
    bindHandle({ handle: '@alive', pane: '%1', pid: 1, pidStart: null });
    bindHandle({ handle: '@dead', pane: '%9', pid: 2, pidStart: null });
    const result = reconcileBindingsAtBoot({ listPanes: tmuxListing(['%1', '%2']) });
    expect(result.skipped).toBe(false);
    expect(result.tombstoned).toEqual(['@dead']);
    expect(getLiveBinding('@alive')?.pane).toBe('%1');
    expect(getLiveBinding('@dead')).toBeNull();
    expect(getHandleRow('@dead')?.vacated_at_ms).toBeTypeOf('number');
    const kinds = listLedger({ handle: '@dead' }).map((e) => e.kind);
    expect(kinds).toContain('binding.tombstoned');
  });

  it('skips entirely when tmux is unreachable — absence of evidence is not evidence', () => {
    bindHandle({ handle: '@alive', pane: '%1', pid: 1, pidStart: null });
    const result = reconcileBindingsAtBoot({ listPanes: tmuxDown });
    expect(result.skipped).toBe(true);
    expect(result.tombstoned).toEqual([]);
    expect(getLiveBinding('@alive')?.pane).toBe('%1');
    expect(getHandleRow('@alive')?.vacated_at_ms).toBeNull();
  });

  it('never touches pane-less bindings (nothing was witnessed about them)', () => {
    bindHandle({ handle: '@paneless', pane: null, pid: 3, pidStart: null });
    const result = reconcileBindingsAtBoot({ listPanes: tmuxListing(['%1']) });
    expect(result.tombstoned).toEqual([]);
    expect(getLiveBinding('@paneless')).not.toBeNull();
  });

  it('an empty tmux server (zero panes listed) tombstones every pane-bound binding', () => {
    bindHandle({ handle: '@a', pane: '%1', pid: 1, pidStart: null });
    bindHandle({ handle: '@b', pane: '%2', pid: 2, pidStart: null });
    const result = reconcileBindingsAtBoot({ listPanes: tmuxListing([]) });
    expect(result.skipped).toBe(false);
    expect(result.tombstoned.sort()).toEqual(['@a', '@b']);
  });
});
