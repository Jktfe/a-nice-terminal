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
    expect(new URL(captured.gets[0]).searchParams.get('pidChain')).toBeTruthy();
  });

  it('T4b: tail mints a browser-session cookie and retries when read gate returns 401', async () => {
    const messages = [makeMessage({ id: 'm1', postOrder: 1, body: 'hello after auth' })];
    const { runtime, captured } = makeRuntime((callIndex) => {
      if (callIndex === 1) return failure(401, 'Authentication required.');
      if (callIndex === 2) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'set-cookie': 'ant_browser_session=session-123; Path=/api/chat-rooms/room-a' }
        });
      }
      return okMessages(messages);
    });
    runtime.config = { handle: '@agent' };

    const code = await handleChatVerb('tail', ['--room', 'room-a', '--since-order', '0', '--once'], runtime, { CliInputError });

    expect(code).toBe(0);
    expect(captured.requests[1]).toMatchObject({
      url: 'http://test.local/api/chat-rooms/room-a/browser-session',
      init: expect.objectContaining({ method: 'POST' })
    });
    expect(bodyAt(captured, 1)).toMatchObject({ authorHandle: '@agent', pidChain: expect.any(Array) });
    expect(captured.requests[2].init.headers.cookie).toBe('ant_browser_session=session-123');
    expect(captured.stdout.join('\n')).toContain('hello after auth');
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
  it('S1: send reads a shell-safe message body from --stdin', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ message: { id: 'msg-stdin', authorHandle: '@codex' } }, 201));
    runtime.fs = {
      readFileSync: (path) => {
        expect(path).toBe(0);
        return 'literal `ticks` and trailing @\n';
      }
    };

    await handleChatVerb('send', ['room-a', '--stdin'], runtime, { CliInputError });

    expect(captured.requests[0].url).toBe('http://test.local/api/chat-rooms/room-a/messages');
    expect(captured.requests[0].init.method).toBe('POST');
    expect(bodyAt(captured)).toMatchObject({
      body: 'literal `ticks` and trailing @\n',
      pidChain: expect.any(Array)
    });
    expect(captured.stdout.join('\n')).toContain('msg-stdin');
  });

  it('S1b: send attaches durable session identity when configured', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ message: { id: 'msg-session', authorHandle: '@durable' } }, 201));
    runtime.envTmuxPane = '%durable';
    runtime.config = { antSessions: { byPane: { '%durable': 'sess-durable-1' } } };

    await handleChatVerb('send', ['room-a', '--msg', 'durable hello'], runtime, { CliInputError });

    expect(captured.requests[0].url).toBe('http://test.local/api/chat-rooms/room-a/messages');
    expect(captured.requests[0].init.headers['x-ant-session-id']).toBe('sess-durable-1');
    expect(bodyAt(captured)).toMatchObject({
      body: 'durable hello',
      sessionId: 'sess-durable-1',
      pidChain: expect.any(Array)
    });
  });

  it('S1b2: send recovers daemon-witnessed 403 by minting a bearer-backed browser-session cookie', async () => {
    const { runtime, captured } = makeRuntime((callIndex) => {
      if (callIndex === 1) {
        return failure(403, 'No daemon-witnessed binding for this terminal.');
      }
      if (callIndex === 2) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'set-cookie': 'ant_browser_session=session-123; Path=/api/chat-rooms/room-a' }
        });
      }
      return okJson({ message: { id: 'msg-retry', authorHandle: '@serverlaptop' } }, 201);
    });
    runtime.config = {
      tokens: {
        'room-a': {
          token: 'room-token-1',
          handle: '@serverlaptop',
          server_url: 'http://remote.test'
        }
      }
    };

    await handleChatVerb('send', ['room-a', '--msg', 'hello from intel'], runtime, { CliInputError });

    expect(captured.requests).toHaveLength(3);
    expect(captured.requests[0].url).toBe('http://remote.test/api/chat-rooms/room-a/messages');
    expect(captured.requests[1].url).toBe('http://remote.test/api/chat-rooms/room-a/browser-session');
    expect(captured.requests[1].init.headers.authorization).toBe('Bearer room-token-1');
    expect(bodyAt(captured, 1)).toMatchObject({ authorHandle: '@serverlaptop' });
    expect(captured.requests[2].url).toBe('http://remote.test/api/chat-rooms/room-a/messages');
    expect(captured.requests[2].init.headers.cookie).toBe('ant_browser_session=session-123');
    expect(bodyAt(captured, 2).pidChain).toBeUndefined();
    expect(bodyAt(captured, 2).pane).toBeUndefined();
    expect(bodyAt(captured, 2).sessionId).toBeUndefined();
    expect(captured.stdout.join('\n')).toContain('Posted msg-retry as @serverlaptop into room-a.');
  });

  it('S1b3: send recovers the live structured identity_unresolved PermissionDenied response', async () => {
    const livePermissionDenied = {
      message: 'No daemon-witnessed binding for this caller (clean identity mode).',
      permission_denied: {
        action: 'chat.post',
        target_kind: 'room',
        target_id: 'room-a',
        target_display_name: 'antchat - a remoteANT server native to Mac via Homebrew',
        reason: 'identity_unresolved',
        approvers: [{ handle: '@JWPK', role: 'room_owner', preferred: true }],
        approve_command: 'ant grant @JWPK chat.post --room room-a'
      }
    };
    const { runtime, captured } = makeRuntime((callIndex) => {
      if (callIndex === 1) {
        return new Response(JSON.stringify(livePermissionDenied), {
          status: 403,
          headers: { 'content-type': 'application/json' }
        });
      }
      if (callIndex === 2) {
        return new Response(JSON.stringify({ browserSession: { handle: '@serverlaptop' } }), {
          status: 201,
          headers: { 'set-cookie': 'ant_browser_session=session-live; Path=/; HttpOnly' }
        });
      }
      return okJson({ message: { id: 'msg-live-retry', authorHandle: '@serverlaptop' } }, 201);
    });
    runtime.config = {
      tokens: {
        'room-a': {
          token: 'room-token-live',
          default_handle: '@serverlaptop',
          server_url: 'http://remote.test'
        }
      },
      handle: '@serverlaptop'
    };

    await handleChatVerb('send', ['room-a', '--msg', 'hello from live intel'], runtime, { CliInputError });

    expect(captured.requests).toHaveLength(3);
    expect(captured.requests[1].url).toBe('http://remote.test/api/chat-rooms/room-a/browser-session');
    expect(captured.requests[1].init.headers.authorization).toBe('Bearer room-token-live');
    expect(captured.requests[2].init.headers.cookie).toBe('ant_browser_session=session-live');
    expect(bodyAt(captured, 2)).toEqual({ body: 'hello from live intel' });
    expect(captured.stdout.join('\n')).toContain('Posted msg-live-retry as @serverlaptop into room-a.');
  });

  it('S1c: send ignores shared global/per-room session ids and uses the terminal-scoped pane binding', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ message: { id: 'msg-pane-session', authorHandle: '@panedurable' } }, 201));
    runtime.envTmuxPane = '%pane-a';
    runtime.config = {
      antSessionId: 'sess-global',
      tokens: {
        'room-a': { ant_session_id: 'sess-room-a' }
      },
      antSessions: { byPane: { '%pane-a': 'sess-pane-a' } }
    };

    await handleChatVerb('send', ['room-a', '--msg', 'pane durable hello'], runtime, { CliInputError });

    expect(captured.requests[0].init.headers['x-ant-session-id']).toBe('sess-pane-a');
    expect(bodyAt(captured)).toMatchObject({ sessionId: 'sess-pane-a' });
  });

  it('S1d: send ignores stale terminal-name durable sessions', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ message: { id: 'msg-no-stale-name', authorHandle: '@pidchain' } }, 201));
    runtime.terminalName = 'reused-name';
    runtime.config = {
      antSessions: { byName: { 'reused-name': 'stale-session-token' } }
    };

    await handleChatVerb('send', ['room-a', '--msg', 'no stale name token'], runtime, { CliInputError });

    expect(captured.requests[0].init.headers['x-ant-session-id']).toBeUndefined();
    expect(bodyAt(captured).sessionId).toBeUndefined();
  });

  it('S1e: send adds the x-ant-attachment header from --attachment', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ message: { id: 'msg-attach', authorHandle: '@helper-agent' } }, 201));

    await handleChatVerb('send', ['room-a', '--msg', 'authored via lease', '--attachment', 'lease-secret-1'], runtime, { CliInputError });

    expect(captured.requests[0].init.headers['x-ant-attachment']).toBe('lease-secret-1');
  });

  it('S1f: send falls back to ANT_ATTACHMENT_SECRET when --attachment is absent', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ message: { id: 'msg-attach-env', authorHandle: '@helper-agent' } }, 201));
    process.env.ANT_ATTACHMENT_SECRET = 'lease-secret-env';
    try {
      await handleChatVerb('send', ['room-a', '--msg', 'authored via env lease'], runtime, { CliInputError });
    } finally {
      delete process.env.ANT_ATTACHMENT_SECRET;
    }

    expect(captured.requests[0].init.headers['x-ant-attachment']).toBe('lease-secret-env');
  });

  it('S2: reply derives the target room from the parent message id', async () => {
    const { runtime, captured } = makeRuntime((callIndex, { url }) => {
      const parsed = new URL(url);
      if (parsed.pathname === '/api/chat-rooms/messages/msg_parent') {
        return okJson({ message: { id: 'msg_parent', roomId: 'room-a', authorHandle: '@you', body: 'Question?' } });
      }
      if (url === 'http://test.local/api/chat-rooms/room-a/messages') {
        return okJson({ message: { id: 'msg_reply', authorHandle: '@codex' } }, 201);
      }
      return failure(404, 'unexpected path');
    });
    runtime.fs = {
      readFileSync: (path) => {
        expect(path).toBe(0);
        return 'Answer body from a safe heredoc.\n';
      }
    };

    await handleChatVerb('reply', ['msg_parent', '--stdin', '--handle', '@codex'], runtime, { CliInputError });

    const parentLookupUrl = new URL(captured.requests[0].url);
    expect(`${parentLookupUrl.origin}${parentLookupUrl.pathname}`).toBe('http://test.local/api/chat-rooms/messages/msg_parent');
    expect(parentLookupUrl.searchParams.get('pidChain')).toBeTruthy();
    expect(captured.requests[0].init.method).toBe('GET');
    expect(captured.requests[1].url).toBe('http://test.local/api/chat-rooms/room-a/messages');
    expect(captured.requests[1].init.method).toBe('POST');
    expect(bodyAt(captured, 1)).toMatchObject({
      body: 'Answer body from a safe heredoc.\n',
      parentMessageId: 'msg_parent',
      authorHandle: '@codex',
      pidChain: expect.any(Array)
    });
    expect(captured.stdout.join('\n')).toContain('Replied msg_reply as @codex into room-a.');
  });

  it('S2b: reply attaches durable session identity to the message POST', async () => {
    const { runtime, captured } = makeRuntime((callIndex, { url }) => {
      const parsed = new URL(url);
      if (parsed.pathname === '/api/chat-rooms/messages/msg_parent') {
        return okJson({ message: { id: 'msg_parent', roomId: 'room-a', authorHandle: '@you', body: 'Question?' } });
      }
      if (url === 'http://test.local/api/chat-rooms/room-a/messages') {
        return okJson({ message: { id: 'msg_reply', authorHandle: '@durable' } }, 201);
      }
      return failure(404, 'unexpected path');
    });
    runtime.envTmuxPane = '%reply';
    runtime.config = { antSessions: { byPane: { '%reply': 'sess-reply-1' } } };
    runtime.fs = { readFileSync: () => 'Reply from durable CLI.\n' };

    await handleChatVerb('reply', ['msg_parent', '--stdin'], runtime, { CliInputError });

    // The read-gated parent lookup (requests[0]) must ALSO carry the session.
    // The bug: it sent pidChain only, so post-cutover witnessed agents 401'd
    // on the lookup ("Authentication required") before the POST ever ran.
    expect(captured.requests[0].init.method).toBe('GET');
    expect(captured.requests[0].init.headers['x-ant-session-id']).toBe('sess-reply-1');
    expect(captured.requests[1].init.headers['x-ant-session-id']).toBe('sess-reply-1');
    expect(bodyAt(captured, 1)).toMatchObject({
      body: 'Reply from durable CLI.\n',
      parentMessageId: 'msg_parent',
      sessionId: 'sess-reply-1',
      pidChain: expect.any(Array)
    });
  });

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
    runtime.envTmuxPane = '%read';
    runtime.config = { antSessions: { byPane: { '%read': 'sess-read-1' } } };
    await handleChatVerb('read', ['--room', 'room-a', '--message', 'msg-1', '--handle', '@researchant', '--json'], runtime, { CliInputError });
    expect(captured.requests[0].url).toBe('http://test.local/api/chat-rooms/room-a/messages/msg-1/read');
    expect(captured.requests[0].init.method).toBe('POST');
    expect(captured.requests[0].init.headers['x-ant-session-id']).toBe('sess-read-1');
    expect(bodyAt(captured)).toMatchObject({ readerHandle: '@researchant', sessionId: 'sess-read-1', pidChain: expect.any(Array) });
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
    await handleChatVerb('focus', ['room-a', '--member', '@codex', '--for', '30m', '--reason', 'heads down', '--mode', 'solo'], runtime, { CliInputError });
    expect(captured.requests[0].url).toBe('http://test.local/api/chat-rooms/room-a/focus-mode');
    expect(captured.requests[0].init.method).toBe('PUT');
    expect(bodyAt(captured)).toMatchObject({
      memberHandle: '@codex',
      durationMs: 1_800_000,
      reason: 'heads down',
      mode: 'solo',
      pidChain: expect.any(Array)
    });
    expect(captured.stdout.join('\n')).toContain('Focus set');
  });

  it('C6b: focus rejects invalid mode before fetch', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ ok: true }));
    await expect(
      handleChatVerb('focus', ['room-a', '--member', '@codex', '--mode', 'lurk'], runtime, { CliInputError })
    ).rejects.toThrow('mode must be shield or solo');
    expect(captured.requests).toHaveLength(0);
  });

  it('C7: unfocus DELETEs the member focus-mode row', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ wasActive: true }));
    await handleChatVerb('unfocus', ['room-a', '--member', '@codex', '--json'], runtime, { CliInputError });
    expect(captured.requests[0].url).toBe('http://test.local/api/chat-rooms/room-a/focus-mode');
    expect(captured.requests[0].init.method).toBe('DELETE');
    expect(bodyAt(captured)).toMatchObject({ memberHandle: '@codex', pidChain: expect.any(Array) });
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

