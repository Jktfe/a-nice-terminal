import { describe, expect, it } from 'vitest';
import { handleRegisterVerb, handleAddVerb, handleResolveVerb } from './ant-cli-register.mjs';

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

function makeRuntime(responseQueue) {
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
      writeErr: (line) => captured.stderr.push(line)
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
