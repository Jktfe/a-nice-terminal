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
  delete process.env.ANT_DEMO_EMAIL;
  delete process.env.ANT_DEMO_PASSWORD;
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

function pageEvent(path: string) {
  const url = new URL(`http://localhost${path}`);
  return {
    request: new Request(url),
    url,
    cookies: { get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} },
    locals: {}, params: {}, platform: undefined, route: { id: null }, isDataRequest: false,
    isSubRequest: false, getClientAddress: () => '127.0.0.1', setHeaders: () => {}
  } as unknown as Parameters<typeof handle>[0]['event'];
}

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

  it('lets shareable deck pages reach their own password access gate', async () => {
    process.env.ANT_DEMO_EMAIL = 'demo@example.com';
    process.env.ANT_DEMO_PASSWORD = 'secret';
    const res = await handle({
      event: pageEvent('/decks/deck-1?password=hunter2'),
      resolve: passResolve
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  it('lets the seeded Univer demo artefact load without a browser login', async () => {
    process.env.ANT_DEMO_EMAIL = 'demo@example.com';
    process.env.ANT_DEMO_PASSWORD = 'secret';
    const res = await handle({
      event: pageEvent('/artefacts/univer_demo_5892abff'),
      resolve: passResolve
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  it('keeps ordinary artefact pages behind the demo login gate', async () => {
    process.env.ANT_DEMO_EMAIL = 'demo@example.com';
    process.env.ANT_DEMO_PASSWORD = 'secret';

    await expect(handle({
      event: pageEvent('/artefacts/private-artefact'),
      resolve: passResolve
    })).rejects.toMatchObject({ status: 303 });
  });
});
