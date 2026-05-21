import { describe, expect, it } from 'vitest';
import { handleChatPendingVerb } from './ant-cli-chat-pending.mjs';

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

const okJson = (body, status = 200) => ({
  ok: true,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body)
});

describe('handleChatPendingVerb', () => {
  it('P1: --handle issues a GET and prints one line per pending message', async () => {
    const payload = {
      messages: [
        { id: 'm1', roomId: 'r1', authorHandle: '@codex', postedAt: '2026-05-16T10:00:00Z', body: '@me first' },
        { id: 'm2', roomId: 'r1', authorHandle: '@codex', postedAt: '2026-05-16T10:01:00Z', body: '@me second' }
      ]
    };
    const { runtime, captured } = makeRuntime(() => okJson(payload));
    const code = await handleChatPendingVerb(['--handle', '@me'], runtime, { CliInputError });
    expect(code).toBe(0);
    expect(captured.requests[0].url).toBe('http://test.local/api/chat-rooms/messages/pending?handle=%40me');
    expect(captured.stdout).toHaveLength(2);
    expect(captured.stdout[0]).toContain('@codex');
    expect(captured.stdout[0]).toContain('@me first');
  });

  it('P2: --json passes the server payload through unchanged', async () => {
    const payload = { messages: [] };
    const { runtime, captured } = makeRuntime(() => okJson(payload));
    await handleChatPendingVerb(['--handle', '@me', '--json'], runtime, { CliInputError });
    expect(JSON.parse(captured.stdout[0])).toEqual(payload);
  });

  it('P3: empty messages prints a friendly hint', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ messages: [] }));
    await handleChatPendingVerb(['--handle', '@me'], runtime, { CliInputError });
    expect(captured.stdout[0]).toContain('nothing pending');
    expect(captured.stdout[0]).toContain('@me');
  });

  it('P4: missing --handle throws CliInputError before fetch', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ messages: [] }));
    await expect(handleChatPendingVerb([], runtime, { CliInputError })).rejects.toThrow('missing required flag --handle');
    expect(captured.requests).toHaveLength(0);
  });

  it('P5: --since appends to the query string when numeric', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ messages: [] }));
    await handleChatPendingVerb(['--handle', '@me', '--since', '1715800000000'], runtime, { CliInputError });
    expect(captured.requests[0].url).toContain('since=1715800000000');
  });
});
