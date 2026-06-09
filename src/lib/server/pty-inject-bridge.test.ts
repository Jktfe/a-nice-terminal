import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIdentityDbForTests } from './db';
import { upsertTerminal, updatePaneTarget, getTerminalById } from './terminalsStore';
import {
  setSpawnImplForTests,
  resetBridgeStateForTests,
  verifyPaneTargetState,
  twoCallSubmit,
  injectToTerminal,
  shouldEmitStaleMarker
} from './pty-inject-bridge';

let tmpDir: string;
const previousDbPath = process.env.ANT_FRESH_DB_PATH;

type SpawnCall = { bin: string; args: string[]; input?: string; env: NodeJS.ProcessEnv };

function fakeSpawnReturning(stdout: string, status = 0) {
  return (bin: string, args: string[], options: { input?: string | Buffer; env: NodeJS.ProcessEnv }) => {
    return {
      pid: 1,
      stdout: Buffer.from(stdout),
      stderr: Buffer.alloc(0),
      status,
      signal: null,
      output: []
    } as any;
  };
}

function fakeSpawnSequence(results: Array<{ stdout?: string; status: number }>) {
  let i = 0;
  return (_bin: string, _args: string[], _options: { input?: string | Buffer; env: NodeJS.ProcessEnv }) => {
    const r = results[Math.min(i, results.length - 1)];
    i += 1;
    return { pid: 1, stdout: Buffer.from(r.stdout ?? ''), stderr: Buffer.alloc(0), status: r.status, signal: null, output: [] } as any;
  };
}

function captureSpawnCalls(): { calls: SpawnCall[]; impl: (b: string, a: string[], o: any) => any } {
  const calls: SpawnCall[] = [];
  return {
    calls,
    impl: (bin, args, options) => {
      calls.push({ bin, args, input: typeof options.input === 'string' ? options.input : options.input?.toString('utf8'), env: options.env });
      return { pid: 1, stdout: Buffer.from('│ >\nready'), stderr: Buffer.alloc(0), status: 0, signal: null, output: [] } as any;
    }
  };
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-bridge-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
  resetBridgeStateForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  resetBridgeStateForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousDbPath === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousDbPath;
});

function registerPaneTerminal(name: string, agentKind: string | null = 'claude_code') {
  const t = upsertTerminal({ pid: 100, pid_start: 'pstart', name });
  updatePaneTarget(t.id, '%23', agentKind);
  return getTerminalById(t.id)!;
}

describe('runScrubbedTmux env scrub (via verifyPaneTargetState)', () => {
  it('deletes TMUX / TMUX_PANE / TMUX_PLUGIN_MANAGER_PATH from child env', () => {
    process.env.TMUX = '/tmp/tmux-fake,123,4';
    process.env.TMUX_PANE = '%99';
    process.env.TMUX_PLUGIN_MANAGER_PATH = '/some/path';
    const { calls, impl } = captureSpawnCalls();
    setSpawnImplForTests(impl);
    const t = registerPaneTerminal('env-scrub-test');
    verifyPaneTargetState(t);
    expect(calls.length).toBeGreaterThan(0);
    const env = calls[0].env as Record<string, string | undefined>;
    expect(env.TMUX).toBeUndefined();
    expect(env.TMUX_PANE).toBeUndefined();
    expect(env.TMUX_PLUGIN_MANAGER_PATH).toBeUndefined();
    delete process.env.TMUX;
    delete process.env.TMUX_PANE;
    delete process.env.TMUX_PLUGIN_MANAGER_PATH;
  });
});

