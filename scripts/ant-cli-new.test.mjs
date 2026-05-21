import { describe, expect, it } from 'vitest';
import { handleNewVerb } from './ant-cli-new.mjs';

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

const ok = (body, status = 200) => ({
  ok: true,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body)
});

describe('ant new', () => {
  it('new terminal --name <name>: POSTs /api/terminals with the name', async () => {
    const { runtime, captured } = makeRuntime(() =>
      ok({ sessionId: 't_abc', name: 'T1', agentKind: 'claude', linkedChatRoomId: 'r1', tmuxTargetPane: 't_abc:0.0', derivedHandle: '@t1' })
    );
    await handleNewVerb('terminal', ['--name', 'T1', '--agent-kind', 'claude'], runtime, { CliInputError });
    expect(captured.requests[0].url).toBe('http://test.local/api/terminals');
    const body = JSON.parse(captured.requests[0].init.body);
    expect(body.name).toBe('T1');
    expect(body.agentKind).toBe('claude');
    expect(captured.stdout.join(' ')).toMatch(/Spawned terminal t_abc/);
  });

  it('new terminal: accepts positional name (no --name)', async () => {
    const { runtime, captured } = makeRuntime(() =>
      ok({ sessionId: 't_pos', name: 'PosTerm', agentKind: null, linkedChatRoomId: 'r2', tmuxTargetPane: 't_pos:0.0', derivedHandle: '@posterm' })
    );
    await handleNewVerb('terminal', ['PosTerm'], runtime, { CliInputError });
    const body = JSON.parse(captured.requests[0].init.body);
    expect(body.name).toBe('PosTerm');
  });

  it('new terminal: rejects unknown agent-kind', async () => {
    const { runtime } = makeRuntime(() => ok({}));
    await expect(
      handleNewVerb('terminal', ['--name', 'X', '--agent-kind', 'sausage'], runtime, { CliInputError })
    ).rejects.toThrow(/agent-kind must be one of/);
  });

  it('new terminal: requires a name', async () => {
    const { runtime } = makeRuntime(() => ok({}));
    await expect(handleNewVerb('terminal', [], runtime, { CliInputError })).rejects.toThrow(/--name is required/);
  });

  it('new chat: POSTs /api/chat-rooms with the name (positional)', async () => {
    const { runtime, captured } = makeRuntime(() =>
      ok({ id: 'room_abc', name: 'lane-A' })
    );
    await handleNewVerb('chat', ['lane-A'], runtime, { CliInputError });
    expect(captured.requests[0].url).toBe('http://test.local/api/chat-rooms');
    expect(JSON.parse(captured.requests[0].init.body).name).toBe('lane-A');
    expect(captured.stdout.join(' ')).toMatch(/Created chat room "lane-A"/);
  });

  it('new chatroom: alias of new chat', async () => {
    const { runtime, captured } = makeRuntime(() => ok({ id: 'r1', name: 'foo' }));
    await handleNewVerb('chatroom', ['foo'], runtime, { CliInputError });
    expect(captured.requests[0].url).toBe('http://test.local/api/chat-rooms');
  });

  it('rejects unknown new sub-verb', async () => {
    const { runtime } = makeRuntime(() => ok({}));
    await expect(handleNewVerb('frobnicate', [], runtime, { CliInputError })).rejects.toThrow(/unknown new verb/);
  });

  it('--json output for new chat returns the raw payload', async () => {
    const { runtime, captured } = makeRuntime(() => ok({ id: 'r1', name: 'foo' }));
    await handleNewVerb('chat', ['foo', '--json'], runtime, { CliInputError });
    expect(JSON.parse(captured.stdout[0])).toEqual({ id: 'r1', name: 'foo' });
  });
});
