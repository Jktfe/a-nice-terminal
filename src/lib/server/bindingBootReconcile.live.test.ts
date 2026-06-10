/**
 * LIVE boot-reconcile proof (review artefact requested by @fableClaude,
 * room "ANT sorted" msg_v8sa3428q2): real tmux binary on a PRIVATE socket
 * (-L), so the colony's default tmux server is never touched. Exercises both
 * restart orders:
 *
 *   Order A (tmux died first / powercut): ANT boots while tmux is down →
 *     reconcile SKIPS, zero tombstones (no false vacancy from a dead server).
 *   Order B (tmux up, ANT restarting): reconcile diffs real list-panes
 *     output → exactly the binding whose pane was killed tombstones; live
 *     panes untouched.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { resetIdentityDbForTests } from './db';
import { bindHandle, getLiveBinding, getHandleRow } from './handleBindingsStore';
import { reconcileBindingsAtBoot, type ListPanesResult } from './bindingBootReconcile';

const SOCKET = `ant-proof-${process.pid}`;

function tmux(...args: string[]): ListPanesResult {
  const result = spawnSync('tmux', ['-L', SOCKET, ...args], { env: { ...process.env, TMUX: undefined } });
  return {
    status: result.status ?? 1,
    stdout: (result.stdout ?? Buffer.alloc(0)).toString('utf8'),
    stderr: (result.stderr ?? Buffer.alloc(0)).toString('utf8')
  };
}

const listPanesOnSocket = (): ListPanesResult => tmux('list-panes', '-a', '-F', '#{pane_id}');

const tmuxAvailable = spawnSync('tmux', ['-V']).status === 0;

let tmpDir: string;
const prev = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-boot-reconcile-live-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
});

afterEach(() => {
  tmux('kill-server');
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (prev === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = prev;
});

describe.skipIf(!tmuxAvailable)('boot reconcile against a real private tmux server', () => {
  it('Order A — ANT boots before tmux: skip, zero false tombstones', () => {
    tmux('kill-server'); // ensure the private server is down
    bindHandle({ handle: '@survivor', pane: '%0', pid: 1, pidStart: null });
    const result = reconcileBindingsAtBoot({ listPanes: listPanesOnSocket });
    expect(result.skipped).toBe(true);
    expect(result.tombstoned).toEqual([]);
    expect(getLiveBinding('@survivor')).not.toBeNull();
    expect(getHandleRow('@survivor')?.vacated_at_ms).toBeNull();
  });

  it('Order B — tmux up with real panes: only the killed pane vacates', () => {
    expect(tmux('new-session', '-d', '-s', 'proof', '-x', '80', '-y', '24').status).toBe(0);
    expect(tmux('split-window', '-t', 'proof').status).toBe(0);
    const panes = listPanesOnSocket();
    expect(panes.status).toBe(0);
    const paneIds = panes.stdout.trim().split('\n');
    expect(paneIds.length).toBe(2);
    const [alivePane, doomedPane] = paneIds;

    bindHandle({ handle: '@alive', pane: alivePane, pid: 1, pidStart: null });
    bindHandle({ handle: '@doomed', pane: doomedPane, pid: 2, pidStart: null });

    expect(tmux('kill-pane', '-t', doomedPane).status).toBe(0);

    const result = reconcileBindingsAtBoot({ listPanes: listPanesOnSocket });
    expect(result.skipped).toBe(false);
    expect(result.tombstoned).toEqual(['@doomed']);
    expect(getLiveBinding('@alive')?.pane).toBe(alivePane);
    expect(getHandleRow('@alive')?.vacated_at_ms).toBeNull();
    expect(getLiveBinding('@doomed')).toBeNull();
    expect(getHandleRow('@doomed')?.vacated_at_ms).toBeTypeOf('number');
  });
});
