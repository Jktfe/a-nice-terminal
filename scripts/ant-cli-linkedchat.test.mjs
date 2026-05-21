// CLI tests for `ant linkedchat` subverbs (M3.3a T3).
import { describe, expect, it } from 'vitest';
import { handleLinkedchatVerb } from './ant-cli-linkedchat.mjs';
import { makeCliRunner } from './ant-cli.mjs';

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

const okJson = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const bodyAt = (captured, index = 0) => JSON.parse(captured.requests[index].init.body);
const queryPidChain = (captured) => JSON.parse(new URL(captured.requests[0].url).searchParams.get('pidChain'));

describe('ant linkedchat (M3.3a T3)', () => {
  it('L1: list sends pidChain in query and renders permission rows', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({
      terminal_id: 'term_1',
      permissions: [{ subject_handle: '@viewer', state: 'allow', set_by: '@owner', set_at_ms: 1 }]
    }));
    await handleLinkedchatVerb('list', ['term_1'], runtime, { CliInputError });
    expect(captured.requests[0].url).toContain('/api/terminals/term_1/linkedchat?pidChain=');
    expect(Array.isArray(queryPidChain(captured))).toBe(true);
    expect(captured.stdout[0]).toContain('@viewer\tallow\t@owner');
  });

  it('L2: allow PUTs state=allow with handle, reason, and pidChain', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({
      permission: { subject_handle: '@viewer', state: 'allow' }
    }));
    await handleLinkedchatVerb('allow', ['term_1', '--handle', '@viewer', '--reason', 'pairing'], runtime, { CliInputError });
    expect(captured.requests[0].url).toBe('http://test.local/api/terminals/term_1/linkedchat');
    expect(captured.requests[0].init.method).toBe('PUT');
    expect(bodyAt(captured)).toMatchObject({ subjectHandle: '@viewer', state: 'allow', reason: 'pairing' });
    expect(Array.isArray(bodyAt(captured).pidChain)).toBe(true);
    expect(captured.stdout[0]).toContain('Terminal chat allow for @viewer on term_1');
  });

  it('L3: deny PUTs state=deny and omits absent reason', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({
      permission: { subject_handle: '@viewer', state: 'deny' }
    }));
    await handleLinkedchatVerb('deny', ['term_1', '--handle', '@viewer'], runtime, { CliInputError });
    expect(bodyAt(captured)).toMatchObject({ subjectHandle: '@viewer', state: 'deny' });
    expect(bodyAt(captured).reason).toBeUndefined();
    expect(captured.stdout[0]).toContain('Terminal chat deny for @viewer on term_1');
  });

  it('L4: --json emits raw JSON for list', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ terminal_id: 'term_1', permissions: [] }));
    await handleLinkedchatVerb('list', ['term_1', '--json'], runtime, { CliInputError });
    expect(JSON.parse(captured.stdout[0])).toEqual({ terminal_id: 'term_1', permissions: [] });
  });

  it('L5: missing terminal id rejects before fetch', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({}));
    await expect(handleLinkedchatVerb('list', [], runtime, { CliInputError })).rejects.toThrow(/needs a terminal-id/);
    expect(captured.requests).toHaveLength(0);
  });

  it('L6: missing --handle rejects before fetch for allow/deny', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({}));
    await expect(handleLinkedchatVerb('allow', ['term_1'], runtime, { CliInputError })).rejects.toThrow(/missing required flag --handle/);
    await expect(handleLinkedchatVerb('deny', ['term_1'], runtime, { CliInputError })).rejects.toThrow(/missing required flag --handle/);
    expect(captured.requests).toHaveLength(0);
  });

  it('L7: main runner dispatches the linkedchat primary verb', async () => {
    const calls = [];
    const runner = makeCliRunner({
      serverUrl: 'http://test.local',
      fetchImpl: async (url, init = {}) => {
        calls.push({ url, init });
        return okJson({ terminal_id: 'term_1', permissions: [] });
      },
      writeOut: () => {},
      writeErr: () => {}
    });
    const code = await runner.run(['linkedchat', 'list', 'term_1']);
    expect(code).toBe(0);
    expect(calls[0].url).toContain('/api/terminals/term_1/linkedchat?pidChain=');
  });
});
