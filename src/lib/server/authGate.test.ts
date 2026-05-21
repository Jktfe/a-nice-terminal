import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveCallerIdentityOrDeprecate, getCookieValueFromRequest } from './authGate';
import { resetIdentityDbForTests } from './db';
import { upsertTerminal } from './terminalsStore';
import { addMembership } from './roomMembershipsStore';
import { createChatRoom, resetChatRoomStoreForTests } from './chatRoomStore';
import { createBrowserSession } from './browserSessionStore';

const previousEnv = process.env.ANT_AUTH_DEPRECATION_CUTOVER_MS;

beforeEach(() => {
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
});

afterEach(() => {
  if (previousEnv === undefined) delete process.env.ANT_AUTH_DEPRECATION_CUTOVER_MS;
  else process.env.ANT_AUTH_DEPRECATION_CUTOVER_MS = previousEnv;
});

function buildRequest(opts: { cookie?: string } = {}): Request {
  return new Request('http://localhost/test', {
    method: 'POST',
    headers: opts.cookie ? { cookie: opts.cookie } : {}
  });
}

describe('getCookieValueFromRequest', () => {
  it('returns null when no cookie header', () => {
    expect(getCookieValueFromRequest(buildRequest(), 'ant_browser_session')).toBeNull();
  });
  it('returns null when cookie header lacks the named cookie', () => {
    expect(
      getCookieValueFromRequest(buildRequest({ cookie: 'other=foo; another=bar' }), 'ant_browser_session')
    ).toBeNull();
  });
  it('returns decoded value when present', () => {
    expect(
      getCookieValueFromRequest(buildRequest({ cookie: 'ant_browser_session=abc%20xyz' }), 'ant_browser_session')
    ).toBe('abc xyz');
  });
});

describe('resolveCallerIdentityOrDeprecate', () => {
  it('cookie-first: VALID cookie → identity handle returned', () => {
    const room = createChatRoom({ name: 'r1', whoCreatedIt: '@you' });
    const terminal = upsertTerminal({ pid: 8888, pid_start: 'p88', name: '@browser-user' });
    addMembership({ room_id: room.id, handle: '@browser-user', terminal_id: terminal.id });
    const created = createBrowserSession({ roomId: room.id, authorHandle: '@browser-user' });
    if (!created) throw new Error('createBrowserSession returned null in test fixture');
    const result = resolveCallerIdentityOrDeprecate(
      'members-post',
      room.id,
      buildRequest({ cookie: `ant_browser_session=${created.browserSessionSecret}` }),
      {}
    );
    expect(result.kind).toBe('identity');
    if (result.kind === 'identity') expect(result.handle).toBe('@browser-user');
  });

  // GAP-53 Fix Shape B mirror (2026-05-14, canonical RQO32 greenlight):
  // INVALID cookie no longer hard-403s — falls through to step-2 pidChain
  // (or step-3 deprecation gate when pidChain also unresolved) and sets
  // result.clearStaleBrowserCookie=true so the route handler emits a
  // Max-Age=0 Set-Cookie. Mismatched-handle on a VALID cookie still 403s
  // in callers that compare against client-supplied authorHandle.
  it('GAP-53: INVALID cookie + valid pidChain falls through to pidChain + flags clearStaleBrowserCookie', () => {
    const room = createChatRoom({ name: 'r2', whoCreatedIt: '@you' });
    const terminal = upsertTerminal({ pid: 9001, pid_start: 'p90', name: 'cli' });
    addMembership({ room_id: room.id, handle: '@cli', terminal_id: terminal.id });
    const result = resolveCallerIdentityOrDeprecate(
      'members-post',
      room.id,
      buildRequest({ cookie: 'ant_browser_session=invalid' }),
      { pidChain: [{ pid: 9001, pid_start: 'p90' }] }
    );
    expect(result.kind).toBe('identity');
    if (result.kind === 'identity') expect(result.handle).toBe('@cli');
    expect(result.clearStaleBrowserCookie).toBe(true);
  });

  it('GAP-53: INVALID cookie + no pidChain falls through to deprecation gate + flags clearStaleBrowserCookie (warning phase)', () => {
    process.env.ANT_AUTH_DEPRECATION_CUTOVER_MS = String(Date.now() + 86_400_000);
    const room = createChatRoom({ name: 'r2b', whoCreatedIt: '@you' });
    const result = resolveCallerIdentityOrDeprecate(
      'members-post',
      room.id,
      buildRequest({ cookie: 'ant_browser_session=invalid' }),
      {}
    );
    expect(result.kind).toBe('legacy');
    expect(result.clearStaleBrowserCookie).toBe(true);
  });

  it('pidChain falls back when cookie absent', () => {
    const room = createChatRoom({ name: 'r3', whoCreatedIt: '@you' });
    const terminal = upsertTerminal({ pid: 9002, pid_start: 'p90b', name: 'cli2' });
    addMembership({ room_id: room.id, handle: '@cli2', terminal_id: terminal.id });
    const result = resolveCallerIdentityOrDeprecate(
      'members-post',
      room.id,
      buildRequest(),
      { pidChain: [{ pid: 9002, pid_start: 'p90b' }] }
    );
    expect(result.kind).toBe('identity');
    if (result.kind === 'identity') expect(result.handle).toBe('@cli2');
  });

  it('warning phase: no cookie + no pidChain → legacy result + warning header', () => {
    process.env.ANT_AUTH_DEPRECATION_CUTOVER_MS = String(Date.now() + 86_400_000);
    const room = createChatRoom({ name: 'r4', whoCreatedIt: '@you' });
    const result = resolveCallerIdentityOrDeprecate('members-post', room.id, buildRequest(), {});
    expect(result.kind).toBe('legacy');
    if (result.kind === 'legacy') {
      expect(result.warningHeader.name).toBe('x-auth-deprecation');
      expect(result.warningHeader.value).toMatch(/^warning;route=members-post;/);
    }
  });

  it('strict phase: no cookie + no pidChain → throws 403 with Q3 hint body', () => {
    process.env.ANT_AUTH_DEPRECATION_CUTOVER_MS = '0';
    const room = createChatRoom({ name: 'r5', whoCreatedIt: '@you' });
    let captured: unknown = null;
    try {
      resolveCallerIdentityOrDeprecate('discussions-post', room.id, buildRequest(), {});
    } catch (caught) {
      captured = caught;
    }
    expect((captured as { status: number }).status).toBe(403);
    expect((captured as { body: { message: string } }).body.message).toMatch(/Server-resolved identity required/);
  });
});
