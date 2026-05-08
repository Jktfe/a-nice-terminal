import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _clearStateReaderCache,
  readMergedAgentState,
} from '../src/fingerprint/agent-state-reader.js';
import type { AgentStatus } from '../src/lib/shared/agent-status.js';

let originalHome: string | undefined;
let homeDir: string;

const baseStatus = (): AgentStatus => ({
  state: 'ready',
  workspace: 'example',
  detectedAt: 1_000,
});

beforeEach(() => {
  originalHome = process.env.HOME;
  homeDir = mkdtempSync(join(tmpdir(), 'ant-state-reader-test-'));
  process.env.HOME = homeDir;
  _clearStateReaderCache();
});

afterEach(() => {
  _clearStateReaderCache();
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(homeDir, { recursive: true, force: true });
});

describe('agent-state-reader canonical state path', () => {
  it('merges state files from ~/.ant/state/<cli>/<session>.json', () => {
    const stateDir = join(homeDir, '.ant', 'state', 'codex-cli');
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, 'session-1.json'), JSON.stringify({
      state: 'Working',
      cwd: '/tmp/project',
      permission_mode: 'bypass permissions on',
    }));

    const merged = readMergedAgentState(
      'codex-cli',
      { sessionId: 'session-1' },
      baseStatus()
    );

    expect(merged).toMatchObject({
      state: 'busy',
      stateLabel: 'Working',
      cwd: '/tmp/project',
      permissionMode: 'bypass permissions on',
    });
    expect(merged.stateFileMtimeMs).toBeTypeOf('number');
  });

  it('ignores legacy per-CLI state directories', () => {
    const stateDir = join(homeDir, '.codex', 'state');
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, 'legacy-only.json'), JSON.stringify({
      state: 'Working',
      cwd: '/tmp/legacy-project',
      permission_mode: 'legacy permissions',
    }));

    const base = baseStatus();
    const merged = readMergedAgentState(
      'codex-cli',
      { sessionId: 'legacy-only', cwd: '/tmp/legacy-project', cwdBasename: 'legacy-project' },
      base
    );

    expect(merged).toBe(base);
    expect(merged.stateLabel).toBeUndefined();
    expect(merged.cwd).toBeUndefined();
    expect(merged.permissionMode).toBeUndefined();
    expect(merged.stateFileMtimeMs).toBeUndefined();
  });
});
