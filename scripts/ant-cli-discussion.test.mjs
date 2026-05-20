// CLI tests for `ant discussion` subverb (M3.4b T4).
import { describe, expect, it } from 'vitest';
import { handleDiscussionVerb } from './ant-cli-discussion.mjs';

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
const bodyAt = (captured, index = 0) => JSON.parse(captured.requests[index].init.body);

describe('ant discussion (M3.4b T4)', () => {
  it('D1: create posts parentMessageId + title + pidChain', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({
      discussion: { id: 'd_1', parent_message_id: 'msg_p', opened_by: '@a', status: 'open' }
    }, 201));
    await handleDiscussionVerb('create', ['--room', 'r1', '--from', 'msg_p', '--title', 'side-thread'], runtime, { CliInputError });
    expect(captured.requests[0].url).toBe('http://test.local/api/chat-rooms/r1/discussions');
    expect(captured.requests[0].init.method).toBe('POST');
    expect(bodyAt(captured)).toMatchObject({ parentMessageId: 'msg_p', title: 'side-thread' });
    expect(Array.isArray(bodyAt(captured).pidChain)).toBe(true);
    expect(captured.stdout[0]).toContain('d_1');
  });

  it('D2: create without --title omits title field (zero-drift)', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ discussion: { id: 'd_2', parent_message_id: 'msg_p', opened_by: '@a' } }, 201));
    await handleDiscussionVerb('create', ['--room', 'r1', '--from', 'msg_p'], runtime, { CliInputError });
    expect(bodyAt(captured).title).toBeUndefined();
  });

  it('D3: close PATCHes /api/discussions/{id} with summary + pidChain', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ discussion: { id: 'd_1', status: 'closed', summary: 'done' } }));
    await handleDiscussionVerb('close', ['--id', 'd_1', '--summary', 'done'], runtime, { CliInputError });
    expect(captured.requests[0].url).toBe('http://test.local/api/discussions/d_1');
    expect(captured.requests[0].init.method).toBe('PATCH');
    expect(bodyAt(captured)).toMatchObject({ summary: 'done' });
    expect(captured.stdout[0]).toContain('closed');
  });

  it('D4: close without --summary rejects before fetch', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({}));
    await expect(
      handleDiscussionVerb('close', ['--id', 'd_1'], runtime, { CliInputError })
    ).rejects.toThrow(/missing required flag --summary/);
    expect(captured.requests).toHaveLength(0);
  });

  it('D5: list default status=open + text render', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({
      discussions: [{ id: 'd_1', status: 'open', opened_by: '@a', title: 'first' }]
    }));
    await handleDiscussionVerb('list', ['--room', 'r1'], runtime, { CliInputError });
    expect(captured.requests[0].url).toBe('http://test.local/api/chat-rooms/r1/discussions?status=open');
    expect(captured.stdout[0]).toContain('d_1');
    expect(captured.stdout[0]).toContain('first');
  });

  it('D6: list --status closed passes filter', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ discussions: [] }));
    await handleDiscussionVerb('list', ['--room', 'r1', '--status', 'closed'], runtime, { CliInputError });
    expect(captured.requests[0].url).toContain('status=closed');
  });

  it('D7: list rejects invalid --status before fetch', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({}));
    await expect(
      handleDiscussionVerb('list', ['--room', 'r1', '--status', 'bogus'], runtime, { CliInputError })
    ).rejects.toThrow(/--status must be one of/);
    expect(captured.requests).toHaveLength(0);
  });

  it('D8: show renders discussion + child messages', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({
      discussion: { id: 'd_1', status: 'open', opened_by: '@a', summary: null },
      messages: [{ postOrder: 1, authorHandle: '@a', body: 'in disc' }]
    }));
    await handleDiscussionVerb('show', ['--id', 'd_1'], runtime, { CliInputError });
    expect(captured.requests[0].url).toBe('http://test.local/api/discussions/d_1');
    expect(captured.stdout[0]).toContain('d_1');
    expect(captured.stdout[1]).toContain('in disc');
  });
});
