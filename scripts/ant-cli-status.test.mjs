import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeCliRunner } from './ant-cli.mjs';
import { handleStatusVerb } from './ant-cli-status.mjs';
import * as identityChain from './ant-cli-identity-chain.mjs';

class CliInputError extends Error {}

function makeRuntime(responseBuilder) {
  const captured = { requests: [], stdout: [], stderr: [] };
  const fetchImpl = async (url, init = {}) => {
    captured.requests.push({ url, init });
    return responseBuilder(captured.requests.length, { url, init });
  };
  return {
    runtime: {
      fetchImpl,
      serverUrl: 'http://test.local',
      writeOut: (line) => captured.stdout.push(line),
      writeErr: (line) => captured.stderr.push(line)
    },
    captured
  };
}

const okJson = (body, status = 200) => ({ ok: true, status, json: async () => body, text: async () => JSON.stringify(body) });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ant status wrappers (M3.4a-v1)', () => {
  it('S1: show GETs the room status surface and renders one line per member', async () => {
    const payload = {
      roomId: 'room-a',
      members: [
        { handle: '@first', terminal_id: 'term-abcdefgh-1', pane_status: 'verified', pane_stale_since: null, updated_at: Math.floor(Date.now() / 1000) },
        { handle: '@second', terminal_id: 'term-ijklmnop-2', pane_status: 'stale', pane_stale_since: Math.floor(Date.now() / 1000) - 120, updated_at: Math.floor(Date.now() / 1000) - 120 }
      ]
    };
    const { runtime, captured } = makeRuntime(() => okJson(payload));
    const code = await handleStatusVerb('show', ['--room', 'room-a'], runtime, { CliInputError });
    expect(code).toBe(0);
    expect(captured.requests[0].url).toBe('http://test.local/api/chat-rooms/room-a/status');
    expect(captured.stdout[0]).toContain('@first');
    expect(captured.stdout[0]).toContain('verified');
    expect(captured.stdout[1]).toContain('@second');
    expect(captured.stdout[1]).toContain('stale');
  });

  it('S2: show with --json passes the server payload through unchanged', async () => {
    const payload = { roomId: 'room-b', members: [{ handle: '@only', terminal_id: 't1', pane_status: 'verified', pane_stale_since: null, updated_at: 1 }] };
    const { runtime, captured } = makeRuntime(() => okJson(payload));
    await handleStatusVerb('show', ['--room', 'room-b', '--json'], runtime, { CliInputError });
    const parsed = JSON.parse(captured.stdout[0]);
    expect(parsed).toEqual(payload);
  });

  it('S3: show with no members prints a friendly empty message, not a blank list', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ roomId: 'room-empty', members: [] }));
    await handleStatusVerb('show', ['--room', 'room-empty'], runtime, { CliInputError });
    expect(captured.stdout[0]).toContain('no members');
    expect(captured.stdout[0]).toContain('room-empty');
  });

  it('S4: show requires --room and fails before fetch when missing', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({}));
    await expect(handleStatusVerb('show', [], runtime, { CliInputError })).rejects.toThrow('missing required flag --room');
    expect(captured.requests).toHaveLength(0);
  });

  it('S5: show surfaces server 404 as a thrown error with the status code', async () => {
    const notFound = { ok: false, status: 404, json: async () => ({}), text: async () => 'Room not found.' };
    const { runtime } = makeRuntime(() => notFound);
    await expect(handleStatusVerb('show', ['--room', 'unknown-room'], runtime, { CliInputError })).rejects.toThrow(/404/);
  });

  it('S6: unknown subverb throws CliInputError, help/no-action prints usage', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({}));
    await expect(handleStatusVerb('lol', [], runtime, { CliInputError })).rejects.toThrow('unknown status verb: lol');
    const helpCode = await handleStatusVerb('help', [], runtime, { CliInputError });
    expect(helpCode).toBe(0);
    expect(captured.stdout.join('\n')).toContain('ant status show');
    const noActionCode = await handleStatusVerb(undefined, [], runtime, { CliInputError });
    expect(noActionCode).toBe(1);
  });

  it('R1: --terminal --rich GETs /api/terminals/:id/agent-status and renders flat Q7 row', async () => {
    const payload = {
      terminal_id: 'term-abcdefgh-x',
      agent_status: 'working',
      agent_status_source: 'fingerprint',
      agent_status_at_ms: 1_700_000_000_000,
      since_ms: 5000,
      evidence_json: null
    };
    const { runtime, captured } = makeRuntime(() => okJson(payload));
    const code = await handleStatusVerb('show', ['--terminal', 'term-abcdefgh-x', '--rich'], runtime, { CliInputError });
    expect(code).toBe(0);
    expect(captured.requests[0].url).toBe('http://test.local/api/terminals/term-abcdefgh-x/agent-status');
    expect(captured.stdout[0]).toContain('working');
    expect(captured.stdout[0]).toContain('fingerprint');
  });

  it('R2: --terminal --rich --json passes the Q7 payload through unchanged', async () => {
    const payload = { terminal_id: 't1', agent_status: 'idle', agent_status_source: 'default', agent_status_at_ms: 0, since_ms: 999, evidence_json: null };
    const { runtime, captured } = makeRuntime(() => okJson(payload));
    await handleStatusVerb('show', ['--terminal', 't1', '--rich', '--json'], runtime, { CliInputError });
    expect(JSON.parse(captured.stdout[0])).toEqual(payload);
  });

  it('R3: --terminal without --rich rejects pre-fetch (M3.4a-v2 only path)', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({}));
    await expect(handleStatusVerb('show', ['--terminal', 't1'], runtime, { CliInputError })).rejects.toThrow('--terminal requires --rich');
    expect(captured.requests).toHaveLength(0);
  });

  it('R4: --terminal + --room together rejects pre-fetch', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({}));
    await expect(handleStatusVerb('show', ['--room', 'r', '--terminal', 't', '--rich'], runtime, { CliInputError })).rejects.toThrow('cannot pass both');
    expect(captured.requests).toHaveLength(0);
  });

  it('R5: --room --rich sends ?rich=1 query (T3b/T3c route extension pending; current v1 server ignores it harmlessly)', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ roomId: 'r', members: [] }));
    await handleStatusVerb('show', ['--room', 'r', '--rich'], runtime, { CliInputError });
    expect(captured.requests[0].url).toBe('http://test.local/api/chat-rooms/r/status?rich=1');
  });

  it('R5b: --terminal --rich renders since_ms as a DURATION not a unix timestamp (canonical T3a B1 fix)', async () => {
    const payload = {
      terminal_id: 'term-since-test',
      agent_status: 'thinking',
      agent_status_source: 'fingerprint',
      agent_status_at_ms: 1_700_000_000_000,
      since_ms: 5000,
      evidence_json: null
    };
    const { runtime, captured } = makeRuntime(() => okJson(payload));
    await handleStatusVerb('show', ['--terminal', 'term-since-test', '--rich'], runtime, { CliInputError });
    expect(captured.stdout[0]).toContain('5s ago');
    expect(captured.stdout[0]).not.toMatch(/\d{3,}d ago/);
  });

  it('R6: --room --rich renders agent_status in suffix when server returns it (forward-compat with T3b/T3c)', async () => {
    const payload = {
      roomId: 'r',
      members: [
        { handle: '@a', terminal_id: 'tabcdefgh', pane_status: 'verified', pane_stale_since: null, updated_at: Math.floor(Date.now() / 1000), agent_status: 'thinking', agent_status_source: 'fingerprint' }
      ]
    };
    const { runtime, captured } = makeRuntime(() => okJson(payload));
    await handleStatusVerb('show', ['--room', 'r', '--rich'], runtime, { CliInputError });
    expect(captured.stdout[0]).toContain('thinking');
    expect(captured.stdout[0]).toContain('fingerprint');
  });

  it('S7: main runner dispatch exposes status and main help mentions show', async () => {
    const out = [];
    const calls = [];
    const runner = makeCliRunner({
      serverUrl: 'http://test.local',
      fetchImpl: async (url, init = {}) => {
        calls.push({ url, init });
        return okJson({ roomId: 'room-a', members: [] });
      },
      writeOut: (line) => out.push(line),
      writeErr: () => {}
    });
    const code = await runner.run(['status', 'show', '--room', 'room-a']);
    expect(code).toBe(0);
    expect(calls[0].url).toBe('http://test.local/api/chat-rooms/room-a/status');
  });

  it('P1: planning resolves current terminal, pushes thinking, and posts the planning notice when --room is supplied', async () => {
    vi.spyOn(identityChain, 'processIdentityChain').mockReturnValue([{ pid: 42, pid_start: 'start' }]);
    const { runtime, captured } = makeRuntime((idx) => {
      if (idx === 1) return okJson({ terminal_id: 'term-plan' });
      if (idx === 2) return okJson({ terminal_id: 'term-plan', agent_status: 'thinking', agent_status_source: 'ant-activity' });
      return okJson({ message: { id: 'msg1' } });
    });

    const code = await handleStatusVerb(
      'planning',
      ['--room', 'room-a', '--msg', 'planning T14 - ETA 15m'],
      runtime,
      { CliInputError }
    );

    expect(code).toBe(0);
    expect(captured.requests[0].url).toBe('http://test.local/api/identity/resolve');
    expect(JSON.parse(captured.requests[0].init.body).pids).toEqual([{ pid: 42, pid_start: 'start' }]);
    expect(captured.requests[1].url).toBe('http://test.local/api/terminals/term-plan/agent-status');
    expect(JSON.parse(captured.requests[1].init.body).status).toBe('thinking');
    expect(JSON.parse(captured.requests[1].init.body).evidence_json.mode).toBe('planning');
    expect(captured.requests[2].url).toBe('http://test.local/api/chat-rooms/room-a/messages');
    expect(JSON.parse(captured.requests[2].init.body).body).toBe('planning T14 - ETA 15m');
    expect(captured.stdout[0]).toContain('planning');
  });

  it('P2: idle pushes idle for the current terminal without posting chat', async () => {
    vi.spyOn(identityChain, 'processIdentityChain').mockReturnValue([{ pid: 44, pid_start: 'start-idle' }]);
    const { runtime, captured } = makeRuntime((idx) => {
      if (idx === 1) return okJson({ terminal_id: 'term-idle' });
      return okJson({ terminal_id: 'term-idle', agent_status: 'idle', agent_status_source: 'ant-activity' });
    });

    await handleStatusVerb('idle', [], runtime, { CliInputError });

    expect(captured.requests).toHaveLength(2);
    expect(captured.requests[1].url).toBe('http://test.local/api/terminals/term-idle/agent-status');
    expect(JSON.parse(captured.requests[1].init.body).status).toBe('idle');
    expect(captured.stdout[0]).toContain('idle');
  });
});