describe('ant chat send — message body input modes', () => {
  function makeSendRuntime(messageResponse, fsStub) {
    const captured = { requests: [], stdout: [], stderr: [] };
    const fetchImpl = async (url, init = {}) => {
      captured.requests.push({ url, init });
      return { ok: true, status: 200, json: async () => messageResponse, text: async () => JSON.stringify(messageResponse) };
    };
    return {
      runtime: {
        fetchImpl,
        serverUrl: 'http://test.local',
        writeOut: (line) => captured.stdout.push(line),
        writeErr: (line) => captured.stderr.push(line),
        fs: fsStub
      },
      captured
    };
  }
  const ok = { message: { id: 'msg-x', authorHandle: '@test' } };

  it('B1: --msg "..." posts the body verbatim (legacy shape still works)', async () => {
    const { runtime, captured } = makeSendRuntime(ok);
    await handleChatVerb('send', ['--room', 'room-a', '--msg', 'hello literal'], runtime, { CliInputError });
    expect(bodyAt(captured).body).toBe('hello literal');
  });

  it('B1b: tracker command response prints a tracker receipt instead of Posted ? as ?', async () => {
    const { runtime, captured } = makeSendRuntime({
      tracker: { id: 'trk_gvpl4', title: 'GVPL4 test' }
    });

    await handleChatVerb('send', ['--room', 'room-a', '--msg', '/tracker "GVPL4 test" | beneficiary, paid(y/n)'], runtime, { CliInputError });

    expect(bodyAt(captured).body).toBe('/tracker "GVPL4 test" | beneficiary, paid(y/n)');
    expect(captured.stdout.join('\n')).toContain('Created tracker trk_gvpl4 "GVPL4 test" in room-a.');
    expect(captured.stdout.join('\n')).not.toContain('Posted ? as ?');
  });

  it('B2: --msg-file reads body from disk; content with backticks/$/!/@ comes through untouched', async () => {
    const trickyBody = 'reply with `whoami` and $PATH and ! marks plus trailing @';
    const fsStub = { readFileSync: (p, enc) => {
      if (p !== '/tmp/msg.txt' || enc !== 'utf8') throw new Error('unexpected read');
      return trickyBody;
    }};
    const { runtime, captured } = makeSendRuntime(ok, fsStub);
    await handleChatVerb('send', ['--room', 'room-a', '--msg-file', '/tmp/msg.txt'], runtime, { CliInputError });
    expect(bodyAt(captured).body).toBe(trickyBody);
  });

  it('B3: --msg-stdin reads body from fd 0; content arrives intact', async () => {
    const stdinBody = 'multi\nline\nbody with `backticks` and trailing @';
    const fsStub = { readFileSync: (fd, enc) => {
      if (fd !== 0 || enc !== 'utf8') throw new Error('unexpected stdin read');
      return stdinBody;
    }};
    const { runtime, captured } = makeSendRuntime(ok, fsStub);
    await handleChatVerb('send', ['--room', 'room-a', '--msg-stdin'], runtime, { CliInputError });
    expect(bodyAt(captured).body).toBe(stdinBody);
  });

  it('B4: rejects when no body source is supplied', async () => {
    const { runtime } = makeSendRuntime(ok);
    await expect(
      handleChatVerb('send', ['--room', 'room-a'], runtime, { CliInputError })
    ).rejects.toThrow(/missing message body/);
  });

  it('B5: rejects when two body sources are supplied (no silent precedence)', async () => {
    const fsStub = { readFileSync: () => 'from file' };
    const { runtime } = makeSendRuntime(ok, fsStub);
    await expect(
      handleChatVerb('send', ['--room', 'room-a', '--msg', 'argv', '--msg-file', '/tmp/x.txt'], runtime, { CliInputError })
    ).rejects.toThrow(/multiple message body sources/);
  });

  it('B6a: rejects obvious reply-shaped broadcasts before fetch', async () => {
    const { runtime, captured } = makeSendRuntime(ok);

    await expect(
      handleChatVerb('send', ['--room', 'room-a', '--msg', 'reply-to=msg_parent I agree'], runtime, { CliInputError })
    ).rejects.toThrow(/looks like a reply/);

    expect(captured.requests).toHaveLength(0);
  });

  it('B6b: --broadcast-ok allows an intentional message-id broadcast', async () => {
    const { runtime, captured } = makeSendRuntime(ok);

    await handleChatVerb('send', ['--room', 'room-a', '--msg', 'Status for msg_parent is done', '--broadcast-ok'], runtime, { CliInputError });

    expect(captured.requests[0].url).toBe('http://test.local/api/chat-rooms/room-a/messages');
    expect(bodyAt(captured)).toMatchObject({ body: 'Status for msg_parent is done' });
  });

  it('B6c: --parent-message allows explicit reply posts through send', async () => {
    const { runtime, captured } = makeSendRuntime(ok);

    await handleChatVerb('send', ['--room', 'room-a', '--msg', 'reply-to=msg_parent I agree', '--parent-message', 'msg_parent'], runtime, { CliInputError });

    expect(captured.requests[0].url).toBe('http://test.local/api/chat-rooms/room-a/messages');
    expect(bodyAt(captured)).toMatchObject({
      body: 'reply-to=msg_parent I agree',
      parentMessageId: 'msg_parent'
    });
  });

  it('B6: --msg-file path that cannot be read surfaces a useful error', async () => {
    const fsStub = { readFileSync: () => { throw new Error('ENOENT'); }};
    const { runtime } = makeSendRuntime(ok, fsStub);
    await expect(
      handleChatVerb('send', ['--room', 'room-a', '--msg-file', '/tmp/missing.txt'], runtime, { CliInputError })
    ).rejects.toThrow(/--msg-file .* could not be read: ENOENT/);
  });
});

describe('chat send/reply — pane fact presentation (cutover soak fix)', () => {
  const prevPane = process.env.TMUX_PANE;
  const restorePane = () => {
    if (prevPane === undefined) delete process.env.TMUX_PANE;
    else process.env.TMUX_PANE = prevPane;
  };

  it('send includes pane in the POST body when TMUX_PANE is set', async () => {
    process.env.TMUX_PANE = '%41';
    try {
      const { runtime, captured } = makeRuntime(() => okJson({ message: { id: 'm1', authorHandle: '@x' } }, 201));
      await handleChatVerb('send', ['room-a', '--msg', 'hello'], runtime, { CliInputError });
      expect(bodyAt(captured).pane).toBe('%41');
    } finally { restorePane(); }
  });

  it('send omits pane when TMUX_PANE is unset', async () => {
    delete process.env.TMUX_PANE;
    try {
      const { runtime, captured } = makeRuntime(() => okJson({ message: { id: 'm1', authorHandle: '@x' } }, 201));
      await handleChatVerb('send', ['room-a', '--msg', 'hello'], runtime, { CliInputError });
      expect('pane' in bodyAt(captured)).toBe(false);
    } finally { restorePane(); }
  });
});
