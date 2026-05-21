import { describe, expect, it } from 'vitest';
import { handleChatVerb } from './ant-cli-chat.mjs';

class CliInputError extends Error {}

function makeMessage(overrides) {
  return {
    id: 'msg-' + Math.random().toString(36).slice(2, 6),
    roomId: 'room-a',
    authorHandle: '@guest',
    authorDisplayName: 'Guest',
    kind: 'human',
    body: 'hello',
    postedAt: '2026-05-12T20:00:00.000Z',
    postOrder: 1,
    ...overrides
  };
}

function makeRuntime(responseBuilder) {
  const captured = { gets: [], requests: [], stdout: [], stderr: [] };
  const fetchImpl = async (url, init = {}) => {
    captured.gets.push(url);
    captured.requests.push({ url, init });
    return responseBuilder(captured.gets.length, { url, init });
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

function okMessages(messages) {
  return { ok: true, status: 200, json: async () => ({ messages }), text: async () => JSON.stringify({ messages }) };
}

function failure(status, bodyText) {
  return { ok: false, status, json: async () => ({}), text: async () => bodyText };
}

function okJson(body, status = 200) {
  return { ok: true, status, json: async () => body, text: async () => JSON.stringify(body) };
}
const bodyAt = (captured, index = 0) => JSON.parse(captured.requests[index].init.body);

describe('ant chat tail', () => {
  it('T1: tail prints one line per new message after --since-order 0', async () => {
    const messages = [makeMessage({ id: 'a', postOrder: 1, body: 'first' }), makeMessage({ id: 'b', postOrder: 2, body: 'second' })];
    const { runtime, captured } = makeRuntime(() => okMessages(messages));
    await handleChatVerb('tail', ['--room', 'room-a', '--since-order', '0', '--once'], runtime, { CliInputError });
    expect(captured.stdout).toHaveLength(2);
    expect(captured.stdout[0]).toContain('first');
    expect(captured.stdout[1]).toContain('second');
  });

  it('T2: tail filters messages with postOrder <= since-order', async () => {
    const messages = [makeMessage({ id: 'a', postOrder: 1, body: 'old' }), makeMessage({ id: 'b', postOrder: 5, body: 'new' })];
    const { runtime, captured } = makeRuntime(() => okMessages(messages));
    await handleChatVerb('tail', ['--room', 'room-a', '--since-order', '3', '--once'], runtime, { CliInputError });
    expect(captured.stdout).toHaveLength(1);
    expect(captured.stdout[0]).toContain('new');
  });

  it('T3: tail advances since-order across consecutive polls (no duplicates)', async () => {
    const firstPoll = [makeMessage({ id: 'a', postOrder: 1 }), makeMessage({ id: 'b', postOrder: 2 })];
    const secondPoll = [...firstPoll, makeMessage({ id: 'c', postOrder: 3, body: 'newer' })];
    let fetchCount = 0;
    const { runtime, captured } = makeRuntime(() => {
      fetchCount++;
      return okMessages(fetchCount === 1 ? firstPoll : secondPoll);
    });
    await handleChatVerb('tail', ['--room', 'room-a', '--since-order', '0', '--once'], runtime, { CliInputError });
    expect(captured.stdout).toHaveLength(2);
  });

  it('T4: --once exits after exactly one fetch', async () => {
    const { runtime, captured } = makeRuntime(() => okMessages([makeMessage({ postOrder: 1 })]));
    await handleChatVerb('tail', ['--room', 'room-a', '--once'], runtime, { CliInputError });
    expect(captured.gets).toHaveLength(1);
  });

  it('T5: missing --room raises CliInputError before any fetch', async () => {
    const { runtime, captured } = makeRuntime(() => okMessages([]));
    let captured_err = null;
    try { await handleChatVerb('tail', ['--once'], runtime, { CliInputError }); } catch (failure) { captured_err = failure; }
    expect(captured_err).toBeInstanceOf(CliInputError);
    expect(captured.gets).toHaveLength(0);
  });

  it('T6: invalid --poll-ms clamps via accepted range (no crash)', async () => {
    const { runtime } = makeRuntime(() => okMessages([]));
    await handleChatVerb('tail', ['--room', 'room-a', '--poll-ms', 'notanumber', '--once'], runtime, { CliInputError });
    await handleChatVerb('tail', ['--room', 'room-a', '--poll-ms', '-5', '--once'], runtime, { CliInputError });
    await handleChatVerb('tail', ['--room', 'room-a', '--poll-ms', '99999999', '--once'], runtime, { CliInputError });
  });

  it('T7: server 404 (unknown room) surfaces as exit 1 + stderr', async () => {
    const { runtime, captured } = makeRuntime(() => failure(404, 'Room not found.'));
    const code = await handleChatVerb('tail', ['--room', 'room-x', '--once'], runtime, { CliInputError });
    expect(code).toBe(1);
    expect(captured.stderr.join('\n')).toContain('404');
  });

  it('T8: server 500 surfaces as exit 1', async () => {
    const { runtime, captured } = makeRuntime(() => failure(500, 'boom'));
    const code = await handleChatVerb('tail', ['--room', 'room-a', '--once'], runtime, { CliInputError });
    expect(code).toBe(1);
    expect(captured.stderr.join('\n')).toContain('500');
  });

  it('T9: tail emits full bodies so agent routers do not lose instructions', async () => {
    const longBody = 'a'.repeat(500);
    const messages = [makeMessage({ postOrder: 1, body: longBody })];
    const { runtime, captured } = makeRuntime(() => okMessages(messages));
    await handleChatVerb('tail', ['--room', 'room-a', '--since-order', '0', '--once'], runtime, { CliInputError });
    expect(captured.stdout[0]).toContain(longBody);
    expect(captured.stdout[0]).not.toContain('…');
  });

  it('T10: multiple new messages emit in postOrder order', async () => {
    const out = [
      makeMessage({ id: 'c', postOrder: 3, body: 'third' }),
      makeMessage({ id: 'a', postOrder: 1, body: 'first' }),
      makeMessage({ id: 'b', postOrder: 2, body: 'second' })
    ];
    const { runtime, captured } = makeRuntime(() => okMessages(out));
    await handleChatVerb('tail', ['--room', 'room-a', '--since-order', '0', '--once'], runtime, { CliInputError });
    expect(captured.stdout[0]).toContain('first');
    expect(captured.stdout[1]).toContain('second');
    expect(captured.stdout[2]).toContain('third');
  });
});

describe('ant chat state wrappers', () => {
  it('C1: break POSTs a context break with reason and pidChain', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ message: { id: 'break-1', body: 'Context break.' } }, 201));

    await handleChatVerb('break', ['--room', 'room-a', '--reason', 'switching lane', '--handle', '@codex'], runtime, { CliInputError });
    expect(captured.requests[0].url).toBe('http://test.local/api/chat-rooms/room-a/breaks');
    expect(captured.requests[0].init.method).toBe('POST');
    const body = bodyAt(captured);
    expect(body.reason).toBe('switching lane');
    expect(body.postedByHandle).toBe('@codex');
    expect(Array.isArray(body.pidChain)).toBe(true);
    expect(captured.stdout.join('\n')).toContain('break-1');
  });

  it('C2: read POSTs the reader handle to a message read endpoint', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ receipt: { id: 'read-1' } }, 201));
    await handleChatVerb('read', ['--room', 'room-a', '--message', 'msg-1', '--handle', '@researchant', '--json'], runtime, { CliInputError });
    expect(captured.requests[0].url).toBe('http://test.local/api/chat-rooms/room-a/messages/msg-1/read');
    expect(captured.requests[0].init.method).toBe('POST');
    expect(bodyAt(captured)).toMatchObject({ readerHandle: '@researchant', pidChain: expect.any(Array) });
    expect(JSON.parse(captured.stdout[0])).toMatchObject({ receipt: { id: 'read-1' } });
  });

  it('C3: typing POSTs the member handle to the typing endpoint', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ ok: true }, 201));
    await handleChatVerb('typing', ['--room', 'room-a', '--handle', '@claude2'], runtime, { CliInputError });
    expect(captured.requests[0].url).toBe('http://test.local/api/chat-rooms/room-a/typing');
    expect(captured.requests[0].init.method).toBe('POST');
    expect(bodyAt(captured)).toMatchObject({ memberHandle: '@claude2', pidChain: expect.any(Array) });
    expect(captured.stdout.join('\n')).toContain('Typing heartbeat sent');
  });

  it('C4: draft PUTs text and DELETEs when --clear is passed', async () => {
    const replies = [
      okJson({ draft: { id: 'draft-1', draftText: 'partial note' } }),
      okJson({ wasCleared: true })
    ];
    const { runtime, captured } = makeRuntime((callIndex) => replies[callIndex - 1]);
    await handleChatVerb('draft', ['--room', 'room-a', '--handle', '@codex', '--text', 'partial note'], runtime, { CliInputError });
    await handleChatVerb('draft', ['--room', 'room-a', '--handle', '@codex', '--clear'], runtime, { CliInputError });
    expect(captured.requests[0].url).toBe('http://test.local/api/chat-rooms/room-a/composer-draft');
    expect(captured.requests[0].init.method).toBe('PUT');
    expect(bodyAt(captured)).toMatchObject({ authorHandle: '@codex', draftText: 'partial note', pidChain: expect.any(Array) });
    expect(captured.requests[1].init.method).toBe('DELETE');
    expect(bodyAt(captured, 1)).toMatchObject({ authorHandle: '@codex', pidChain: expect.any(Array) });
  });

  it('C5: wrapper verbs reject missing required flags before fetch', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ ok: true }));
    await expect(handleChatVerb('read', ['--room', 'room-a'], runtime, { CliInputError })).rejects.toThrow('missing required flag --message');
    await expect(handleChatVerb('draft', ['--room', 'room-a'], runtime, { CliInputError })).rejects.toThrow('requires --text or --clear');
    expect(captured.requests).toHaveLength(0);
  });

  it('C6: focus PUTs member, duration, and reason to focus-mode', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({
      focusEntry: { memberHandle: '@codex', expiresAt: '2026-05-16T22:00:00.000Z' }
    }));
    await handleChatVerb('focus', ['room-a', '--member', '@codex', '--for', '30m', '--reason', 'heads down'], runtime, { CliInputError });
    expect(captured.requests[0].url).toBe('http://test.local/api/chat-rooms/room-a/focus-mode');
    expect(captured.requests[0].init.method).toBe('PUT');
    expect(bodyAt(captured)).toMatchObject({
      memberHandle: '@codex',
      durationMs: 1_800_000,
      reason: 'heads down'
    });
    expect(captured.stdout.join('\n')).toContain('Focus set');
  });

  it('C7: unfocus DELETEs the member focus-mode row', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ wasActive: true }));
    await handleChatVerb('unfocus', ['room-a', '--member', '@codex', '--json'], runtime, { CliInputError });
    expect(captured.requests[0].url).toBe('http://test.local/api/chat-rooms/room-a/focus-mode');
    expect(captured.requests[0].init.method).toBe('DELETE');
    expect(bodyAt(captured)).toMatchObject({ memberHandle: '@codex' });
    expect(JSON.parse(captured.stdout[0])).toMatchObject({ wasActive: true });
  });

  it('C8: decide PATCHes a discussion with decision text and pidChain', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({
      discussion: { id: 'disc-1', summary: 'Use postgres', status: 'closed' }
    }));
    await handleChatVerb('decide', ['room-a', 'disc-1', 'Use', 'postgres'], runtime, { CliInputError });
    expect(captured.requests[0].url).toBe('http://test.local/api/chat-rooms/room-a/discussions/disc-1');
    expect(captured.requests[0].init.method).toBe('PATCH');
    expect(bodyAt(captured)).toMatchObject({ decision: 'Use postgres', pidChain: expect.any(Array) });
    expect(captured.stdout.join('\n')).toContain('closed with decision');
  });
});
