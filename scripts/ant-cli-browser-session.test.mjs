import { describe, expect, it } from 'vitest';
import {
  fetchRoomJsonWithBrowserSessionFallback,
  mintAntCliBrowserSessionCookie
} from './ant-cli-browser-session.mjs';

// 0.1.9 (router 502 root-cause fix 2026-05-23): bearer-on-GET tests.
// When per-room token is in config, send Authorization: Bearer and
// keep the URL bare (no pidChain query param). Eliminates the
// upstream proxy URL-length 502 that was killing routers overnight.
// Falls back to legacy pidChain + cookie-mint when no token.

const ROOM_ID = 'r_test_room';
const TOKEN = 'ant_t_abcdef0123456789';
const BASE_URL = 'http://test-server.local:6174';

function makeRuntime({ token = null, responses = [] }) {
  const captured = { calls: [], responseQueue: [...responses] };
  const fetchImpl = async (url, init = {}) => {
    captured.calls.push({ url, init });
    const next = captured.responseQueue.shift();
    if (!next) throw new Error(`unexpected request: ${url}`);
    return next;
  };
  const config = token
    ? { serverUrl: BASE_URL, tokens: { [ROOM_ID]: { token, handle: '@x' } } }
    : { serverUrl: BASE_URL };
  return {
    runtime: {
      fetchImpl,
      serverUrl: BASE_URL,
      serverUrlSource: 'default',
      config
    },
    captured
  };
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: { get: () => null, getSetCookie: () => [] }
  };
}

