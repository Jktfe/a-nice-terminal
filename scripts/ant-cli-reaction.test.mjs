import { describe, expect, it } from 'vitest';
import { makeCliRunner } from './ant-cli.mjs';
import { handleReactionVerb } from './ant-cli-reaction.mjs';

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

describe('ant reaction wrappers', () => {
  it('R1: list GETs message reactions and supports --json', async () => {
    const payload = { reactions: [{ reactorHandle: '@codex', emoji: '👍' }] };
    const { runtime, captured } = makeRuntime(() => okJson(payload));
    await handleReactionVerb('list', ['--room', 'room-a', '--message', 'msg-1'], runtime, { CliInputError });
    await handleReactionVerb('list', ['--room', 'room-a', '--message', 'msg-1', '--json'], runtime, { CliInputError });
    expect(captured.requests[0].url).toBe('http://test.local/api/chat-rooms/room-a/messages/msg-1/reactions');
    expect(captured.stdout[0]).toContain('@codex');
    expect(JSON.parse(captured.stdout[1]).reactions[0].emoji).toBe('👍');
  });

  it('R2: add POSTs reactorHandle and emoji', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ reaction: { id: 'r1' } }, 201));
    await handleReactionVerb('add', ['--room', 'room-a', '--message', 'msg-1', '--handle', '@codex', '--emoji', '👍'], runtime, { CliInputError });
    expect(captured.requests[0].init.method).toBe('POST');
    expect(bodyAt(captured)).toMatchObject({ reactorHandle: '@codex', emoji: '👍' });
    expect(captured.stdout.join('\n')).toContain('Reaction added');
  });

  it('R3: remove DELETEs reactorHandle and emoji with --json output', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ wasReactionThere: true }));
    await handleReactionVerb('remove', ['--room', 'room-a', '--message', 'msg-1', '--handle', '@codex', '--emoji', '👍', '--json'], runtime, { CliInputError });
    expect(captured.requests[0].init.method).toBe('DELETE');
    expect(bodyAt(captured)).toMatchObject({ reactorHandle: '@codex', emoji: '👍' });
    expect(JSON.parse(captured.stdout[0])).toMatchObject({ wasReactionThere: true });
  });

  it('R4: required flags fail before fetch', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({}));
    await expect(handleReactionVerb('list', ['--room', 'room-a'], runtime, { CliInputError })).rejects.toThrow('missing required flag --message');
    await expect(handleReactionVerb('add', ['--room', 'room-a', '--message', 'msg-1', '--handle', '@codex'], runtime, { CliInputError })).rejects.toThrow('missing required flag --emoji');
    expect(captured.requests).toHaveLength(0);
  });

  it('R5: main runner help and dispatch expose reaction', async () => {
    const out = [];
    const calls = [];
    const runner = makeCliRunner({
      serverUrl: 'http://test.local',
      fetchImpl: async (url, init = {}) => {
        calls.push({ url, init });
        return okJson({ reactions: [] });
      },
      writeOut: (line) => out.push(line),
      writeErr: () => {}
    });
    await runner.run(['help']);
    const code = await runner.run(['reaction', 'list', '--room', 'room-a', '--message', 'msg-1']);
    expect(out.join('\n')).toContain('  reaction list|add|remove|heard');
    expect(code).toBe(0);
    expect(calls[0].url).toBe('http://test.local/api/chat-rooms/room-a/messages/msg-1/reactions');
  });

  it('R7: add/heard/remove attach the durable session identity so the post-gate resolves the ANThandle (not pidChain)', async () => {
    // JWPK 2026-06-12: reactions 401'd because the CLI sent NO identity. Fix
    // mirrors `chat send` — x-ant-session-id header + sessionId in body — so the
    // mutation gate's clean-session path (Step 3c) resolves the witnessed
    // binding. pidChain rides along only as corroboration, never as the identity.
    const prev = process.env.ANT_SESSION_ID;
    process.env.ANT_SESSION_ID = 't_reactor';
    try {
      for (const action of ['add', 'heard', 'remove']) {
        const { runtime, captured } = makeRuntime(() => okJson({ reaction: { id: 'r1' } }, 201));
        const args = ['--room', 'room-a', '--message', 'msg-1', '--handle', '@codex'];
        if (action !== 'heard') args.push('--emoji', '👍');
        await handleReactionVerb(action, args, runtime, { CliInputError });
        expect(captured.requests[0].init.headers['x-ant-session-id']).toBe('t_reactor');
        expect(bodyAt(captured).sessionId).toBe('t_reactor');
      }
    } finally {
      if (prev === undefined) delete process.env.ANT_SESSION_ID;
      else process.env.ANT_SESSION_ID = prev;
    }
  });

  it('R8: list (a read-gated GET) attaches x-ant-session-id so membership resolves', async () => {
    const prev = process.env.ANT_SESSION_ID;
    process.env.ANT_SESSION_ID = 't_reactor';
    try {
      const { runtime, captured } = makeRuntime(() => okJson({ reactions: [] }));
      await handleReactionVerb('list', ['--room', 'room-a', '--message', 'msg-1'], runtime, { CliInputError });
      expect(captured.requests[0].init.headers['x-ant-session-id']).toBe('t_reactor');
    } finally {
      if (prev === undefined) delete process.env.ANT_SESSION_ID;
      else process.env.ANT_SESSION_ID = prev;
    }
  });

  it('R6: heard posts the canonical heard/read emoji without a freeform --emoji flag', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ reaction: { id: 'r1' } }, 201));
    await handleReactionVerb('heard', ['--room', 'room-a', '--message', 'msg-1', '--handle', '@codex'], runtime, { CliInputError });

    expect(captured.requests[0].init.method).toBe('POST');
    expect(bodyAt(captured)).toMatchObject({ reactorHandle: '@codex', emoji: '🧏‍♂️' });
    expect(captured.stdout.join('\n')).toContain('Heard/read reaction added: 🧏‍♂️');
  });
});
