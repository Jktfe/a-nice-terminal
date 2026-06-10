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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireChatRoomMutationAuth, requireAdminBearerOrThrow, ADMIN_BEARER_HANDLE } from './chatRoomAuthGate';
import { resetIdentityDbForTests } from './db';
import { createBrowserSession } from './browserSessionStore';
import { createChatRoom, inviteAgentToRoom, resetChatRoomStoreForTests } from './chatRoomStore';
import { addMembership } from './roomMembershipsStore';
import { upsertTerminal } from './terminalsStore';
import { createOwner } from './ownersStore';
import { createSession } from './antSessionStore';
import { claimHandle } from './roomHandleLeaseClean';
import { sessionFingerprint } from './tokenTerminalBinding';

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
    addMembership({ room_id: room.id, handle: '@JWPK', terminal_id: terminal.id });
    const session = createBrowserSession({ roomId: room.id, authorHandle: '@JWPK' });
    if (!session) throw new Error('createBrowserSession returned null');
    const { request, rawBody } = makeRequest({
      headers: { cookie: `ant_browser_session=${session.browserSessionSecret}` }
    });
    const result = requireChatRoomMutationAuth(room.id, request, rawBody);
    expect(result.handle).toBe('@JWPK');
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

  // JWPK msg_athx11bshr antV4 2026-05-28: /rooms delete/archive silently
  // failed because the browser session cookie was minted in a different
  // room than the one being acted on. Step 3b adds an
  // ignore-room-scope-but-verify-membership fallback.
  describe('step 3b: cross-room cookie + membership fallback', () => {
    it('AC1: cookie minted for room A allows action on room B when caller is a member of B', () => {
      // Setup: caller has membership in BOTH rooms but their browser
      // session was minted bound to roomA. Without step 3b, an action
      // on roomB would 401. With step 3b, the cookie resolves to the
      // identity ignoring scope + membership-check in roomB passes.
      const roomA = createChatRoom({ name: 'minted-here', whoCreatedIt: '@owner-a' });
      const roomB = createChatRoom({ name: 'acting-here', whoCreatedIt: '@owner-b' });
      const terminal = upsertTerminal({
        pid: 991_002,
        pid_start: 'auth-gate-cross-room-test',
        name: 'auth-gate-cross-room-test',
        ttlSeconds: 60 * 60
      });
      // Browser-session minting still checks room_memberships, while the
      // cross-room fallback checks v0.2 membership. Seed both surfaces so
      // this test exercises the intended bridge instead of fixture drift.
      addMembership({ room_id: roomA.id, handle: '@cross-room', terminal_id: terminal.id });
      addMembership({ room_id: roomB.id, handle: '@cross-room', terminal_id: terminal.id });
      inviteAgentToRoom({ roomId: roomA.id, agentHandle: '@cross-room' });
      inviteAgentToRoom({ roomId: roomB.id, agentHandle: '@cross-room' });
      const session = createBrowserSession({ roomId: roomA.id, authorHandle: '@cross-room' });
      if (!session) throw new Error('createBrowserSession returned null');
      const { request, rawBody } = makeRequest({
        headers: { cookie: `ant_browser_session=${session.browserSessionSecret}` }
      });
      // Acting on roomB (NOT roomA where the cookie was minted):
      const result = requireChatRoomMutationAuth(roomB.id, request, rawBody);
      expect(result.handle).toBe('@cross-room');
      expect(result.isAdminBearer).toBe(false);
    });

    it('AC2: cookie minted for room A does NOT allow action on room B when caller is NOT a member of B', () => {
      // Security boundary preserved: the fallback only relaxes the
      // cookie scope, not the membership requirement.
      // Using @stranger (non-@you handle) because createChatRoom
      // auto-adds @you as a member of every non-@you-created room
      // (Task #138). The @stranger handle is not auto-added anywhere.
      const roomA = createChatRoom({ name: 'minted-here', whoCreatedIt: '@stranger' });
      const roomB = createChatRoom({ name: 'no-membership-here', whoCreatedIt: '@another-stranger' });
      const terminal = upsertTerminal({
        pid: 991_003,
        pid_start: 'auth-gate-no-member-test',
        name: 'auth-gate-no-member-test',
        ttlSeconds: 60 * 60
      });
      addMembership({ room_id: roomA.id, handle: '@stranger', terminal_id: terminal.id });
      // No membership added for @stranger in roomB; @stranger is not
      // the creator of roomB so the Task-#138 @you auto-add does not
      // affect them either.
      const session = createBrowserSession({ roomId: roomA.id, authorHandle: '@stranger' });
      if (!session) throw new Error('createBrowserSession returned null');
      const { request, rawBody } = makeRequest({
        headers: { cookie: `ant_browser_session=${session.browserSessionSecret}` }
      });
      try {
        requireChatRoomMutationAuth(roomB.id, request, rawBody);
        throw new Error('should have thrown');
      } catch (failure) {
        const httpFailure = failure as { status?: number };
        expect(httpFailure.status).toBe(401);
      }
    });
  });
});