describe('verifyPaneTargetState', () => {
  it('returns stale + marks pane stale when capture-pane errors', () => {
    setSpawnImplForTests(fakeSpawnReturning('', 1));
    const t = registerPaneTerminal('stale-test');
    expect(verifyPaneTargetState(t)).toBe('stale');
    expect(getTerminalById(t.id)?.pane_status).toBe('stale');
  });

  it('retries capture-pane once: a transient first-failure then a successful retry → verified, NOT stale (the false-offline fix)', () => {
    // A busy pane mid-render (e.g. an agent streaming a slow cloud-model turn)
    // makes capture-pane transiently exit non-zero. The retry succeeds, so the
    // verifiably-alive agent must NOT be flagged stale/offline.
    setSpawnImplForTests(fakeSpawnSequence([
      { status: 1 },                                   // transient failure
      { stdout: 'some lines\n│ > \nmore', status: 0 }  // retry succeeds, ready
    ]));
    const t = registerPaneTerminal('transient-stale-recovers');
    expect(verifyPaneTargetState(t)).toBe('verified');
    expect(getTerminalById(t.id)?.pane_status).toBe('verified'); // not marked stale
  });

  it('still returns stale when capture-pane fails on BOTH the initial attempt and the retry (genuinely-gone pane)', () => {
    setSpawnImplForTests(fakeSpawnSequence([{ status: 1 }, { status: 1 }]));
    const t = registerPaneTerminal('genuinely-stale');
    expect(verifyPaneTargetState(t)).toBe('stale');
    expect(getTerminalById(t.id)?.pane_status).toBe('stale');
  });

  it('returns unknown when capture-pane succeeds but output is empty', () => {
    setSpawnImplForTests(fakeSpawnReturning('', 0));
    const t = registerPaneTerminal('empty-output-test');
    expect(verifyPaneTargetState(t)).toBe('unknown');
    expect(getTerminalById(t.id)?.pane_status).toBe('unknown');
  });

  it('returns verified for claude_code panes whose capture contains │ > and not esc to interrupt', () => {
    setSpawnImplForTests(fakeSpawnReturning('some lines\n│ > \nmore', 0));
    const t = registerPaneTerminal('ready-cc');
    expect(verifyPaneTargetState(t)).toBe('verified');
    expect(getTerminalById(t.id)?.pane_status).toBe('verified');
  });

  it('returns verified for claude_code panes with current TUI prompt indicator ❯', () => {
    setSpawnImplForTests(fakeSpawnReturning('Waiting...\n❯ \n', 0));
    const t = registerPaneTerminal('ready-cc-chevron');
    expect(verifyPaneTargetState(t)).toBe('verified');
  });

  it('returns unknown when claude_code pane shows esc to interrupt (streaming)', () => {
    setSpawnImplForTests(fakeSpawnReturning('│ >\nesc to interrupt', 0));
    const t = registerPaneTerminal('streaming-cc');
    expect(verifyPaneTargetState(t)).toBe('unknown');
    expect(getTerminalById(t.id)?.pane_status).not.toBe('verified');
  });

  it('returns unknown when claude_code pane has ❯ but is streaming (esc to interrupt)', () => {
    setSpawnImplForTests(fakeSpawnReturning('❯ working...\nesc to interrupt', 0));
    const t = registerPaneTerminal('streaming-cc-chevron');
    expect(verifyPaneTargetState(t)).toBe('unknown');
  });

  it('returns verified for non-claude_code agent_kind when capture succeeds (T1c)', () => {
    // T1c (2026-05-14): non-claude_code agents have no per-CLI ready-state
    // semantics, so default to verified — matches v3 PtyInjectionAdapter
    // behaviour (unconditional inject). claude_code keeps prompt-aware verify.
    setSpawnImplForTests(fakeSpawnReturning('user> something', 0));
    const t = registerPaneTerminal('codex-test', 'codex');
    expect(verifyPaneTargetState(t)).toBe('verified');
  });
});

describe('twoCallSubmit', () => {
  it('emits paste then Enter at +150ms for non-claude_code', () => {
    const { calls, impl } = captureSpawnCalls();
    setSpawnImplForTests(impl);
    const schedules: { ms: number }[] = [];
    const scheduler = (cb: () => void, ms: number) => { schedules.push({ ms }); cb(); return 0 as any; };
    const failures: unknown[] = [];
    twoCallSubmit('%1', 'hello', 'codex', (c) => failures.push(c), scheduler);
    const argSets = calls.map((c) => c.args.join(' '));
    expect(argSets.some((a) => a.startsWith('load-buffer'))).toBe(true);
    expect(argSets.some((a) => a.startsWith('paste-buffer'))).toBe(true);
    expect(argSets.some((a) => a.startsWith('send-keys'))).toBe(true);
    expect(schedules[0].ms).toBe(150);
    expect(schedules.length).toBe(1);
    expect(failures.length).toBe(0);
  });

  it('emits paste then DOUBLE Enter at +150 and +300 for claude_code', () => {
    const { calls, impl } = captureSpawnCalls();
    setSpawnImplForTests(impl);
    const schedules: { ms: number }[] = [];
    const scheduler = (cb: () => void, ms: number) => { schedules.push({ ms }); cb(); return 0 as any; };
    twoCallSubmit('%1', 'hello', 'claude_code', () => {}, scheduler);
    const sendKeysCalls = calls.filter((c) => c.args[0] === 'send-keys');
    expect(sendKeysCalls.length).toBe(2);
    expect(schedules[0].ms).toBe(150);
    expect(schedules[1].ms).toBe(150);
  });

  it('async send-keys failure routes through onScheduledFailure (not silent)', () => {
    let callIdx = 0;
    setSpawnImplForTests((bin, args) => {
      callIdx += 1;
      // 1=load-buffer ok, 2=paste-buffer ok, 3=delete-buffer ok, 4=send-keys FAIL
      const okStatus = { pid: 1, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), status: 0, signal: null, output: [] } as any;
      const failStatus = { pid: 1, stdout: Buffer.alloc(0), stderr: Buffer.from('pane died'), status: 1, signal: null, output: [] } as any;
      if (callIdx === 4) return failStatus;
      return okStatus;
    });
    const failures: unknown[] = [];
    const scheduler = (cb: () => void) => { cb(); return 0 as any; };
    twoCallSubmit('%1', 'hello', 'codex', (c) => failures.push(c), scheduler);
    expect(failures.length).toBe(1);
  });
});

