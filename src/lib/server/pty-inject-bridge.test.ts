import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIdentityDbForTests, getIdentityDb } from './db';
import { upsertTerminal, updatePaneTarget, getTerminalById } from './terminalsStore';
import {
  setSpawnImplForTests,
  resetBridgeStateForTests,
  verifyPaneTargetState,
  twoCallSubmit,
  injectToTerminal,
  shouldEmitStaleMarker
} from './pty-inject-bridge';
import { bindHandle, getLiveBinding, getHandleRow } from './handleBindingsStore';

let tmpDir: string;
const previousDbPath = process.env.ANT_FRESH_DB_PATH;

type SpawnCall = { bin: string; args: string[]; input?: string; env: NodeJS.ProcessEnv };

function fakeSpawnReturning(stdout: string, status = 0, stderr = '') {
  return (bin: string, args: string[], options: { input?: string | Buffer; env: NodeJS.ProcessEnv }) => {
    return {
      pid: 1,
      stdout: Buffer.from(stdout),
      stderr: Buffer.from(stderr),
      status,
      signal: null,
      output: []
    } as any;
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
  // Witness hardening (AC3 Step 1, ant-handles-rooms-ownership-contract.md):
  // only "can't find pane/window/session" is DEATH evidence. Any other
  // capture failure (tmux server down, transient error) PARKS as unknown —
  // it must never tombstone, or a tmux blip mass-vacates the colony.
  it("returns stale + marks pane stale when tmux says can't find pane (death evidence)", () => {
    setSpawnImplForTests(fakeSpawnReturning('', 1, "can't find pane: %23"));
    const t = registerPaneTerminal('stale-test');
    expect(verifyPaneTargetState(t)).toBe('stale');
    expect(getTerminalById(t.id)?.pane_status).toBe('stale');
  });

  it('tombstones the live handle binding + vacates the handle on pane-not-found', () => {
    bindHandle({ handle: '@dave', pane: '%23', pid: 1, pidStart: null });
    setSpawnImplForTests(fakeSpawnReturning('', 1, "can't find pane: %23"));
    const t = registerPaneTerminal('witness-tombstone-test');
    expect(verifyPaneTargetState(t)).toBe('stale');
    expect(getLiveBinding('@dave')).toBeNull();
    expect(getHandleRow('@dave')?.vacated_at_ms).toBeTypeOf('number');
  });

  it('parks as unknown (no stale, no tombstone) when the tmux server is unreachable', () => {
    bindHandle({ handle: '@dave', pane: '%23', pid: 1, pidStart: null });
    setSpawnImplForTests(fakeSpawnReturning('', 1, 'no server running on /private/tmp/tmux-501/default'));
    const t = registerPaneTerminal('park-test');
    expect(verifyPaneTargetState(t)).toBe('unknown');
    expect(getTerminalById(t.id)?.pane_status).not.toBe('stale');
    expect(getLiveBinding('@dave')?.pane).toBe('%23');
    expect(getHandleRow('@dave')?.vacated_at_ms).toBeNull();
  });

  it('parks as unknown on an unclassified capture failure (empty stderr is not death evidence)', () => {
    setSpawnImplForTests(fakeSpawnReturning('', 1));
    const t = registerPaneTerminal('ambiguous-failure-test');
    expect(verifyPaneTargetState(t)).toBe('unknown');
    expect(getTerminalById(t.id)?.pane_status).not.toBe('stale');
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

  it('treats claude agent_kind alias as claude-code for prompt verification', () => {
    setSpawnImplForTests(fakeSpawnReturning('some lines\n│ > \nmore', 0));
    const t = registerPaneTerminal('ready-claude-alias', 'claude');
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

  it('returns unknown for qwen panes currently accepting input as shell commands', () => {
    setSpawnImplForTests(fakeSpawnReturning('x Shell Command [ANT room Agents id=r msg=m]\nbash: -c: unexpected EOF while looking for matching `]\'', 0));
    const t = registerPaneTerminal('qwen-shell-mode', 'qwen');
    expect(verifyPaneTargetState(t)).toBe('unknown');
    expect(getTerminalById(t.id)?.pane_status).not.toBe('verified');
  });

  it('returns unknown for qwen panes advertising shell mode before any command runs', () => {
    setSpawnImplForTests(fakeSpawnReturning('Working                         10.9% context used\nshell mode enabled (esc to disable)\n> ', 0));
    const t = registerPaneTerminal('qwen-shell-mode-banner', 'qwen');
    expect(verifyPaneTargetState(t)).toBe('unknown');
    expect(getTerminalById(t.id)?.pane_status).not.toBe('verified');
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

  it('emits DOUBLE Enter for claude agent_kind alias', () => {
    const { calls, impl } = captureSpawnCalls();
    setSpawnImplForTests(impl);
    const scheduler = (cb: () => void) => { cb(); return 0 as any; };
    twoCallSubmit('%1', 'hello', 'claude', () => {}, scheduler);
    const sendKeysCalls = calls.filter((c) => c.args[0] === 'send-keys');
    expect(sendKeysCalls.length).toBe(2);
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
    // Witness hardening: pane-death now needs explicit tmux evidence —
    // empty-stderr failures park as unknown instead of marking stale.
    setSpawnImplForTests(fakeSpawnReturning('', 1, "can't find pane: %23"));
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

  it('resolves null agent_kind from terminal_records and bracket-pastes multiline input for pi', () => {
    const t = registerPaneTerminal('null-kind-pi', null);
    expect(t.agent_kind).toBeNull();

    const db = getIdentityDb();
    db.prepare(`INSERT INTO terminal_records (session_id, name, agent_kind, tmux_target_pane, auto_forward_chat, created_at_ms, updated_at_ms)
      VALUES (?, ?, ?, ?, 1, ?, ?)`).run(t.id, t.name, 'pi', t.tmux_target_pane, Date.now(), Date.now());

    const { calls, impl } = captureSpawnCalls();
    setSpawnImplForTests(impl);

    const scheduler = (cb: () => void) => { cb(); return 0 as any; };
    twoCallSubmit(t.tmux_target_pane!, 'line 1\nline 2', null, () => {}, scheduler);

    const loadBufferCall = calls.find((c) => c.args[0] === 'load-buffer');
    expect(loadBufferCall).toBeDefined();
    expect(loadBufferCall!.input).toBe('line 1\nline 2');

    const pasteCall = calls.find((c) => c.args[0] === 'paste-buffer');
    expect(pasteCall?.args).toContain('-p');
  });

  it('bracket-pastes multiline input and does double enter for copilot', () => {
    const { calls, impl } = captureSpawnCalls();
    setSpawnImplForTests(impl);

    const scheduler = (cb: () => void) => { cb(); return 0 as any; };
    twoCallSubmit('%1', 'line 1\nline 2', 'copilot', () => {}, scheduler);

    const loadBufferCall = calls.find((c) => c.args[0] === 'load-buffer');
    expect(loadBufferCall).toBeDefined();
    expect(loadBufferCall!.input).toBe('line 1\nline 2');

    const pasteCall = calls.find((c) => c.args[0] === 'paste-buffer');
    expect(pasteCall?.args).toContain('-p');

    const enterCalls = calls.filter((c) => c.args[0] === 'send-keys' && c.args.includes('Enter'));
    expect(enterCalls.length).toBe(2);
  });

  it('guards Antigravity bracket envelope and bracket-pastes multiline input', () => {
    const { calls, impl } = captureSpawnCalls();
    setSpawnImplForTests(impl);

    const scheduler = (cb: () => void) => { cb(); return 0 as any; };
    twoCallSubmit(
      '%1',
      '[ANT room Agents id=r msg=m] @you: line 1\nline 2\n\n[ANT reply instruction: respond with: ant chat reply m --stdin]',
      'antigravity',
      () => {},
      scheduler
    );

    const loadBufferCall = calls.find((c) => c.args[0] === 'load-buffer');
    expect(loadBufferCall).toBeDefined();
    expect(loadBufferCall!.input).toContain('(ANT room Agents id=r msg=m)');
    expect(loadBufferCall!.input).toContain('(ANT reply instruction: respond with: ant chat reply m --stdin)');
    expect(loadBufferCall!.input).toMatch(/\r?\n/);

    const pasteCall = calls.find((c) => c.args[0] === 'paste-buffer');
    expect(pasteCall?.args).toContain('-p');
  });
});
