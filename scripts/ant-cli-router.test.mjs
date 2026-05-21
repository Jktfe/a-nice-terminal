import { afterEach, describe, expect, it } from 'vitest';
import { makeCliRunner } from './ant-cli.mjs';
import {
  formatInjectedPayload,
  handleRouterVerb,
  shouldRouteMessage
} from './ant-cli-router.mjs';

function makeJsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function setupRunner({ fetchReplies = [], serverUrl = 'http://localhost:4321' } = {}) {
  const writtenOut = [];
  const writtenErr = [];
  const fetchCalls = [];
  let replyIndex = 0;
  const fetchImpl = async (url, init) => {
    fetchCalls.push({ url, init });
    return fetchReplies[replyIndex++] ?? makeJsonResponse({ messages: [] });
  };
  const runner = makeCliRunner({
    fetchImpl,
    writeOut: (line) => writtenOut.push(line),
    writeErr: (line) => writtenErr.push(line),
    serverUrl
  });
  return { runner, writtenOut, writtenErr, fetchCalls };
}

const originalAntHandle = process.env.ANT_HANDLE;

afterEach(() => {
  if (originalAntHandle === undefined) delete process.env.ANT_HANDLE;
  else process.env.ANT_HANDLE = originalAntHandle;
});

describe('ant router', () => {
  it('is advertised through the packaged CLI dispatcher', async () => {
    const { runner, writtenOut } = setupRunner();
    const exitCode = await runner.run(['router', '--help']);
    expect(exitCode).toBe(0);
    expect(writtenOut.join('\n')).toContain('ant router <start>');
  });

  it('requires an explicit handle when ANT_HANDLE is absent', async () => {
    delete process.env.ANT_HANDLE;
    const { runner, writtenErr } = setupRunner();
    const exitCode = await runner.run(['router', 'start', '--room', 'r1', '--once']);
    expect(exitCode).toBe(1);
    expect(writtenErr.join(' ')).toContain('missing required --handle');
  });

  it('routes only targeted messages and suppresses self messages', () => {
    expect(shouldRouteMessage({ authorHandle: '@you', body: 'hello @agent' }, '@agent')).toBe(true);
    expect(shouldRouteMessage({ authorHandle: '@you', body: 'hello @everyone' }, '@agent')).toBe(true);
    expect(shouldRouteMessage({ authorHandle: '@agent', body: '@agent loop' }, '@agent')).toBe(false);
    expect(shouldRouteMessage({ authorHandle: '@you', body: 'plain update' }, '@agent')).toBe(false);
  });

  it('formats injected text with room and sender context', () => {
    expect(formatInjectedPayload('r1', { authorHandle: '@you', body: 'hello @agent' }))
      .toBe('[antchat r1 from @you] hello @agent');
  });

  it('polls room messages and injects targeted mentions once for tests/manual probes', async () => {
    const writes = [];
    const fetchImpl = async () => makeJsonResponse({
      messages: [
        { id: 'm1', postOrder: 1, authorHandle: '@you', body: 'hello @agent' },
        { id: 'm2', postOrder: 2, authorHandle: '@agent', body: '@agent self loop' },
        { id: 'm3', postOrder: 3, authorHandle: '@you', body: 'plain update' }
      ]
    });
    const runtime = {
      fetchImpl,
      writeOut: () => {},
      writeErr: () => {},
      serverUrl: 'http://localhost:4321'
    };
    class CliInputError extends Error {}
    const exitCode = await handleRouterVerb('start', [
      '--room', 'r1',
      '--handle', '@agent',
      '--since-order', '0',
      '--once'
    ], runtime, {
      CliInputError,
      sendTextImpl: async (text) => writes.push(text),
      sleepImpl: async () => {}
    });
    expect(exitCode).toBe(0);
    expect(writes).toEqual(['[antchat r1 from @you] hello @agent', '\r']);
  });

  it('mints a browser-session cookie and retries when the read gate returns 401', async () => {
    const writes = [];
    const fetchCalls = [];
    const fetchImpl = async (url, init = {}) => {
      fetchCalls.push({ url, init });
      if (fetchCalls.length === 1) return makeJsonResponse({ message: 'Authentication required.' }, 401);
      if (fetchCalls.length === 2) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'set-cookie': 'ant_browser_session=router-cookie; Path=/api/chat-rooms/r1' }
        });
      }
      return makeJsonResponse({
        messages: [{ id: 'm1', postOrder: 1, authorHandle: '@you', body: 'hello @agent' }]
      });
    };
    const runtime = {
      fetchImpl,
      writeOut: () => {},
      writeErr: () => {},
      serverUrl: 'http://localhost:4321'
    };
    class CliInputError extends Error {}
    const exitCode = await handleRouterVerb('start', [
      '--room', 'r1',
      '--handle', '@agent',
      '--since-order', '0',
      '--once'
    ], runtime, {
      CliInputError,
      sendTextImpl: async (text) => writes.push(text),
      sleepImpl: async () => {}
    });

    expect(exitCode).toBe(0);
    expect(fetchCalls[1]).toMatchObject({
      url: 'http://localhost:4321/api/chat-rooms/r1/browser-session',
      init: expect.objectContaining({ method: 'POST' })
    });
    expect(fetchCalls[2].init.headers.cookie).toBe('ant_browser_session=router-cookie');
    expect(writes).toEqual(['[antchat r1 from @you] hello @agent', '\r']);
  });
});