describe('requireChatRoomMutationAuth — Step 3c: ANT clean session lease (anti-flood lever 4)', () => {
  // Before this step existed, agents authenticating by session token (the
  // clean model) 401'd on EVERY non-post mutation — reactions, typing,
  // breaks, focus-mode, member-remove — because the gate only tried pidChain.
  // That's the "ant reaction add 401s for agents" blocker. These pin the fix:
  // accept the same x-ant-session-id the chat-message POST path accepts,
  // membership-gated via the clean lease.
  beforeEach(() => {
    resetIdentityDbForTests();
    resetChatRoomStoreForTests();
    delete process.env.ANT_TOKEN_TERMINAL_BINDING;
  });

  afterEach(() => {
    delete process.env.ANT_TOKEN_TERMINAL_BINDING;
    vi.restoreAllMocks();
  });

  it('a clean-session MEMBER resolves via x-ant-session-id header (was 401)', () => {
    const room = createChatRoom({ name: 'react-room', whoCreatedIt: '@test' });
    const session = createSession({ kind: 'local-cli', label: 'agent-x' });
    claimHandle(room.id, '@agent-x', session.id);
    const { request, rawBody } = makeRequest({ headers: { 'x-ant-session-id': session.id }, body: {} });
    const result = requireChatRoomMutationAuth(room.id, request, rawBody);
    expect(result.handle).toBe('@agent-x');
    expect(result.isAdminBearer).toBe(false);
  });

  it('a clean session that is NOT a member of the room still 401s (membership-gated, grants nothing new)', () => {
    const room = createChatRoom({ name: 'react-room-2', whoCreatedIt: '@test' });
    const session = createSession({ kind: 'local-cli', label: 'outsider' });
    // no claimHandle → not a clean member of this room
    const { request, rawBody } = makeRequest({ headers: { 'x-ant-session-id': session.id }, body: {} });
    expect(() => requireChatRoomMutationAuth(room.id, request, rawBody)).toThrow();
  });

  it('accepts the session id from the body (sessionId field) too, mirroring the post path', () => {
    const room = createChatRoom({ name: 'react-room-3', whoCreatedIt: '@test' });
    const session = createSession({ kind: 'local-cli', label: 'body-agent' });
    claimHandle(room.id, '@body-agent', session.id);
    const { request, rawBody } = makeRequest({ body: { sessionId: session.id } });
    const result = requireChatRoomMutationAuth(room.id, request, rawBody);
    expect(result.handle).toBe('@body-agent');
    expect(result.isAdminBearer).toBe(false);
  });

  it('an unknown/garbage session id falls through to 401 (no identity)', () => {
    const room = createChatRoom({ name: 'react-room-4', whoCreatedIt: '@test' });
    const { request, rawBody } = makeRequest({ headers: { 'x-ant-session-id': 'not-a-real-session' }, body: {} });
    expect(() => requireChatRoomMutationAuth(room.id, request, rawBody)).toThrow();
  });

  it('strict token-terminal binding rejects a clean-session token presented from the wrong terminal', () => {
    process.env.ANT_TOKEN_TERMINAL_BINDING = 'strict';
    const room = createChatRoom({ name: 'react-room-5', whoCreatedIt: '@test' });
    const ownerTerminal = upsertTerminal({
      pid: 991_004,
      pid_start: 'auth-gate-token-owner',
      name: 'auth-gate-token-owner',
      ttlSeconds: 60 * 60
    });
    const attackerTerminal = upsertTerminal({
      pid: 991_005,
      pid_start: 'auth-gate-token-attacker',
      name: 'auth-gate-token-attacker',
      ttlSeconds: 60 * 60
    });
    const session = createSession({
      kind: 'local-cli',
      label: 'bound-agent',
      terminalId: ownerTerminal.id
    });
    claimHandle(room.id, '@bound-agent', session.id);
    const { request, rawBody } = makeRequest({
      headers: { 'x-ant-session-id': session.id },
      body: {
        pidChain: [{ pid: attackerTerminal.pid, pid_start: attackerTerminal.pid_start }]
      }
    });

    try {
      requireChatRoomMutationAuth(room.id, request, rawBody);
      throw new Error('should have thrown');
    } catch (failure) {
      const httpFailure = failure as { status?: number; body?: { message?: string } };
      expect(httpFailure.status).toBe(401);
      expect(httpFailure.body?.message).toBe('ANT session token presented from a terminal it is not bound to.');
    }
  });

  it('flag-mode token-terminal binding logs fingerprints only and still allows the mutation', () => {
    process.env.ANT_TOKEN_TERMINAL_BINDING = 'flag';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const room = createChatRoom({ name: 'react-room-6', whoCreatedIt: '@test' });
    const ownerTerminal = upsertTerminal({
      pid: 991_006,
      pid_start: 'auth-gate-token-owner-flag',
      name: 'auth-gate-token-owner-flag',
      ttlSeconds: 60 * 60
    });
    const attackerTerminal = upsertTerminal({
      pid: 991_007,
      pid_start: 'auth-gate-token-attacker-flag',
      name: 'auth-gate-token-attacker-flag',
      ttlSeconds: 60 * 60
    });
    const session = createSession({
      kind: 'local-cli',
      label: 'flag-agent',
      terminalId: ownerTerminal.id
    });
    claimHandle(room.id, '@flag-agent', session.id);
    const { request, rawBody } = makeRequest({
      headers: { 'x-ant-session-id': session.id },
      body: {
        pidChain: [{ pid: attackerTerminal.pid, pid_start: attackerTerminal.pid_start }]
      }
    });

    const result = requireChatRoomMutationAuth(room.id, request, rawBody);

    expect(result.handle).toBe('@flag-agent');
    const logged = warn.mock.calls.map((args) => args.join(' ')).join('\n');
    expect(logged).toContain('[token-binding:flag]');
    expect(logged).toContain(`session_fp=${sessionFingerprint(session.id)}`);
    expect(logged).not.toContain(session.id);
    expect(logged).not.toContain(ownerTerminal.id);
    expect(logged).not.toContain(attackerTerminal.id);
    warn.mockRestore();
  });
});