describe('shouldEmitStaleMarker rate-limit', () => {
  it('emits first marker, suppresses second within window', () => {
    expect(shouldEmitStaleMarker('r1', '@x')).toBe(true);
    expect(shouldEmitStaleMarker('r1', '@x')).toBe(false);
  });

  it('different rooms keep independent windows', () => {
    expect(shouldEmitStaleMarker('r1', '@x')).toBe(true);
    expect(shouldEmitStaleMarker('r2', '@x')).toBe(true);
  });
});

describe('B1: post-verify tmux failure handling', () => {
  it('verified pane whose load-buffer fails after verify → markPaneStale + emit marker', () => {
    let callIdx = 0;
    setSpawnImplForTests((bin, args, options) => {
      callIdx += 1;
      // call 1 = capture-pane (succeeds with ready output) → verify passes
      // call 2 = load-buffer (FAILS post-verify, race with pane death)
      if (callIdx === 1) {
        return { pid: 1, stdout: Buffer.from('│ > ready'), stderr: Buffer.alloc(0), status: 0, signal: null, output: [] } as any;
      }
      return { pid: 1, stdout: Buffer.alloc(0), stderr: Buffer.from('pane died'), status: 1, signal: null, output: [] } as any;
    });
    const t = registerPaneTerminal('post-verify-fail');
    const markerCalls: any[] = [];
    const outcome = injectToTerminal(t, 'env', 'r4', '@v',
      (room, handle, reason) => markerCalls.push({ room, handle, reason }));
    expect(outcome.kind).toBe('marker');
    expect(outcome.reason).toBe('stale');
    expect(getTerminalById(t.id)?.pane_status).toBe('stale');
    expect(markerCalls.length).toBe(1);
    expect(markerCalls[0].reason).toBe('stale');
  });
});

describe('injectToTerminal end-to-end (no real tmux)', () => {
  it('emits marker (not paste) for stale pane', () => {
    setSpawnImplForTests(fakeSpawnReturning('', 1));
    const t = registerPaneTerminal('stale-end-to-end');
    const markerCalls: { room: string; handle: string; reason: string }[] = [];
    const outcome = injectToTerminal(t, 'env', 'r1', '@x',
      (room, handle, reason) => markerCalls.push({ room, handle, reason }));
    expect(outcome.kind).toBe('marker');
    expect(outcome.reason).toBe('stale');
    expect(markerCalls.length).toBe(1);
  });

  it('emits marker (not paste) for unverified-but-alive pane (no ready match)', () => {
    setSpawnImplForTests(fakeSpawnReturning('busy: esc to interrupt', 0));
    const t = registerPaneTerminal('unverified-end-to-end');
    const markerCalls: any[] = [];
    const outcome = injectToTerminal(t, 'env', 'r2', '@y',
      (room, handle, reason) => markerCalls.push({ room, handle, reason }));
    expect(outcome.kind).toBe('marker');
    expect(outcome.reason).toBe('unknown');
    expect(markerCalls.length).toBe(1);
  });

  it('emits paste (no marker) for verified claude_code pane', () => {
    setSpawnImplForTests(fakeSpawnReturning('│ > ready prompt', 0));
    const t = registerPaneTerminal('verified-end-to-end');
    const markerCalls: any[] = [];
    const outcome = injectToTerminal(t, 'env', 'r3', '@z',
      (room, handle, reason) => markerCalls.push({ room, handle, reason }));
    expect(outcome.kind).toBe('paste');
    expect(markerCalls.length).toBe(0);
  });
});
