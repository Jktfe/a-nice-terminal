import { describe, expect, it } from 'vitest';
import { handleListVerb } from './ant-cli-list.mjs';

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

const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });

describe('ant list', () => {
  it('list terminals: GETs /api/terminals and prints a tab line per terminal', async () => {
    const { runtime, captured } = makeRuntime(() => ok({
      terminals: [
        { sessionId: 't1', name: 'A', agentKind: 'claude', derivedHandle: '@a', alive: true },
        { sessionId: 't2', name: 'B', agentKind: null, derivedHandle: '@b', alive: false }
      ]
    }));
    await handleListVerb('terminals', [], runtime, { CliInputError });
    expect(captured.requests[0].url).toBe('http://test.local/api/terminals');
    expect(captured.stdout).toHaveLength(2);
    expect(captured.stdout[0]).toMatch(/t1\tA\tclaude\t@a\talive/);
    expect(captured.stdout[1]).toMatch(/t2\tB\t-\t@b\tstopped/);
  });

  it('list terminals: empty result prints "No terminals."', async () => {
    const { runtime, captured } = makeRuntime(() => ok({ terminals: [] }));
    await handleListVerb('terminals', [], runtime, { CliInputError });
    expect(captured.stdout).toEqual(['No terminals.']);
  });

  it('list chatrooms: GETs /api/chat-rooms', async () => {
    const { runtime, captured } = makeRuntime(() => ok({
      chatRooms: [
        { id: 'r1', name: 'ant-build', attentionState: 'ready' },
        { id: 'r2', name: 'lane-A', attentionState: 'awaiting' }
      ]
    }));
    await handleListVerb('chatrooms', [], runtime, { CliInputError });
    const url = new URL(captured.requests[0].url);
    expect(`${url.origin}${url.pathname}`).toBe('http://test.local/api/chat-rooms');
    expect(url.searchParams.get('pidChain')).toBeTruthy();
    expect(captured.stdout).toHaveLength(2);
    expect(captured.stdout[0]).toMatch(/r1\tant-build\tready/);
  });

  it('list chats: alias of chatrooms', async () => {
    const { runtime, captured } = makeRuntime(() => ok({ chatRooms: [{ id: 'r', name: 'n', attentionState: 'ready' }] }));
    await handleListVerb('chats', [], runtime, { CliInputError });
    const url = new URL(captured.requests[0].url);
    expect(`${url.origin}${url.pathname}`).toBe('http://test.local/api/chat-rooms');
    expect(url.searchParams.get('pidChain')).toBeTruthy();
  });

  it('--json mode passes the payload through', async () => {
    const payload = { terminals: [{ sessionId: 'x' }] };
    const { runtime, captured } = makeRuntime(() => ok(payload));
    await handleListVerb('terminals', ['--json'], runtime, { CliInputError });
    expect(JSON.parse(captured.stdout[0])).toEqual(payload);
  });

  it('rejects unknown list sub-verb', async () => {
    const { runtime } = makeRuntime(() => ok({}));
    await expect(handleListVerb('socks', [], runtime, { CliInputError })).rejects.toThrow(/unknown list verb/);
  });
});
