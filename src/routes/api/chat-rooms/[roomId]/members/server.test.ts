/**
 * Endpoint tests for POST/DELETE /api/chat-rooms/:roomId/members.
 *
 * Covers M02 invite happy path (already accepted baseline) plus M03 slice 5
 * destructive remove: creator/last-human 409, alias cleanup, system-message
 * emission, fail-closed unknown room/member handling.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { GET, POST, DELETE } from './+server';
import {
  createChatRoom,
  inviteAgentToRoom,
  resetChatRoomStoreForTests,
  findChatRoomById,
  __overrideRoomCreatorForTests
} from '$lib/server/chatRoomStore';
import {
  listMessagesInRoom,
  resetChatMessageStoreForTests
} from '$lib/server/chatMessageStore';
import {
  setRoomAlias,
  findAliasForHandleInRoom,
  resetChatRoomAliasStoreForTests
} from '$lib/server/chatRoomAliasStore';
import { getIdentityDb, resetIdentityDbForTests } from '$lib/server/db';
import { upsertTerminal } from '$lib/server/terminalsStore';
import { addMembership, getTerminalIdByHandle } from '$lib/server/roomMembershipsStore';
import { resolveMember } from '$lib/server/membershipStore';
import { getSession } from '$lib/server/antSessionStore';
import { createTerminalRecord } from '$lib/server/terminalRecordsStore';
import { getLiveBinding } from '$lib/server/handleBindingsStore';
import { issueToken } from '$lib/server/antchatAuthStore';
import { installFixtureOrgHandleMap } from '$lib/server/testSupport/orgIdentityFixtures';
import {
  listAccountsOrgMembersForRequest,
  listLocalLicensedOrgMembers
} from '$lib/server/accountsOrgMembers';

vi.mock('$lib/server/accountsOrgMembers', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/accountsOrgMembers')>(
    '$lib/server/accountsOrgMembers'
  );
  return {
    ...actual,
    listAccountsOrgMembersForRequest: vi.fn(),
    listLocalLicensedOrgMembers: vi.fn(actual.listLocalLicensedOrgMembers)
  };
});

const listAccountsOrgMembersForRequestMock = vi.mocked(listAccountsOrgMembersForRequest);
const listLocalLicensedOrgMembersMock = vi.mocked(listLocalLicensedOrgMembers);

// INVITE-VALIDATE (2026-05-15): POST /members now requires the invited
// handle to resolve to a terminal_records row. Tests that expect a 201
// must seed the row first; this helper keeps that setup one line.
// Counter-in-name guarantees uniqueness across tests when the same
// handle is seeded multiple times (terminal_records.name is UNIQUE).
let nextSeedSessionId = 1;
function seedTerminalForHandle(handle: string): string {
  const n = nextSeedSessionId++;
  const terminal = upsertTerminal({
    pid: 710_000 + n,
    pid_start: `seed-start-${n}`,
    name: `identity-${handle.replace(/^@/, '')}-seed-${n}`,
    ttlSeconds: 60 * 60
  });
  // sec-iter1 Fix #2 (2026-05-30): the partial UNIQUE INDEX
  // `terminal_records_handle_unique` rejects a second active row with
  // the same handle. The members test file shares a DB across tests
  // (no per-test mkdtempSync) so when the same handle is seeded in
  // back-to-back tests we must first supersede any prior live row
  // before claiming the handle on the new session_id. Supersession
  // (not deletion) preserves audit history.
  const db = getIdentityDb();
  db.prepare(
    `UPDATE terminal_records
        SET superseded_at_ms = ?
      WHERE handle = ?
        AND superseded_at_ms IS NULL`
  ).run(Date.now() - 1, handle);
  createTerminalRecord({
    sessionId: terminal.id,
    name: `${handle.replace(/^@/, '')}-seed-${n}`,
    handle
  });
  return terminal.id;
}

function eventFor(
  method: 'GET' | 'POST' | 'DELETE',
  roomId: string,
  body?: string,
  query = '',
  headers: Record<string, string> = {}
) {
  const url = new URL(`http://localhost/api/chat-rooms/${roomId}/members${query}`);
  const request = new Request(url.toString(), {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body
  });
  return { request, params: { roomId }, url } as unknown as Parameters<typeof POST>[0];
}

async function runHandler(
  handler: (event: Parameters<typeof POST>[0]) => unknown,
  event: Parameters<typeof POST>[0]
): Promise<Response> {
  try {
    return (await handler(event)) as Response;
  } catch (thrownByHandler) {
    if (thrownByHandler instanceof Response) return thrownByHandler;
    const httpFailure = thrownByHandler as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
    }
    throw thrownByHandler;
  }
}

const callPost = (roomId: string, body?: string, headers: Record<string, string> = {}) =>
  runHandler(POST, eventFor('POST', roomId, body, '', headers));
const callGet = (roomId: string, headers: Record<string, string> = {}) =>
  runHandler(GET, eventFor('GET', roomId, undefined, '', headers));
const callDelete = (roomId: string, query?: string, headers: Record<string, string> = {}) =>
  runHandler(DELETE, eventFor('DELETE', roomId, undefined, query ?? '', headers));

describe('/api/chat-rooms/:roomId/members', () => {
  beforeEach(() => {
    resetIdentityDbForTests();
    resetChatRoomStoreForTests();
    resetChatMessageStoreForTests();
    resetChatRoomAliasStoreForTests();
    listAccountsOrgMembersForRequestMock.mockReset();
    listLocalLicensedOrgMembersMock.mockReset();
    // Reproduce the org email→handle map (real emails moved to env/secrets).
    installFixtureOrgHandleMap();
  });

  describe('GET invite candidates', () => {
    it('returns same-org members with inRoom markers for room members', async () => {
      const room = createChatRoom({ name: 'org-members', whoCreatedIt: '@jamesK' });
      const { token } = issueToken('demo-operator@example.test');
      listAccountsOrgMembersForRequestMock.mockResolvedValueOnce({
        orgId: 'org_newmodel_team',
        members: [
          {
            userId: 'user_james',
            email: 'demo-operator@example.test',
            displayName: 'James K',
            handle: '@jamesK',
            role: 'owner'
          },
          {
            userId: 'user_marco',
            email: 'marco@example.test',
            displayName: 'Marco',
            handle: '@marco',
            role: 'member'
          }
        ]
      });

      const response = await callGet(room.id, { authorization: `Bearer ${token}` });

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        orgId: string;
        members: Array<{ handle: string; inRoom: boolean }>;
      };
      expect(body.orgId).toBe('org_newmodel_team');
      expect(body.members.find((member) => member.handle === '@jamesK')?.inRoom).toBe(true);
      expect(body.members.find((member) => member.handle === '@marco')?.inRoom).toBe(false);
    });
  });

  describe('POST invite (M02)', () => {
    it('returns 201, appends the agent, and emits a system message', async () => {
      const room = createChatRoom({ name: 'invite', whoCreatedIt: '@you' });
      const terminalId = seedTerminalForHandle('@evolveantcodex');
      const { token } = issueToken('demo-operator@example.test');
      const response = await callPost(
        room.id,
        JSON.stringify({ agentHandle: '@evolveantcodex' }),
        { authorization: `Bearer ${token}` }
      );
      expect(response.status).toBe(201);
      const updated = findChatRoomById(room.id);
      expect(updated?.members.some((m) => m.handle === '@evolveantcodex')).toBe(true);
      expect(getTerminalIdByHandle(room.id, '@evolveantcodex')).toBe(terminalId);
      const sessionId = resolveMember(room.id, '@evolveantcodex');
      expect(sessionId).toBeTruthy();
      expect(getSession(sessionId!)?.terminal_id).toBe(terminalId);
      expect(getLiveBinding('@evolveantcodex')?.terminal_id).toBe(terminalId);
      const systemMessages = listMessagesInRoom(room.id).filter((m) => m.kind === 'system');
      expect(systemMessages.some((m) => m.body.includes('joined'))).toBe(true);
    });

    it('repairs delivery binding when the chat member already exists', async () => {
      const room = createChatRoom({ name: 'invite-repair', whoCreatedIt: '@you' });
      const terminalId = seedTerminalForHandle('@evolveantcodex');
      inviteAgentToRoom({ roomId: room.id, agentHandle: '@evolveantcodex' });
      expect(getTerminalIdByHandle(room.id, '@evolveantcodex')).toBeNull();
      const { token } = issueToken('demo-operator@example.test');

      const response = await callPost(
        room.id,
        JSON.stringify({ agentHandle: '@evolveantcodex' }),
        { authorization: `Bearer ${token}` }
      );

      expect(response.status).toBe(200);
      expect(getTerminalIdByHandle(room.id, '@evolveantcodex')).toBe(terminalId);
      const sessionId = resolveMember(room.id, '@evolveantcodex');
      expect(sessionId).toBeTruthy();
      expect(getSession(sessionId!)?.terminal_id).toBe(terminalId);
      expect(getLiveBinding('@evolveantcodex')?.terminal_id).toBe(terminalId);
      const systemMessages = listMessagesInRoom(room.id).filter((m) => m.kind === 'system');
      expect(systemMessages.filter((m) => m.body.includes('joined'))).toHaveLength(0);
    });

    it('returns 400 on missing agentHandle', async () => {
      const room = createChatRoom({ name: 'no-handle', whoCreatedIt: '@you' });
      const response = await callPost(room.id, JSON.stringify({}));
      expect(response.status).toBe(400);
    });

    it('adds a same-org human member without requiring a terminal record', async () => {
      const room = createChatRoom({ name: 'human-invite', whoCreatedIt: '@jamesK' });
      const { token } = issueToken('demo-operator@example.test');
      listAccountsOrgMembersForRequestMock.mockResolvedValueOnce({
        orgId: 'org_newmodel_team',
        members: [
          {
            userId: 'user_marco',
            email: 'marco@example.test',
            displayName: 'Marco',
            handle: '@marco',
            role: 'member'
          }
        ]
      });

      const response = await callPost(
        room.id,
        JSON.stringify({ handle: '@marco' }),
        { authorization: `Bearer ${token}` }
      );

      expect(response.status).toBe(200);
      const updated = findChatRoomById(room.id);
      expect(updated?.members.find((member) => member.handle === '@marco')).toMatchObject({
        displayName: 'Marco',
        kind: 'human'
      });
      expect(getTerminalIdByHandle(room.id, '@marco')).toBeNull();
      const systemMessages = listMessagesInRoom(room.id).filter((m) => m.kind === 'system');
      expect(systemMessages.some((m) => m.body === '@marco joined this room.')).toBe(true);
    });

    it('rejects same-org human invite when the target handle is outside the caller org', async () => {
      const room = createChatRoom({ name: 'human-invite-cross-org', whoCreatedIt: '@jamesK' });
      const { token } = issueToken('demo-operator@example.test');
      listAccountsOrgMembersForRequestMock.mockResolvedValueOnce({
        orgId: 'org_newmodel_team',
        members: [
          {
            userId: 'user_mark',
            email: 'demo-mark@example.test',
            displayName: 'Mark Tester',
            handle: '@mark',
            role: 'member'
          }
        ]
      });

      const response = await callPost(
        room.id,
        JSON.stringify({ handle: '@outsider' }),
        { authorization: `Bearer ${token}` }
      );

      expect(response.status).toBe(403);
      expect(findChatRoomById(room.id)?.members.some((member) => member.handle === '@outsider')).toBe(false);
    });

    it('rejects same-org human invite for unauthenticated callers', async () => {
      const room = createChatRoom({ name: 'human-invite-unauth', whoCreatedIt: '@jamesK' });

      const response = await callPost(room.id, JSON.stringify({ handle: '@marco' }));

      expect(response.status).toBe(401);
      expect(listAccountsOrgMembersForRequestMock).not.toHaveBeenCalled();
    });
  });

  describe('DELETE remove (M03 slice 5)', () => {
    it('returns 204, drops the member, and emits a system message', async () => {
      const room = createChatRoom({ name: 'remove-happy', whoCreatedIt: '@you' });
      inviteAgentToRoom({ roomId: room.id, agentHandle: '@evolveantcodex' });
      const terminalId = seedTerminalForHandle('@evolveantcodex');
      addMembership({ room_id: room.id, handle: '@evolveantcodex', terminal_id: terminalId });
      const { token } = issueToken('demo-operator@example.test');

      const response = await callDelete(
        room.id,
        '?globalHandle=' + encodeURIComponent('@evolveantcodex'),
        { authorization: `Bearer ${token}` }
      );
      expect(response.status).toBe(204);

      const updated = findChatRoomById(room.id);
      expect(updated?.members.some((m) => m.handle === '@evolveantcodex')).toBe(false);
      expect(getTerminalIdByHandle(room.id, '@evolveantcodex')).toBeNull();

      const systemMessages = listMessagesInRoom(room.id).filter((m) => m.kind === 'system');
      expect(systemMessages.some((m) => m.body === '@evolveantcodex was removed from this room.')).toBe(true);
    });

    it('cleans up the removed member room alias', async () => {
      const room = createChatRoom({ name: 'remove-with-alias', whoCreatedIt: '@you' });
      inviteAgentToRoom({ roomId: room.id, agentHandle: '@evolveantcodex' });
      setRoomAlias({ roomId: room.id, globalHandle: '@evolveantcodex', newAlias: '@cdx' });
      const { token } = issueToken('demo-operator@example.test');

      const response = await callDelete(
        room.id,
        '?globalHandle=' + encodeURIComponent('@evolveantcodex'),
        { authorization: `Bearer ${token}` }
      );
      expect(response.status).toBe(204);
      expect(findAliasForHandleInRoom(room.id, '@evolveantcodex')).toBeUndefined();
    });

    it('normalises a bare handle without @ prefix', async () => {
      const room = createChatRoom({ name: 'remove-bare', whoCreatedIt: '@you' });
      inviteAgentToRoom({ roomId: room.id, agentHandle: '@codex' });
      const { token } = issueToken('demo-operator@example.test');

      const response = await callDelete(room.id, '?globalHandle=codex', { authorization: `Bearer ${token}` });
      expect(response.status).toBe(204);
    });

    it('returns 404 for an unknown room', async () => {
      const response = await callDelete(
        'doesnotexist',
        '?globalHandle=' + encodeURIComponent('@x')
      );
      expect(response.status).toBe(404);
    });

    it('returns 400 when globalHandle query is missing', async () => {
      const room = createChatRoom({ name: 'missing-q', whoCreatedIt: '@you' });
      const response = await callDelete(room.id, '');
      expect(response.status).toBe(400);
    });

    it('returns 404 for a handle that is not a member of the room', async () => {
      const room = createChatRoom({ name: 'nonmember', whoCreatedIt: '@you' });
      const { token } = issueToken('demo-operator@example.test');
      const response = await callDelete(
        room.id,
        '?globalHandle=' + encodeURIComponent('@typo'),
        { authorization: `Bearer ${token}` }
      );
      expect(response.status).toBe(404);
    });

    it('returns 409 with reason creator when trying to remove the room creator', async () => {
      const room = createChatRoom({ name: 'creator-block', whoCreatedIt: '@you' });
      const { token } = issueToken('demo-operator@example.test');
      const response = await callDelete(
        room.id,
        '?globalHandle=' + encodeURIComponent('@you'),
        { authorization: `Bearer ${token}` }
      );
      expect(response.status).toBe(409);
      const body = (await response.json()) as { reason: string };
      expect(body.reason).toBe('creator');
    });

    it('returns 409 with reason last-human when removing the only remaining human after ownership transfer', async () => {
      // Future ownership-transfer flow is not built yet; simulate it via
      // direct whoCreatedIt mutation so the last-human reason is exercised
      // distinctly from the creator reason at the endpoint layer.
      const room = createChatRoom({ name: 'last-human-endpoint', whoCreatedIt: '@you' });
      inviteAgentToRoom({ roomId: room.id, agentHandle: '@codex' });
      __overrideRoomCreatorForTests(room.id, '@codex');
      const { token } = issueToken('demo-operator@example.test');

      const response = await callDelete(
        room.id,
        '?globalHandle=' + encodeURIComponent('@you'),
        { authorization: `Bearer ${token}` }
      );
      expect(response.status).toBe(409);
      const body = (await response.json()) as { reason: string };
      expect(body.reason).toBe('last-human');
    });

    it('does not emit a system message when the remove is blocked', async () => {
      const room = createChatRoom({ name: 'no-system-on-block', whoCreatedIt: '@you' });
      const messagesBefore = listMessagesInRoom(room.id).length;
      await callDelete(room.id, '?globalHandle=' + encodeURIComponent('@you'));
      const messagesAfter = listMessagesInRoom(room.id).length;
      expect(messagesAfter).toBe(messagesBefore);
    });
  });
});

// M3.6a-v1 T2: deprecation-window strict-403 flip on /members POST + DELETE.
// Warning phase preserves 201/204 and tags X-Auth-Deprecation; strict phase
// throws 403 with Q3 hint body. VALID pidChain succeeds in both phases.
// Canonical RQO load-bearing watchpoint: DELETE carries pidChain in JSON body
// (R3 transport-lock) so the gate works without ?pidChain= query-string.
describe('M3.6a-v1 T2 deprecation-gate on /members', () => {
  const previousEnv = process.env.ANT_AUTH_DEPRECATION_CUTOVER_MS;

  beforeEach(() => {
    resetIdentityDbForTests();
    resetChatRoomStoreForTests();
    resetChatMessageStoreForTests();
    resetChatRoomAliasStoreForTests();
    installFixtureOrgHandleMap();
  });

  afterEach(() => {
    if (previousEnv === undefined) delete process.env.ANT_AUTH_DEPRECATION_CUTOVER_MS;
    else process.env.ANT_AUTH_DEPRECATION_CUTOVER_MS = previousEnv;
  });

  function setupRoomWithMemberCaller(roomName: string, pid: number) {
    const room = createChatRoom({ name: roomName, whoCreatedIt: '@you' });
    const terminal = upsertTerminal({ pid, pid_start: `ps${pid}`, name: '@caller' });
    addMembership({ room_id: room.id, handle: '@caller', terminal_id: terminal.id });
    return { room, pidChain: [{ pid, pid_start: `ps${pid}` }] };
  }

  describe('POST /members', () => {
    it('warning phase: no identity → 201 + X-Auth-Deprecation header', async () => {
      process.env.ANT_AUTH_DEPRECATION_CUTOVER_MS = String(Date.now() + 86_400_000);
      const room = createChatRoom({ name: 'mp-warn', whoCreatedIt: '@you' });
      seedTerminalForHandle('@new-agent');
      const response = await callPost(room.id, JSON.stringify({ agentHandle: '@new-agent' }));
      expect(response.status).toBe(201);
      expect(response.headers.get('x-auth-deprecation')).toMatch(/^warning;route=members-post;/);
    });

    it('strict phase: no identity → 403 with Q3 hint body', async () => {
      process.env.ANT_AUTH_DEPRECATION_CUTOVER_MS = '0';
      const room = createChatRoom({ name: 'mp-strict', whoCreatedIt: '@you' });
      const response = await callPost(room.id, JSON.stringify({ agentHandle: '@new-agent' }));
      expect(response.status).toBe(403);
      const payload = await response.json();
      expect(payload.message).toMatch(/Server-resolved identity required/);
    });

    it('strict phase: VALID pidChain → 201 (Q2 pidChain mixed-mode permanent)', async () => {
      process.env.ANT_AUTH_DEPRECATION_CUTOVER_MS = '0';
      const { room, pidChain } = setupRoomWithMemberCaller('mp-valid', 5601);
      seedTerminalForHandle('@new-agent');
      const response = await callPost(room.id, JSON.stringify({ agentHandle: '@new-agent', pidChain }));
      expect(response.status).toBe(201);
      expect(response.headers.get('x-auth-deprecation')).toBeNull();
    });
  });

  describe('DELETE /members', () => {
    function eventForDeleteWithBody(roomId: string, query: string, body: object) {
      const url = new URL(`http://localhost/api/chat-rooms/${roomId}/members${query}`);
      const request = new Request(url.toString(), {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      return { request, params: { roomId }, url } as unknown as Parameters<typeof DELETE>[0];
    }

    it('warning phase: no identity → 204 + X-Auth-Deprecation header', async () => {
      process.env.ANT_AUTH_DEPRECATION_CUTOVER_MS = String(Date.now() + 86_400_000);
      const room = createChatRoom({ name: 'md-warn', whoCreatedIt: '@you' });
      inviteAgentToRoom({ roomId: room.id, agentHandle: '@target' });
      const response = await callDelete(room.id, '?globalHandle=' + encodeURIComponent('@target'));
      expect(response.status).toBe(204);
      expect(response.headers.get('x-auth-deprecation')).toMatch(/^warning;route=members-delete;/);
    });

    it('strict phase: no identity → 403 with Q3 hint body', async () => {
      process.env.ANT_AUTH_DEPRECATION_CUTOVER_MS = '0';
      const room = createChatRoom({ name: 'md-strict', whoCreatedIt: '@you' });
      inviteAgentToRoom({ roomId: room.id, agentHandle: '@target' });
      const response = await callDelete(room.id, '?globalHandle=' + encodeURIComponent('@target'));
      expect(response.status).toBe(403);
      const payload = await response.json();
      expect(payload.message).toMatch(/Server-resolved identity required/);
    });

    it('strict phase R3 transport-lock: DELETE carries pidChain in JSON body → 204', async () => {
      process.env.ANT_AUTH_DEPRECATION_CUTOVER_MS = '0';
      const { room, pidChain } = setupRoomWithMemberCaller('md-body', 5602);
      inviteAgentToRoom({ roomId: room.id, agentHandle: '@target' });
      const event = eventForDeleteWithBody(
        room.id,
        '?globalHandle=' + encodeURIComponent('@target'),
        { pidChain }
      );
      const response = await runHandler(DELETE, event);
      expect(response.status).toBe(204);
      expect(response.headers.get('x-auth-deprecation')).toBeNull();
    });
  });

  // GAP-53 Fix Shape B mirror (2026-05-14, canonical RQO32 greenlight).
  // Invalid ant_browser_session cookie on /members write paths no longer
  // hard-403s — falls through to pidChain / deprecation gate + emits a
  // Max-Age=0 Set-Cookie so the browser drops the bad value.
  describe('GAP-53: authGate Fix Shape B mirror on /members', () => {
    function eventForPostWithCookie(roomId: string, body: string, cookie: string) {
      const url = new URL(`http://localhost/api/chat-rooms/${roomId}/members`);
      const request = new Request(url.toString(), {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body
      });
      return { request, params: { roomId }, url } as unknown as Parameters<typeof POST>[0];
    }

    it('POST /members: invalid cookie falls through + clears stale cookie', async () => {
      process.env.ANT_AUTH_DEPRECATION_CUTOVER_MS = String(Date.now() + 86_400_000);
      const room = createChatRoom({ name: 'gap53-post', whoCreatedIt: '@you' });
      seedTerminalForHandle('@gap53-invitee');
      const event = eventForPostWithCookie(
        room.id,
        JSON.stringify({ agentHandle: '@gap53-invitee' }),
        'ant_browser_session=stale-invalid-bits'
      );
      const response = await runHandler(POST, event);
      expect(response.status).toBe(201);
      const setCookie = response.headers.get('set-cookie') ?? '';
      expect(setCookie).toContain('ant_browser_session=;');
      expect(setCookie).toContain('Max-Age=0');
      expect(setCookie).toContain(`Path=/api/chat-rooms/${room.id}`);
    });

    it('DELETE /members: invalid cookie falls through + clears stale cookie', async () => {
      process.env.ANT_AUTH_DEPRECATION_CUTOVER_MS = String(Date.now() + 86_400_000);
      const room = createChatRoom({ name: 'gap53-delete', whoCreatedIt: '@you' });
      inviteAgentToRoom({ roomId: room.id, agentHandle: '@target' });
      const url = new URL(
        `http://localhost/api/chat-rooms/${room.id}/members?globalHandle=` +
          encodeURIComponent('@target')
      );
      const request = new Request(url.toString(), {
        method: 'DELETE',
        headers: { 'content-type': 'application/json', cookie: 'ant_browser_session=stale-bits' },
        body: JSON.stringify({})
      });
      const event = { request, params: { roomId: room.id }, url } as unknown as Parameters<typeof DELETE>[0];
      const response = await runHandler(DELETE, event);
      expect(response.status).toBe(204);
      const setCookie = response.headers.get('set-cookie') ?? '';
      expect(setCookie).toContain('ant_browser_session=;');
      expect(setCookie).toContain('Max-Age=0');
    });
  });
});
