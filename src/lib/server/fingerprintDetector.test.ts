// fingerprintDetector unit tests — 5-source cascade, fallback semantics,
// write-back guard, remote/browser preservation, walker B1 coverage.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getIdentityDb, resetIdentityDbForTests } from './db';
import { upsertTerminal, getTerminalById, type TerminalRow } from './terminalsStore';
import {
  detectFingerprint, applyFingerprintWriteBack, makeProcessTreeFn,
  type DetectorDeps, type PsRunner
} from './fingerprintDetector';

beforeEach(() => { process.env.ANT_FRESH_DB_PATH = ':memory:'; resetIdentityDbForTests(); });
afterEach(() => { resetIdentityDbForTests(); delete process.env.ANT_FRESH_DB_PATH; });

function freshTerminal(extra: Partial<TerminalRow> = {}): TerminalRow {
  const t = upsertTerminal({ pid: 4242, pid_start: 'lstart', name: extra.name ?? 'tty1' });
  if (extra.tmux_target_pane !== undefined || extra.agent_kind !== undefined) {
    getIdentityDb().prepare(`UPDATE terminals SET tmux_target_pane = ?, agent_kind = ? WHERE id = ?`)
      .run(extra.tmux_target_pane ?? null, extra.agent_kind ?? null, t.id);
  }
  return getTerminalById(t.id) as TerminalRow;
}
const noopDeps: DetectorDeps = { processTreeFn: () => [], tmuxTitleFn: () => null,
  captureFn: () => null, driverVersionFn: () => '0.0.0' };

describe('detectFingerprint — source cascade', () => {
  it('source 1 process-tree match → HIGH confidence + driver populated', () => {
    const t = freshTerminal();
    const deps: DetectorDeps = { ...noopDeps,
      processTreeFn: () => [{ binary: 'claude', comm: 'claude' }, { binary: 'zsh', comm: 'zsh' }],
      driverVersionFn: () => '0.42.1' };
    const r = detectFingerprint(t, deps);
    expect(r.kind).toBe('claude_code');
    expect(r.confidence).toBe('high');
    expect(r.driver).toEqual({ binary: 'claude', version: '0.42.1' });
    expect(r.evidence.source).toBe('process-tree');
  });

  it('B1 fix: ancestor agent at depth 2 in ppid chain still detected as HIGH', () => {
    const t = freshTerminal();
    const r = detectFingerprint(t, { ...noopDeps,
      processTreeFn: () => [{ binary: 'zsh', comm: 'zsh' }, { binary: 'zsh', comm: 'zsh' }, { binary: 'claude', comm: 'claude' }],
      driverVersionFn: () => '0.42.1' });
    expect(r.kind).toBe('claude_code');
    expect(r.confidence).toBe('high');
    expect(r.evidence.detail).toBe('claude');
  });

  it('source 2 tmux-title fallback when process-tree empty → MEDIUM', () => {
    const t = freshTerminal({ tmux_target_pane: '%1' });
    const r = detectFingerprint(t, { ...noopDeps, tmuxTitleFn: () => 'Codex CLI' });
    expect(r.kind).toBe('codex_cli');
    expect(r.confidence).toBe('medium');
    expect(r.evidence.source).toBe('tmux-title');
  });

  it('terminal-record source beats noisy pane text for registered non-Claude/Codex CLIs', () => {
    const t = freshTerminal({ tmux_target_pane: '%1' });
    const r = detectFingerprint(t, {
      ...noopDeps,
      terminalRecordKindFn: () => 'qwen',
      tmuxTitleFn: () => 'Claude and Codex discussed in this room',
      captureFn: () => 'Claude Code quoted a Codex answer'
    });
    expect(r.kind).toBe('qwen');
    expect(r.confidence).toBe('high');
    expect(r.evidence.source).toBe('terminal-record');
  });

  it.each([
    ['claude', 'claude_code'],
    ['codex', 'codex_cli'],
    ['agy', 'antigravity'],
    ['antigravity', 'antigravity'],
    ['pi', 'pi'],
    ['qwen', 'qwen'],
    ['copilot', 'copilot']
  ] as const)('normalizes terminal-record kind %s → %s', (raw, expected) => {
    const t = freshTerminal();
    const r = detectFingerprint(t, { ...noopDeps, terminalRecordKindFn: () => raw });
    expect(r.kind).toBe(expected);
    expect(r.confidence).toBe('high');
    expect(r.evidence.detail).toBe(raw);
  });

  it('source 3 capture-fn match → MEDIUM (cursor banner)', () => {
    const t = freshTerminal({ tmux_target_pane: '%2' });
    const r = detectFingerprint(t, { ...noopDeps, captureFn: () => 'Welcome to cursor v0.1' });
    expect(r.kind).toBe('cursor');
    expect(r.confidence).toBe('medium');
    expect(r.evidence.source).toBe('capture-fn');
  });

  it('source 4 name-only match → LOW confidence', () => {
    const t = freshTerminal({ name: 'gemini-3' });
    const r = detectFingerprint(t, noopDeps);
    expect(r.kind).toBe('gemini');
    expect(r.confidence).toBe('low');
    expect(r.evidence.source).toBe('name');
  });

  it('source 5 default → kind=unknown when no signals at all', () => {
    const t = freshTerminal({ name: 'shell-1' });
    const r = detectFingerprint(t, noopDeps);
    expect(r.kind).toBe('unknown');
    expect(r.confidence).toBe('low');
    expect(r.evidence.source).toBe('default');
  });
});