describe('fetchRoomJsonWithBrowserSessionFallback — bearer-on-GET', () => {
  it('uses Authorization: Bearer when per-room token exists in config', async () => {
    const { runtime, captured } = makeRuntime({
      token: TOKEN,
      responses: [jsonResponse({ messages: [] }, 200)]
    });
    await fetchRoomJsonWithBrowserSessionFallback(runtime, ROOM_ID, `/api/chat-rooms/${ROOM_ID}/messages`, null);
    expect(captured.calls.length).toBe(1);
    const call = captured.calls[0];
    expect(call.url).toBe(`${BASE_URL}/api/chat-rooms/${ROOM_ID}/messages`);
    expect(call.url).not.toContain('pidChain=');
    expect(call.init.headers.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('falls back to pidChain + cookie-mint when no token in config', async () => {
    const { runtime, captured } = makeRuntime({
      responses: [
        jsonResponse({ messages: [] }, 200) // initial GET with pidChain succeeds
      ]
    });
    await fetchRoomJsonWithBrowserSessionFallback(runtime, ROOM_ID, `/api/chat-rooms/${ROOM_ID}/messages`, null);
    expect(captured.calls.length).toBe(1);
    expect(captured.calls[0].url).toContain('pidChain=');
  });

  it('falls back to pidChain path when bearer returns 401 (stale token edge case)', async () => {
    const { runtime, captured } = makeRuntime({
      token: TOKEN,
      responses: [
        jsonResponse({ message: 'token revoked' }, 401), // bearer rejected
        jsonResponse({ messages: [] }, 200) // pidChain path succeeds
      ]
    });
    await fetchRoomJsonWithBrowserSessionFallback(runtime, ROOM_ID, `/api/chat-rooms/${ROOM_ID}/messages`, null);
    expect(captured.calls.length).toBe(2);
    // First call: bearer, no pidChain
    expect(captured.calls[0].init.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(captured.calls[0].url).not.toContain('pidChain=');
    // Second call: pidChain in URL, no bearer
    expect(captured.calls[1].url).toContain('pidChain=');
    expect(captured.calls[1].init?.headers?.authorization).toBeUndefined();
  });

  it('throws when bearer returns non-401 error (real failure)', async () => {
    const { runtime } = makeRuntime({
      token: TOKEN,
      responses: [jsonResponse({ message: 'server died' }, 500)]
    });
    await expect(
      fetchRoomJsonWithBrowserSessionFallback(runtime, ROOM_ID, `/api/chat-rooms/${ROOM_ID}/messages`, null)
    ).rejects.toThrow(/500/);
  });
});

describe('mintAntCliBrowserSessionCookie — bearer-backed write recovery', () => {
  it('carries the persisted room bearer when minting a browser session', async () => {
    const { runtime, captured } = makeRuntime({
      token: TOKEN,
      responses: [
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'set-cookie': 'ant_browser_session=session-123; Path=/api/chat-rooms/r_test_room' }
        })
      ]
    });

    const cookie = await mintAntCliBrowserSessionCookie(runtime, ROOM_ID, null);

    expect(cookie).toBe('ant_browser_session=session-123');
    expect(captured.calls[0].url).toBe(`${BASE_URL}/api/chat-rooms/${ROOM_ID}/browser-session`);
    expect(captured.calls[0].init.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(captured.calls[0].init.body)).toMatchObject({
      authorHandle: '@x',
      pidChain: expect.any(Array)
    });
  });
});

// xenoCC bug report 2026-05-26: lookupRoomToken read the flat shape
// only, so older configs with `byHandle` nested entries fell back to
// pidChain-in-URL → URL-length 502. These tests pin both shapes.
function makeRuntimeWithConfig(tokensConfig, responses = []) {
  const captured = { calls: [], responseQueue: [...responses] };
  const fetchImpl = async (url, init = {}) => {
    captured.calls.push({ url, init });
    const next = captured.responseQueue.shift();
    if (!next) throw new Error(`unexpected request: ${url}`);
    return next;
  };
  return {
    runtime: {
      fetchImpl,
      serverUrl: BASE_URL,
      serverUrlSource: 'default',
      config: { serverUrl: BASE_URL, tokens: tokensConfig }
    },
    captured
  };
}

describe('lookupRoomToken — dual-shape config compatibility', () => {
  it('reads bearer from legacy nested byHandle shape (default_handle present)', async () => {
    const { runtime, captured } = makeRuntimeWithConfig(
      {
        [ROOM_ID]: {
          default_handle: '@me',
          byHandle: {
            '@me': { token: TOKEN, handle: '@me' },
            '@other': { token: 'wrong-token', handle: '@other' }
          }
        }
      },
      [jsonResponse({ messages: [] }, 200)]
    );
    await fetchRoomJsonWithBrowserSessionFallback(runtime, ROOM_ID, `/api/chat-rooms/${ROOM_ID}/messages`, null);
    expect(captured.calls.length).toBe(1);
    expect(captured.calls[0].init.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(captured.calls[0].url).not.toContain('pidChain=');
  });

  it('reads bearer from legacy nested byHandle shape (no default_handle, falls back to first entry)', async () => {
    const { runtime, captured } = makeRuntimeWithConfig(
      { [ROOM_ID]: { byHandle: { '@me': { token: TOKEN, handle: '@me' } } } },
      [jsonResponse({ messages: [] }, 200)]
    );
    await fetchRoomJsonWithBrowserSessionFallback(runtime, ROOM_ID, `/api/chat-rooms/${ROOM_ID}/messages`, null);
    expect(captured.calls[0].init.headers.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('prefers flat token over legacy nested when both exist (post-migration shape)', async () => {
    const flatToken = 'flat-shape-token';
    const { runtime, captured } = makeRuntimeWithConfig(
      {
        [ROOM_ID]: {
          token: flatToken,
          default_handle: '@me',
          byHandle: { '@me': { token: 'stale-nested-token' } }
        }
      },
      [jsonResponse({ messages: [] }, 200)]
    );
    await fetchRoomJsonWithBrowserSessionFallback(runtime, ROOM_ID, `/api/chat-rooms/${ROOM_ID}/messages`, null);
    expect(captured.calls[0].init.headers.authorization).toBe(`Bearer ${flatToken}`);
  });

  it('falls back to pidChain when byHandle is empty (no usable token anywhere)', async () => {
    const { runtime, captured } = makeRuntimeWithConfig(
      { [ROOM_ID]: { byHandle: {} } },
      [jsonResponse({ messages: [] }, 200)]
    );
    await fetchRoomJsonWithBrowserSessionFallback(runtime, ROOM_ID, `/api/chat-rooms/${ROOM_ID}/messages`, null);
    expect(captured.calls[0].url).toContain('pidChain=');
    expect(captured.calls[0].init?.headers?.authorization).toBeUndefined();
  });

  it('falls back to first byHandle entry when default_handle points at a missing entry', async () => {
    const { runtime, captured } = makeRuntimeWithConfig(
      {
        [ROOM_ID]: {
          default_handle: '@missing',
          byHandle: { '@other': { token: TOKEN } }
        }
      },
      [jsonResponse({ messages: [] }, 200)]
    );
    await fetchRoomJsonWithBrowserSessionFallback(runtime, ROOM_ID, `/api/chat-rooms/${ROOM_ID}/messages`, null);
    // Default-handle miss falls back to the first byHandle entry which
    // does have a valid token, so bearer path still fires.
    expect(captured.calls[0].init.headers.authorization).toBe(`Bearer ${TOKEN}`);
  });
});
