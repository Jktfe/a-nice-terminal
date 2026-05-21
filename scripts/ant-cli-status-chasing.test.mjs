import { describe, expect, it } from 'vitest';
import { handleStatusChasingVerb } from './ant-cli-status-chasing.mjs';

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

describe('handleStatusChasingVerb', () => {
  it('C1: --handle issues a GET and prints one line per chasing thread', async () => {
    const payload = {
      messages: [
        { id: 'm1', roomId: 'r1', authorHandle: '@me', postedAt: '2026-05-16T09:00:00Z', body: 'awaiting reply' }
      ]
    };
    const { runtime, captured } = makeRuntime(() => okJson(payload));
    const code = await handleStatusChasingVerb(['--handle', '@me'], runtime, { CliInputError });
    expect(code).toBe(0);
    expect(captured.requests[0].url).toBe('http://test.local/api/status/chasing?handle=%40me');
    expect(captured.stdout[0]).toContain('awaiting reply');
  });

  it('C2: --min-idle-minutes appends to query, --json passes payload through', async () => {
    const payload = { messages: [] };
    const { runtime, captured } = makeRuntime(() => okJson(payload));
    await handleStatusChasingVerb(['--handle', '@me', '--min-idle-minutes', '15', '--json'], runtime, { CliInputError });
    expect(captured.requests[0].url).toContain('min-idle-minutes=15');
    expect(JSON.parse(captured.stdout[0])).toEqual(payload);
  });

  it('C3: missing --handle throws CliInputError before fetch; bad --min-idle-minutes also throws', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ messages: [] }));
    await expect(handleStatusChasingVerb([], runtime, { CliInputError })).rejects.toThrow('missing required flag --handle');
    expect(captured.requests).toHaveLength(0);
    await expect(
      handleStatusChasingVerb(['--handle', '@me', '--min-idle-minutes', 'NaNN'], runtime, { CliInputError })
    ).rejects.toThrow('--min-idle-minutes must be a non-negative number');
    expect(captured.requests).toHaveLength(0);
  });
});