describe('detectFingerprint — fallback string (B4 lock)', () => {
  it('HIGH primary still populates fallback from next source', () => {
    const t = freshTerminal();
    const r = detectFingerprint(t, { ...noopDeps,
      processTreeFn: () => [{ binary: 'claude', comm: 'claude' }],
      terminalRecordKindFn: () => 'codex' });
    expect(r.fallback).toContain('terminal-record:codex_cli@high');
  });

  it('empty fallback when primary is the last cascade source (name)', () => {
    const t = freshTerminal({ name: 'aider-1' });
    const r = detectFingerprint(t, noopDeps);
    expect(r.fallback).toBe('');
  });

  it('B2 fix v2: fallback NAMES the immediately-next source even when it returns null (never scans further)', () => {
    const t = freshTerminal({ tmux_target_pane: '%9' });
    const r = detectFingerprint(t, { ...noopDeps,
      processTreeFn: () => [{ binary: 'claude', comm: 'claude' }],
      tmuxTitleFn: () => null,
      captureFn: () => 'codex banner — should NOT be reached' });
    expect(r.kind).toBe('claude_code');
    expect(r.fallback).toBe('terminal-record:none');
  });
});

describe('makeProcessTreeFn / defaultPsRunner — walker semantics (B1 coverage)', () => {
  it('walks pid → ppid chain via repeated psRunner calls until ppid<=1', () => {
    const tree: Record<number, { ppid: number; comm: string }> = {
      4242: { ppid: 3333, comm: 'zsh' }, 3333: { ppid: 2222, comm: 'zsh' }, 2222: { ppid: 1, comm: 'claude' } };
    const calls: number[] = [];
    const ps: PsRunner = (pid) => { calls.push(pid); return tree[pid] ?? null; };
    expect(makeProcessTreeFn(ps)(4242).map((e) => e.comm)).toEqual(['zsh', 'zsh', 'claude']);
    expect(calls).toEqual([4242, 3333, 2222]);
  });
  it('cycle guard stops on loops; depth guard bounded at 32; null breaks the walk', () => {
    const cyc: Record<number, { ppid: number; comm: string }> = { 100: { ppid: 200, comm: 'a' }, 200: { ppid: 100, comm: 'b' } };
    expect(makeProcessTreeFn((p) => cyc[p] ?? null)(100).length).toBe(2);
    expect(makeProcessTreeFn((p) => ({ ppid: p + 1, comm: `p${p}` }))(1000).length).toBe(32);
    const stopMid: PsRunner = (pid) => pid === 4242 ? { ppid: 3333, comm: 'zsh' } : null;
    expect(makeProcessTreeFn(stopMid)(4242)).toEqual([{ binary: 'zsh', comm: 'zsh' }]);
  });
});

describe('applyFingerprintWriteBack — Q5 explicit-opt-in lock', () => {
  it('writeBack ON + HIGH confidence updates agent_kind + meta', () => {
    const t = freshTerminal();
    const r = detectFingerprint(t, { ...noopDeps,
      processTreeFn: () => [{ binary: 'claude', comm: 'claude' }] });
    applyFingerprintWriteBack(t, r);
    const after = getTerminalById(t.id) as TerminalRow;
    expect(after.agent_kind).toBe('claude_code');
    expect(JSON.parse(after.meta).fingerprint_confidence).toBe('high');
  });

  it('writeBack ON + MEDIUM does NOT change agent_kind, meta-only', () => {
    const t = freshTerminal({ tmux_target_pane: '%3' });
    const r = detectFingerprint(t, { ...noopDeps, tmuxTitleFn: () => 'Aider' });
    applyFingerprintWriteBack(t, r);
    const after = getTerminalById(t.id) as TerminalRow;
    expect(after.agent_kind).toBeNull();
    expect(JSON.parse(after.meta).fingerprint_confidence).toBe('medium');
  });

  it('writeBack ON + remote terminal stays remote (Q2 preservation)', () => {
    const t = freshTerminal({ agent_kind: 'remote' });
    const r = detectFingerprint(t, { ...noopDeps,
      processTreeFn: () => [{ binary: 'claude', comm: 'claude' }] });
    applyFingerprintWriteBack(t, r);
    const after = getTerminalById(t.id) as TerminalRow;
    expect(after.agent_kind).toBe('remote');
  });

  it('writeBack ON + browser terminal stays browser (Q2 preservation)', () => {
    const t = freshTerminal({ agent_kind: 'browser' });
    const r = detectFingerprint(t, { ...noopDeps,
      processTreeFn: () => [{ binary: 'codex', comm: 'codex' }] });
    applyFingerprintWriteBack(t, r);
    const after = getTerminalById(t.id) as TerminalRow;
    expect(after.agent_kind).toBe('browser');
  });

  it('detectFingerprint itself does NOT mutate (writeBack OFF default)', () => {
    const t = freshTerminal();
    detectFingerprint(t, { ...noopDeps,
      processTreeFn: () => [{ binary: 'claude', comm: 'claude' }] });
    const after = getTerminalById(t.id) as TerminalRow;
    expect(after.agent_kind).toBeNull();
    expect(after.meta).toBe('{}');
  });

  it('M3.2c B2: applyFingerprintWriteBack content-hash debounce no-ops on unchanged evidence', () => {
    const t = freshTerminal();
    const r = detectFingerprint(t, { ...noopDeps, processTreeFn: () => [{ binary: 'claude', comm: 'claude' }] });
    applyFingerprintWriteBack(t, r);
    const afterFirst = getTerminalById(t.id) as TerminalRow;
    applyFingerprintWriteBack(afterFirst, r); // re-apply same evidence; debounce skips write entirely
    expect((getTerminalById(t.id) as TerminalRow).updated_at).toBe(afterFirst.updated_at);
  });
});
