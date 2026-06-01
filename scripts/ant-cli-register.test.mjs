import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleRegisterVerb, handleAddVerb, handleResolveVerb, chooseRegisterPidChain, AGENT_BINARY_NAMES } from './ant-cli-register.mjs';

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

// chooseRegisterPidChain has two anchoring strategies, tried in order:
//
//   1. Name-walk (v0.1.15): scan the chain for an agent-binary ancestor
//      (claude.exe / claude / codex / codex.exe). Anchor THERE — the
//      durable process that survives across CLI invocations from the
//      same agent shell.
//
//   2. Position-based fallback (0.1.8 slice A): if no agent ancestor is
//      found in the chain (raw shell case, no Claude/Codex parent),
//      drop the leaf and prefer the grandparent — fixes the MSYS2
//      short-leaf cygwin-helper case.
//
// Explicit --pid bypasses both and uses the chain as-is.
describe('chooseRegisterPidChain', () => {
  const HELPER = { pid: 65764, pid_start: 'iso-2026-05-22T20:36:39.4326010+01:00', name: 'cygwin-helper.exe' };
  const BASH = { pid: 52788, pid_start: 'iso-2026-05-22T20:36:39.3812590+01:00', name: 'bash.exe' };
  const WEZTERM = { pid: 11804, pid_start: 'iso-2026-05-13T16:40:55+01:00', name: 'wezterm-gui.exe' };

  describe('explicit --pid', () => {
    it('returns the chain unchanged when --pid was explicit (bypasses both strategies)', () => {
      const chain = [HELPER, BASH, WEZTERM];
      expect(chooseRegisterPidChain(chain, true)).toEqual(chain);
    });
  });

  describe('fallback: position-based (no agent ancestor in chain)', () => {
    it('drops the immediate ppid when chain has >= 2 entries', () => {
      const chain = [HELPER, BASH, WEZTERM];
      expect(chooseRegisterPidChain(chain, false)).toEqual([BASH, WEZTERM]);
    });

    it('returns the chain unchanged when it has only one entry', () => {
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

    it('falls back when chain entries have null/undefined name (older client)', () => {
      const oldShape = [
        { pid: 65764, pid_start: 'iso-A' },
        { pid: 52788, pid_start: 'iso-B' },
        { pid: 11804, pid_start: 'iso-C' }
      ];
      // No agent name visible → falls through to position-based slice(1)
      expect(chooseRegisterPidChain(oldShape, false)).toEqual([
        { pid: 52788, pid_start: 'iso-B' },
        { pid: 11804, pid_start: 'iso-C' }
      ]);
    });
  });

  describe('name-walk: agent ancestor at variable depth (v0.1.15)', () => {
    // Real Windows chain observed for xenocc on 2026-06-01 that motivated this
    // change. claude.exe sits at depth 4 from powershell — position-based slice
    // would land on the middle bash (pid 121756), missing the durable claude.
    // Server-side @speedy bound terminal 8ff8e8b6 to pid 81632 — name-walk
    // anchors there correctly without --pid override.
    const XENOCC_CHAIN_WINDOWS = [
      { pid: 124364, pid_start: '2026-06-01T10:55:00Z', name: 'powershell.exe' },
      { pid: 110016, pid_start: '2026-06-01T10:54:00Z', name: 'bash.exe' },
      { pid: 121756, pid_start: '2026-06-01T10:54:00Z', name: 'bash.exe' },
      { pid: 122232, pid_start: '2026-06-01T10:53:00Z', name: 'bash.exe' },
      { pid: 81632,  pid_start: '2026-05-28T20:26:47Z', name: 'claude.exe' },
      { pid: 18600,  pid_start: '2026-05-28T20:26:00Z', name: 'cmd.exe' },
      { pid: 19392,  pid_start: '2026-05-13T16:40:55Z', name: 'wezterm-gui.exe' },
      { pid: 11804,  pid_start: '2026-05-13T16:40:50Z', name: 'explorer.exe' }
    ];

    it('anchors on claude.exe (depth 4) — the xenocc reproducer', () => {
      const result = chooseRegisterPidChain(XENOCC_CHAIN_WINDOWS, false);
      expect(result[0].pid).toBe(81632);
      expect(result[0].name).toBe('claude.exe');
      expect(result).toHaveLength(4); // claude.exe + cmd + wezterm + explorer
    });

    it('anchors on claude (no .exe) for macOS/Linux chain', () => {
      const macChain = [
        { pid: 99999, pid_start: 'iso-A', name: 'bash' },
        { pid: 88888, pid_start: 'iso-B', name: 'claude' },
        { pid: 77777, pid_start: 'iso-C', name: 'Terminal' }
      ];
      const result = chooseRegisterPidChain(macChain, false);
      expect(result[0].name).toBe('claude');
      expect(result).toHaveLength(2);
    });

    it('anchors on codex.exe for the codex agent case', () => {
      const codexChain = [
        { pid: 1001, pid_start: 'a', name: 'bash.exe' },
        { pid: 1002, pid_start: 'b', name: 'codex.exe' },
        { pid: 1003, pid_start: 'c', name: 'cmd.exe' }
      ];
      const result = chooseRegisterPidChain(codexChain, false);
      expect(result[0].name).toBe('codex.exe');
      expect(result).toHaveLength(2);
    });

    it('anchors on the FIRST agent ancestor when multiple are present', () => {
      // Nested case: claude spawned a sub-claude (e.g. agent tool). Anchor on
      // the leafmost agent — that's the one whose shell context the current
      // CLI invocation actually lives in.
      const nested = [
        { pid: 100, pid_start: 'a', name: 'bash.exe' },
        { pid: 200, pid_start: 'b', name: 'claude.exe' },  // ← anchor here
        { pid: 300, pid_start: 'c', name: 'cmd.exe' },
        { pid: 400, pid_start: 'd', name: 'claude.exe' },
        { pid: 500, pid_start: 'e', name: 'explorer.exe' }
      ];
      const result = chooseRegisterPidChain(nested, false);
      expect(result[0].pid).toBe(200);
      expect(result).toHaveLength(4);
    });

    it('is case-insensitive (Windows CLAUDE.EXE)', () => {
      const upper = [
        { pid: 1, pid_start: 'a', name: 'bash.exe' },
        { pid: 2, pid_start: 'b', name: 'CLAUDE.EXE' }
      ];
      const result = chooseRegisterPidChain(upper, false);
      expect(result[0].pid).toBe(2);
    });

    it('ignores name-walk when explicit --pid is set (explicit always wins)', () => {
      const result = chooseRegisterPidChain(XENOCC_CHAIN_WINDOWS, true);
      // Explicit --pid: chain returned as-is, with powershell still at depth 0
      expect(result[0].pid).toBe(124364);
      expect(result).toEqual(XENOCC_CHAIN_WINDOWS);
    });
  });

  describe('AGENT_BINARY_NAMES set', () => {
    it('contains both case forms for both agents', () => {
      expect(AGENT_BINARY_NAMES.has('claude.exe')).toBe(true);
      expect(AGENT_BINARY_NAMES.has('claude')).toBe(true);
      expect(AGENT_BINARY_NAMES.has('codex.exe')).toBe(true);
      expect(AGENT_BINARY_NAMES.has('codex')).toBe(true);
    });
  });
});