describe('requireAdminBearerOrThrow (constant-time admin gate, Tranche 1.5)', () => {
  const ORIG = process.env.ANT_ADMIN_TOKEN;
  beforeEach(() => { process.env.ANT_ADMIN_TOKEN = 'admin-secret-token'; });
  afterEach(() => {
    if (ORIG === undefined) delete process.env.ANT_ADMIN_TOKEN;
    else process.env.ANT_ADMIN_TOKEN = ORIG;
  });

  function req(headers: Record<string, string> = {}): Request {
    return new Request('http://localhost/admin', { headers });
  }
  function statusOf(fn: () => void): number {
    try { fn(); return 200; }
    catch (e) {
      const f = e as { status?: number };
      return typeof f?.status === 'number' ? f.status : 500;
    }
  }

  it('401 when no Bearer header is presented', () => {
    expect(statusOf(() => requireAdminBearerOrThrow(req()))).toBe(401);
  });

  it('403 when the token is wrong', () => {
    expect(statusOf(() => requireAdminBearerOrThrow(req({ authorization: 'Bearer wrong-token' })))).toBe(403);
  });

  it('403 when no admin token is configured', () => {
    delete process.env.ANT_ADMIN_TOKEN;
    expect(statusOf(() => requireAdminBearerOrThrow(req({ authorization: 'Bearer anything' })))).toBe(403);
  });

  it('passes with the correct token', () => {
    expect(statusOf(() => requireAdminBearerOrThrow(req({ authorization: 'Bearer admin-secret-token' })))).toBe(200);
  });
});
