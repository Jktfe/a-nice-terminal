import { describe, expect, it } from 'vitest';
import { makeCliRunner } from './ant-cli.mjs';
import { handleAuditVerb } from './ant-cli-audit.mjs';

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

describe('ant audit wrappers (M3.1a)', () => {
  it('A1: permissions GETs the room audit route and renders one line per member', async () => {
    const payload = {
      roomId: 'room-a',
      members: [
        { handle: '@first', terminal_id: 'term-abcdefgh-1', terminal_name: 'first-term', agent_kind: null, joined_at: Math.floor(Date.now() / 1000) - 30 },
        { handle: '@second', terminal_id: 'term-ijklmnop-2', terminal_name: 'second-term', agent_kind: 'claude_code', joined_at: Math.floor(Date.now() / 1000) - 600 }
      ]
    };
    const { runtime, captured } = makeRuntime(() => okJson(payload));
    const code = await handleAuditVerb('permissions', ['--room', 'room-a'], runtime, { CliInputError });
    expect(code).toBe(0);
    // URL now carries pidChain query for the hooks.server.ts gate; assert
    // pathname + pidChain presence separately so the test isn't fragile.
    const u0 = new URL(captured.requests[0].url);
    expect(`${u0.origin}${u0.pathname}`).toBe('http://test.local/api/chat-rooms/room-a/audit');
    expect(u0.searchParams.get('pidChain')).toBeTruthy();
    expect(captured.stdout[0]).toContain('@first');
    expect(captured.stdout[0]).toContain('first-term');
    expect(captured.stdout[1]).toContain('@second');
    expect(captured.stdout[1]).toContain('second-term');
  });

  it('A2: permissions --json passes the server payload through unchanged', async () => {
    const payload = { roomId: 'room-b', members: [{ handle: '@only', terminal_id: 't1', terminal_name: 'one', agent_kind: null, joined_at: 1 }] };
    const { runtime, captured } = makeRuntime(() => okJson(payload));
    await handleAuditVerb('permissions', ['--room', 'room-b', '--json'], runtime, { CliInputError });
    expect(JSON.parse(captured.stdout[0])).toEqual(payload);
  });

  it('A3: permissions with empty room prints a friendly empty message', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ roomId: 'room-empty', members: [] }));
    await handleAuditVerb('permissions', ['--room', 'room-empty'], runtime, { CliInputError });
    expect(captured.stdout[0]).toContain('no members');
    expect(captured.stdout[0]).toContain('room-empty');
  });

  it('A4: permissions requires --room and fails before fetch when missing', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({}));
    await expect(handleAuditVerb('permissions', [], runtime, { CliInputError })).rejects.toThrow('missing required flag --room');
    expect(captured.requests).toHaveLength(0);
  });

  it('A5: permissions surfaces server 404 as a thrown error with the status code', async () => {
    const notFound = { ok: false, status: 404, json: async () => ({}), text: async () => 'Room not found.' };
    const { runtime } = makeRuntime(() => notFound);
    await expect(handleAuditVerb('permissions', ['--room', 'unknown'], runtime, { CliInputError })).rejects.toThrow(/404/);
  });

  it('A6: unknown subverb throws CliInputError; help / no-action prints usage; main runner dispatch wires audit verb', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({}));
    await expect(handleAuditVerb('lol', [], runtime, { CliInputError })).rejects.toThrow('unknown audit verb: lol');
    const helpCode = await handleAuditVerb('help', [], runtime, { CliInputError });
    expect(helpCode).toBe(0);
    expect(captured.stdout.join('\n')).toContain('ant audit permissions');

    const calls = [];
    const runner = makeCliRunner({
      serverUrl: 'http://test.local',
      fetchImpl: async (url, init = {}) => { calls.push({ url, init }); return okJson({ roomId: 'r', members: [] }); },
      writeOut: () => {},
      writeErr: () => {}
    });
    const dispatchCode = await runner.run(['audit', 'permissions', '--room', 'r']);
    expect(dispatchCode).toBe(0);
    const u = new URL(calls[0].url);
    expect(`${u.origin}${u.pathname}`).toBe('http://test.local/api/chat-rooms/r/audit');
    expect(u.searchParams.get('pidChain')).toBeTruthy();
  });
});
