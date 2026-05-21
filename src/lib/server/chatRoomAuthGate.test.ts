/**
 * Tests for requireChatRoomMutationAuth — the shared identity gate used
 * by every MUTATING chat-room sub-route (LAUNCH-BLOCKER CVE FIX C,
 * Finding #3, 2026-05-20).
 *
 * Covers each auth path in precedence order plus the 401 unauthenticated
 * outcome. Cookie/pidChain edge cases are already covered by
 * resolveCallerIdentityStrict's own tests; here we only assert the
 * dispatch + the admin-bearer fallback that this helper adds.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { requireChatRoomMutationAuth, ADMIN_BEARER_HANDLE } from './chatRoomAuthGate';
import { resetIdentityDbForTests } from './db';
import { createBrowserSession } from './browserSessionStore';
import { createChatRoom, resetChatRoomStoreForTests } from './chatRoomStore';
import { addMembership } from './roomMembershipsStore';
import { upsertTerminal } from './terminalsStore';
import { createOwner } from './ownersStore';

function makeRequest(opts: {
  headers?: Record<string, string>;
  body?: unknown;
} = {}): { request: Request; rawBody: unknown } {
  const bodyString = opts.body === undefined ? undefined : JSON.stringify(opts.body);
  const request = new Request('http://localhost/api/chat-rooms/x/whatever', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(opts.headers ?? {})
    },
    ...(bodyString !== undefined && { body: bodyString })
  });
  return { request, rawBody: opts.body ?? null };
}

const ORIGINAL_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;

describe('requireChatRoomMutationAuth', () => {
  beforeEach(() => {
    resetIdentityDbForTests();
    resetChatRoomStoreForTests();
    process.env.ANT_ADMIN_TOKEN = 'test-admin-secret';
  });

  afterEach(() => {
    if (ORIGINAL_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
    else process.env.ANT_ADMIN_TOKEN = ORIGINAL_ADMIN_TOKEN;
  });

  it('admin bearer resolves to @admin', () => {
    const { request, rawBody } = makeRequest({
      headers: { authorization: 'Bearer test-admin-secret' }
    });
    const result = requireChatRoomMutationAuth('room_a', request, rawBody);
    expect(result.handle).toBe(ADMIN_BEARER_HANDLE);
    expect(result.isAdminBearer).toBe(true);
  });

  it('admin bearer rejects a mismatched token (falls through to 401)', () => {
    const { request, rawBody } = makeRequest({
      headers: { authorization: 'Bearer not-the-real-secret' }
    });
    try {
      requireChatRoomMutationAuth('room_a', request, rawBody);
      throw new Error('should have thrown');
    } catch (failure) {
      const httpFailure = failure as { status?: number };
      expect(httpFailure.status).toBe(401);
    }
  });

  it('browser-session cookie resolves to the bound handle', () => {
    const room = createChatRoom({ name: 'cookie-test', whoCreatedIt: '@you' });
    const terminal = upsertTerminal({
      pid: 991_001,
      pid_start: 'auth-gate-test-start',
      name: 'auth-gate-test',
      ttlSeconds: 60 * 60
    });
    addMembership({ room_id: room.id, handle: '@you', terminal_id: terminal.id });
    const session = createBrowserSession({ roomId: room.id, authorHandle: '@you' });
    if (!session) throw new Error('createBrowserSession returned null');
    const { request, rawBody } = makeRequest({
      headers: { cookie: `ant_browser_session=${session.browserSessionSecret}` }
    });
    const result = requireChatRoomMutationAuth(room.id, request, rawBody);
    expect(result.handle).toBe('@you');
    expect(result.isAdminBearer).toBe(false);
  });

  it('no auth at all throws 401', () => {
    const { request, rawBody } = makeRequest({ body: { newName: 'whatever' } });
    try {
      requireChatRoomMutationAuth('room_a', request, rawBody);
      throw new Error('should have thrown');
    } catch (failure) {
      const httpFailure = failure as { status?: number };
      expect(httpFailure.status).toBe(401);
    }
  });

  it('admin bearer wins over an invalid antchat-style bearer (precedence)', () => {
    // Admin bearer is tried before antchat bearer; a token that matches
    // ANT_ADMIN_TOKEN should succeed even if it would also be tried as
    // an antchat token (which would fail).
    const { request, rawBody } = makeRequest({
      headers: { authorization: 'Bearer test-admin-secret' }
    });
    const result = requireChatRoomMutationAuth('room_a', request, rawBody);
    expect(result.isAdminBearer).toBe(true);
  });

  // T7 of plan_consent_gate_2026_05_20 (JWPK-locked 2026-05-20):
  // admin-bearer must never be allowed to attribute writes to a registered
  // human handle. Sentinel @admin attribution still works; any other
  // declared authorHandle is checked against owner_handles, and a human-
  // kind handle 403s with `admin_cannot_impersonate_human`.
  it('admin bearer + authorHandle "@admin" still resolves to @admin (happy path)', () => {
    const { request, rawBody } = makeRequest({
      headers: { authorization: 'Bearer test-admin-secret' },
      body: { authorHandle: '@admin', body: 'hello from admin' }
    });
    const result = requireChatRoomMutationAuth('room_a', request, rawBody);
    expect(result.handle).toBe(ADMIN_BEARER_HANDLE);
    expect(result.isAdminBearer).toBe(true);
  });

  it('admin bearer rejects authorHandle that maps to a registered human owner (403)', () => {
    createOwner({ handle: '@james', password: 'hunter2pw' });
    const { request, rawBody } = makeRequest({
      headers: { authorization: 'Bearer test-admin-secret' },
      body: { authorHandle: '@james', body: 'spoof attempt' }
    });
    try {
      requireChatRoomMutationAuth('room_a', request, rawBody);
      throw new Error('should have thrown');
    } catch (failure) {
      const httpFailure = failure as { status?: number; body?: { message?: string } };
      expect(httpFailure.status).toBe(403);
      expect(httpFailure.body?.message).toBe('admin_cannot_impersonate_human');
    }
  });

  it('admin token unset falls through (returns 401 with no other auth)', () => {
    delete process.env.ANT_ADMIN_TOKEN;
    const { request, rawBody } = makeRequest({
      headers: { authorization: 'Bearer anything' }
    });
    try {
      requireChatRoomMutationAuth('room_a', request, rawBody);
      throw new Error('should have thrown');
    } catch (failure) {
      const httpFailure = failure as { status?: number };
      expect(httpFailure.status).toBe(401);
    }
  });
});
