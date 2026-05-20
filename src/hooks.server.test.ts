// Tests for hooks.server.ts (M3.2c follow-up). Proves bootPollerOnce is
// idempotent (poll-controller singleton survives multiple handle invocations).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handle, _testResetPollerBoot } from './hooks.server';
import { _testResetPoller } from '$lib/server/agentStatusPoller';

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  _testResetPollerBoot();
  _testResetPoller();
});
afterEach(() => {
  _testResetPollerBoot();
  _testResetPoller();
  delete process.env.ANT_FRESH_DB_PATH;
});

function fakeEvent() {
  return {
    request: new Request('http://localhost/api/anything'),
    url: new URL('http://localhost/api/anything'),
    cookies: { get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} },
    locals: {}, params: {}, platform: undefined, route: { id: null }, isDataRequest: false,
    isSubRequest: false, getClientAddress: () => '127.0.0.1', setHeaders: () => {}
  } as unknown as Parameters<typeof handle>[0]['event'];
}

const passResolve = () => Promise.resolve(new Response('ok'));

describe('hooks.server — boot poller on first request', () => {
  it('first handle invocation sets the boot-flag in globalThis', async () => {
    expect((globalThis as Record<string, unknown>).__antPollerBootedAt).toBeUndefined();
    await handle({ event: fakeEvent(), resolve: passResolve });
    expect((globalThis as Record<string, unknown>).__antPollerBootedAt).toBeDefined();
  });
  it('second handle invocation does NOT re-trigger boot (flag stays the same)', async () => {
    await handle({ event: fakeEvent(), resolve: passResolve });
    const firstBootAt = (globalThis as Record<string, unknown>).__antPollerBootedAt;
    await new Promise((r) => setTimeout(r, 10));
    await handle({ event: fakeEvent(), resolve: passResolve });
    const secondBootAt = (globalThis as Record<string, unknown>).__antPollerBootedAt;
    expect(secondBootAt).toBe(firstBootAt);
  });
  it('handle still calls resolve() and returns the response', async () => {
    const res = await handle({ event: fakeEvent(), resolve: passResolve });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });
  it('boot reset utility clears the flag (test seam)', async () => {
    await handle({ event: fakeEvent(), resolve: passResolve });
    expect((globalThis as Record<string, unknown>).__antPollerBootedAt).toBeDefined();
    _testResetPollerBoot();
    expect((globalThis as Record<string, unknown>).__antPollerBootedAt).toBeUndefined();
  });
});
