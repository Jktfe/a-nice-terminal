// Tests for hooks.server.ts (M3.2c follow-up). Proves bootPollerOnce is
// idempotent (poll-controller singleton survives multiple handle invocations).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handle, _testResetPollerBoot } from './hooks.server';
import { _testResetPoller } from '$lib/server/agentStatusPoller';
import { resetIdentityDbForTests } from '$lib/server/db';
import {
  createBrowserSession,
  resetBrowserSessionStoreForTests
} from '$lib/server/browserSessionStore';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { addMembership } from '$lib/server/roomMembershipsStore';
import { upsertTerminal } from '$lib/server/terminalsStore';

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
  resetBrowserSessionStoreForTests();
  _testResetPollerBoot();
  _testResetPoller();
});
afterEach(() => {
  _testResetPollerBoot();
  _testResetPoller();
  resetBrowserSessionStoreForTests();
  resetChatRoomStoreForTests();
  resetIdentityDbForTests();
  delete process.env.ANT_FRESH_DB_PATH;
  delete process.env.ANT_REQUIRE_LOGIN;
  delete process.env.ANT_ADMIN_TOKEN;
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

function pageEvent(path: string, cookie?: string) {
  const url = new URL(`http://localhost${path}`);
  return {
    request: new Request(url, cookie ? { headers: { cookie } } : undefined),
    url,
    cookies: { get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} },
    locals: {}, params: {}, platform: undefined, route: { id: null }, isDataRequest: false,
    isSubRequest: false, getClientAddress: () => '127.0.0.1', setHeaders: () => {}
  } as unknown as Parameters<typeof handle>[0]['event'];
}

function apiEvent(path: string, headers: Record<string, string> = {}) {
  const url = new URL(`http://localhost${path}`);
  return {
    request: new Request(url, { headers }),
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
    process.env.ANT_REQUIRE_LOGIN = '1';
    const res = await handle({
      event: pageEvent('/decks/deck-1?password=hunter2'),
      resolve: passResolve
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  it('lets built deck iframe payloads load inside shareable deck pages', async () => {
    process.env.ANT_REQUIRE_LOGIN = '1';
    const res = await handle({
      event: pageEvent('/d/ant-animotion-demo'),
      resolve: passResolve
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  it('lets the seeded Univer demo artefact load without a browser login', async () => {
    process.env.ANT_REQUIRE_LOGIN = '1';
    const res = await handle({
      event: pageEvent('/artefacts/univer_demo_5892abff'),
      resolve: passResolve
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  it('keeps ordinary artefact pages behind the login gate', async () => {
    process.env.ANT_REQUIRE_LOGIN = '1';

    await expect(handle({
      event: pageEvent('/artefacts/private-artefact'),
      resolve: passResolve
    })).rejects.toMatchObject({ status: 303 });
  });

  it('gates room-scoped API reads before their route handlers run', async () => {
    const room = createChatRoom({ name: 'hook-read-gate', whoCreatedIt: '@you' });
    let routeHandlerCalled = false;
    const resolve = () => {
      routeHandlerCalled = true;
      return Promise.resolve(new Response('route handler reached'));
    };

    await expect(handle({
      event: apiEvent(`/api/chat-rooms/${room.id}/docs`),
      resolve
    })).rejects.toMatchObject({ status: 401 });
    expect(routeHandlerCalled).toBe(false);
  });

  it('allows admin-bearer room-scoped API reads through to the route handler', async () => {
    process.env.ANT_ADMIN_TOKEN = 'hook-admin-token';
    const room = createChatRoom({ name: 'hook-admin-read-gate', whoCreatedIt: '@you' });
    const res = await handle({
      event: apiEvent(`/api/chat-rooms/${room.id}/docs`, {
        authorization: 'Bearer hook-admin-token'
      }),
      resolve: passResolve
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  it('clears a stale root browser cookie when redirecting to login', async () => {
    process.env.ANT_REQUIRE_LOGIN = '1';

    const response = await handle({
      event: pageEvent('/rooms/fnokx03pud?panel=tasks', 'ant_browser_session=bws_stale_root_cookie'),
      resolve: passResolve
    });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/login?next=%2Frooms%2Ffnokx03pud%3Fpanel%3Dtasks');
    expect(response.headers.get('set-cookie')).toContain('ant_browser_session=;');
    expect(response.headers.get('set-cookie')).toContain('Path=/');
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('refreshes the root browser cookie on authenticated page HTML responses', async () => {
    process.env.ANT_REQUIRE_LOGIN = '1';
    const room = createChatRoom({ name: 'auth refresh', whoCreatedIt: '@JWPK' });
    const terminal = upsertTerminal({ pid: 42, pid_start: 'pst', name: 'browser-proof' });
    addMembership({ room_id: room.id, handle: '@JWPK', terminal_id: terminal.id });
    const session = createBrowserSession({
      roomId: room.id,
      authorHandle: '@JWPK',
      browserSessionId: 'bs_hook_refresh',
      nowMs: Date.now()
    });
    expect(session).not.toBeNull();

    const response = await handle({
      event: pageEvent(`/rooms/${room.id}`, `ant_browser_session=${session!.browserSessionSecret}`),
      resolve: () => Promise.resolve(new Response('<h1>ok</h1>', { headers: { 'content-type': 'text/html' } }))
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain(`ant_browser_session=${session!.browserSessionSecret}`);
    expect(response.headers.get('set-cookie')).toContain('Path=/');
    expect(response.headers.get('set-cookie')).toContain('Max-Age=2592000');
  });
});
