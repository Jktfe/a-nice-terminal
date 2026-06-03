import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleRegisterVerb, handleAddVerb, handleResolveVerb, chooseRegisterPidChain } from './ant-cli-register.mjs';

class CliInputError extends Error {}

function okJson(body, status = 201) {
  return {
    ok: true,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

function failResponse(status, message) {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => message
  };
}

function makeRuntime(responseQueue, runtimeOverrides = {}) {
  const captured = { calls: [], stdout: [], stderr: [] };
  const fetchImpl = async (url, init) => {
    captured.calls.push({ url, init });
    const next = responseQueue.shift();
    if (typeof next === 'function') return next();
    return next;
  };
  return {
    runtime: {
      fetchImpl,
      serverUrl: 'http://fresh.test',
      writeOut: (line) => captured.stdout.push(line),
      writeErr: (line) => captured.stderr.push(line),
      // Phase A2: tests can inject the env-detected pane without
      // mutating process.env. Default null falls through to the real
      // env vars (kept undefined for tests that exercise that path).
      envTmuxPane: undefined,
      ...runtimeOverrides
    },
    captured
  };
}

describe('handleRegisterVerb', () => {
  let scratchHome;

  afterEach(() => {
    if (scratchHome) {
      rmSync(scratchHome, { recursive: true, force: true });
      scratchHome = undefined;
    }
  });

  it('posts pids + name to /api/identity/register and prints the terminal id', async () => {
    const { runtime, captured } = makeRuntime([
      okJson({ terminal_id: 't_abc', name: 'claude2-main', expires_at: 99 })
    ]);
    const code = await handleRegisterVerb('--handle', ['@claude2', '--name', 'claude2-main'], runtime, { CliInputError });
    expect(code).toBe(0);
    expect(captured.calls.length).toBe(1);
    expect(captured.calls[0].url).toBe('http://fresh.test/api/identity/register');
    const body = JSON.parse(captured.calls[0].init.body);
    expect(body.name).toBe('claude2-main');
    expect(Array.isArray(body.pids)).toBe(true);
    expect(body.pids.length).toBeGreaterThan(0);
    // Regression: --handle MUST land at top-level body.handle, since the
    // server reads rawBody.handle (register/+server.ts:134) to bind
    // terminal_records.handle AND drive the v0.2 knownV02Agent reclaim
    // bypass. Prior bug shipped the handle only inside body.meta, which
    // silently bound no identity and mis-fired the name-collision 409.
    expect(body.handle).toBe('@claude2');
    expect(captured.stdout.some((line) => line.includes('claude2-main'))).toBe(true);
  });

  it('does NOT touch v3 by default (opt-in mirror)', async () => {
    const { runtime, captured } = makeRuntime([
      okJson({ terminal_id: 't_no_mirror', name: 'N', expires_at: 1 })
    ]);
    const code = await handleRegisterVerb('--handle', ['@x', '--name', 'N'], runtime, { CliInputError });
    expect(code).toBe(0);
    expect(captured.calls.length).toBe(1);
    expect(captured.calls[0].url).not.toContain(':6458');
  });

  it('persists returned session_id as a terminal-scoped binding after register', async () => {
    scratchHome = mkdtempSync(join(tmpdir(), 'ant-cli-register-session-'));
    const { runtime } = makeRuntime(
      [okJson({ terminal_id: 't_session', name: 'SessionTerm', expires_at: 1, session_id: 'sess-returned' })],
      { envTmuxPane: '%session-pane', homeDir: scratchHome }
    );
    const code = await handleRegisterVerb('--handle', ['@session', '--name', 'SessionTerm'], runtime, { CliInputError });
    expect(code).toBe(0);
    const raw = JSON.parse(readFileSync(join(scratchHome, '.ant', 'config.json'), 'utf8'));
    expect(raw.antSessions.byPane['%session-pane']).toBe('sess-returned');
    expect(raw.antSessions.byName).toBeUndefined();
    expect(raw.ant_session_id).toBeUndefined();
  });

  it('throws CliInputError when --name is missing', async () => {
    const { runtime } = makeRuntime([]);
    let captured_err = null;
    try {
      await handleRegisterVerb('--handle', ['@x'], runtime, { CliInputError });
    } catch (err) { captured_err = err; }
    expect(captured_err).toBeInstanceOf(CliInputError);
  });

  it('surfaces fresh-ANT failure as exit 1 + stderr', async () => {
    const { runtime, captured } = makeRuntime([failResponse(500, 'boom')]);
    const code = await handleRegisterVerb('--handle', ['@x', '--name', 'X'], runtime, { CliInputError });
    expect(code).toBe(1);
    expect(captured.stderr.join('\n')).toContain('500');
  });

  it('--mirror-v3 best-effort swallows v3 failure but exits 0', async () => {
    const { runtime, captured } = makeRuntime([
      okJson({ terminal_id: 't_ok', name: 'X', expires_at: 1 }),
      failResponse(503, 'v3 down')
    ]);
    const code = await handleRegisterVerb('--handle', ['@x', '--name', 'X', '--mirror-v3'], runtime, { CliInputError });
    expect(code).toBe(0);
    expect(captured.calls.length).toBe(2);
    expect(captured.calls[1].url).toContain(':6458');
    expect(captured.stderr.some((s) => s.includes('v3 mirror'))).toBe(true);
  });

  // Phase A2 (JWPK A Team msg_7uvr35x0xr 2026-05-29, design Q1 default A):
  // auto-detect pane from TMUX_PANE / WEZTERM_PANE env. Explicit --pane wins.
  describe('Phase A2 auto-pane detection', () => {
    const RESERVED_ENV = ['TMUX_PANE', 'WEZTERM_PANE'];
    const savedEnv = {};

    beforeEach(() => {
      for (const key of RESERVED_ENV) {
        savedEnv[key] = process.env[key];
        delete process.env[key];
      }
    });

    afterEach(() => {
      for (const key of RESERVED_ENV) {
        if (savedEnv[key] === undefined) delete process.env[key];
        else process.env[key] = savedEnv[key];
      }
    });

    it('(a) injects pane from runtime.envTmuxPane when --pane is unset', async () => {
      const { runtime, captured } = makeRuntime(
        [okJson({ terminal_id: 't_inj', name: 'N', expires_at: 1 })],
        { envTmuxPane: '%42' }
      );
      const code = await handleRegisterVerb('--handle', ['@x', '--name', 'N'], runtime, { CliInputError });
      expect(code).toBe(0);
      const body = JSON.parse(captured.calls[0].init.body);
      expect(body.pane).toBe('%42');
    });

    it('(b) falls back to process.env.TMUX_PANE when runtime.envTmuxPane unset', async () => {
      process.env.TMUX_PANE = '%17';
      const { runtime, captured } = makeRuntime([
        okJson({ terminal_id: 't_proc', name: 'N', expires_at: 1 })
      ]);
      const code = await handleRegisterVerb('--handle', ['@x', '--name', 'N'], runtime, { CliInputError });
      expect(code).toBe(0);
      const body = JSON.parse(captured.calls[0].init.body);
      expect(body.pane).toBe('%17');
    });

    it('(c) falls back to process.env.WEZTERM_PANE when no tmux pane', async () => {
      process.env.WEZTERM_PANE = '7';
      const { runtime, captured } = makeRuntime([
        okJson({ terminal_id: 't_wez', name: 'N', expires_at: 1 })
      ]);
      const code = await handleRegisterVerb('--handle', ['@x', '--name', 'N'], runtime, { CliInputError });
      expect(code).toBe(0);
      const body = JSON.parse(captured.calls[0].init.body);
      expect(body.pane).toBe('7');
    });

    it('(d) explicit --pane wins over every env source', async () => {
      process.env.TMUX_PANE = '%17';
      process.env.WEZTERM_PANE = '7';
      const { runtime, captured } = makeRuntime(
        [okJson({ terminal_id: 't_wins', name: 'N', expires_at: 1 })],
        { envTmuxPane: '%42' }
      );
      const code = await handleRegisterVerb(
        '--handle',
        ['@x', '--name', 'N', '--pane', '%99'],
        runtime,
        { CliInputError }
      );
      expect(code).toBe(0);
      const body = JSON.parse(captured.calls[0].init.body);
      expect(body.pane).toBe('%99');
    });

    it('omits pane when nothing detected (no runtime field, no env, no --pane)', async () => {
      const { runtime, captured } = makeRuntime([
        okJson({ terminal_id: 't_none', name: 'N', expires_at: 1 })
      ]);
      const code = await handleRegisterVerb('--handle', ['@x', '--name', 'N'], runtime, { CliInputError });
      expect(code).toBe(0);
      const body = JSON.parse(captured.calls[0].init.body);
      expect(body.pane).toBeUndefined();
    });
  });
});

describe('handleAddVerb', () => {
  it('add session posts pid+name to /api/sessions/add', async () => {
    const { runtime, captured } = makeRuntime([
      okJson({ terminal_id: 't_added', name: 'retro-1' })
    ]);
    const code = await handleAddVerb('session', ['--pid', '4242', '--name', 'retro-1'], runtime, { CliInputError });
    expect(code).toBe(0);
    const body = JSON.parse(captured.calls[0].init.body);
    expect(body.pid).toBe(4242);
    expect(body.name).toBe('retro-1');
  });

  it('add membership posts room+handle+name to /api/sessions/add', async () => {
    const { runtime, captured } = makeRuntime([
      okJson({ membership_id: 'm_1', room_id: 'r1', handle: '@a', terminal_id: 't_1' })
    ]);
    const code = await handleAddVerb('membership', ['--room', 'r1', '--handle', '@a', '--name', 'retro-1'], runtime, { CliInputError });
    expect(code).toBe(0);
    const body = JSON.parse(captured.calls[0].init.body);
    expect(body.room_id).toBe('r1');
    expect(body.terminal_name).toBe('retro-1');
  });

  it('throws CliInputError for unknown add subverb', async () => {
    const { runtime } = makeRuntime([]);
    let captured_err = null;
    try {
      await handleAddVerb('garbage', [], runtime, { CliInputError });
    } catch (err) { captured_err = err; }
    expect(captured_err).toBeInstanceOf(CliInputError);
  });

  it('add session requires --pid + --name', async () => {
    const { runtime } = makeRuntime([]);
    let err1 = null;
    try { await handleAddVerb('session', ['--name', 'x'], runtime, { CliInputError }); } catch (e) { err1 = e; }
    expect(err1).toBeInstanceOf(CliInputError);
  });
});

describe('handleResolveVerb', () => {
  it('posts the caller PID chain to /api/identity/resolve', async () => {
    const { runtime, captured } = makeRuntime([
      okJson({ terminal_id: 't_x', name: 'whoever', agent_kind: null, handle: '@you' }, 200)
    ]);
    const code = await handleResolveVerb(undefined, [], runtime, { CliInputError });
    expect(code).toBe(0);
    expect(captured.calls[0].url).toBe('http://fresh.test/api/identity/resolve');
    expect(captured.stdout[0]).toContain('@you');
  });

  it('includes room_id when --room is passed', async () => {
    const { runtime, captured } = makeRuntime([
      okJson({ terminal_id: 't_x', name: 'n', agent_kind: null, handle: '@y' }, 200)
    ]);
    await handleResolveVerb('--room', ['r-7'], runtime, { CliInputError });
    const body = JSON.parse(captured.calls[0].init.body);
    expect(body.room_id).toBe('r-7');
  });
});

// 0.1.8 slice A (Xeno windows-cli-auth-wedge follow-up 2026-05-22):
// when --pid is implicit, register against the grandparent rather than
// the one-off MSYS2 cygwin helper at the immediate ppid. Explicit --pid
// remains untouched.
describe('chooseRegisterPidChain', () => {
  const HELPER = { pid: 65764, pid_start: 'iso-2026-05-22T20:36:39.4326010+01:00' };
  const BASH = { pid: 52788, pid_start: 'iso-2026-05-22T20:36:39.3812590+01:00' };
  const WEZTERM = { pid: 11804, pid_start: 'iso-2026-05-13T16:40:55+01:00' };

  it('returns the chain unchanged when --pid was explicit', () => {
    const chain = [HELPER, BASH, WEZTERM];
    expect(chooseRegisterPidChain(chain, true)).toEqual(chain);
  });

  it('drops the immediate ppid when chain has >= 2 entries and --pid was implicit', () => {
    const chain = [HELPER, BASH, WEZTERM];
    expect(chooseRegisterPidChain(chain, false)).toEqual([BASH, WEZTERM]);
  });

  it('returns the chain unchanged when it has only one entry (no grandparent fallback)', () => {
    expect(chooseRegisterPidChain([HELPER], false)).toEqual([HELPER]);
  });

  it('returns the chain unchanged when it is empty', () => {
    expect(chooseRegisterPidChain([], false)).toEqual([]);
  });

  it('does not mutate the input chain', () => {
    const chain = [HELPER, BASH, WEZTERM];
    chooseRegisterPidChain(chain, false);
    expect(chain).toEqual([HELPER, BASH, WEZTERM]);
  });
});
