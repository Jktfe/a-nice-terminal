/**
 * /api/permission-requests/[requestId]/deny endpoint tests — Stage B
 * substrate (plan milestone p3-stage-b-permission-requests of
 * ant-substrate-v0.2-2026-05-29).
 *
 * Mirrors the approve test shape: same approver gate, denial flow,
 * decided-twice 409, missing-request 404, unauthenticated 401.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST } from './+server';
import { resetIdentityDbForTests } from '$lib/server/db';
import {
  createPermissionRequest,
  getPendingActionForRequest,
  resetPermissionRequestsForTests
} from '$lib/server/permissionRequestsStore';
import { resetGrantsShimForTests } from '$lib/server/grantsShimStore';
import { createChatRoom } from '$lib/server/chatRoomStore';
import { upsertTerminal } from '$lib/server/terminalsStore';
import { addMembership } from '$lib/server/roomMembershipsStore';
import { createTerminalRecord } from '$lib/server/terminalRecordsStore';

let tmpDir: string;
const previousDbEnv = process.env.ANT_FRESH_DB_PATH;
const previousAdminToken = process.env.ANT_ADMIN_TOKEN;
const TEST_ADMIN = 'admin-token-for-deny-tests';

type AnyHandler = (event: unknown) => unknown;

function eventFor(requestId: string, init: RequestInit): unknown {
  const url = new URL(
    `http://localhost/api/permission-requests/${requestId}/deny`
  );
  const request = new Request(url.toString(), { method: 'POST', ...init });
  return { request, params: { requestId }, url };
}

async function runHandler(handler: AnyHandler, event: unknown): Promise<Response> {
  try {
    return (await handler(event)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const httpFailure = thrown as { status?: number; body?: unknown };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), {
        status: httpFailure.status
      });
    }
    throw thrown;
  }
}

function seedTerminal(handle: string, pid: number, roomId: string) {
  const terminal = upsertTerminal({
    pid,
    pid_start: `2026-05-29T20:00:0${pid % 10}.000Z`,
    name: `term-${pid}`,
    ttlSeconds: 60 * 60
  });
  // sec-iter1 Fix #1: caller-handle resolution now reads
  // terminal_records.handle (authoritative) rather than per-room
  // memberships[0].handle. Tests must seed BOTH the legacy membership
  // row (for the existing approver-list shape) AND the terminal_records
  // row (so the new gate resolves the caller's declared handle).
  createTerminalRecord({
    sessionId: terminal.id,
    name: `term-${pid}`,
    handle
  });
  addMembership({ room_id: roomId, handle, terminal_id: terminal.id });
  return { terminal, pidChainEntry: { pid, pid_start: `2026-05-29T20:00:0${pid % 10}.000Z` } };
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-permission-deny-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  process.env.ANT_ADMIN_TOKEN = TEST_ADMIN;
  resetIdentityDbForTests();
  resetGrantsShimForTests();
  resetPermissionRequestsForTests();
});

afterEach(() => {
  if (previousDbEnv === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousDbEnv;
  if (previousAdminToken === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = previousAdminToken;
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('POST /api/permission-requests/[requestId]/deny', () => {
  it('admin-bearer can deny + pending_action flips to denied', async () => {
    const room = createChatRoom({ name: 'deny-ok', whoCreatedIt: '@jwpk' });
    const created = createPermissionRequest({
      requesterHandle: '@speedyc',
      action: 'chat.post',
      targetKind: 'room',
      targetId: room.id,
      approvers: [{ handle: '@jwpk', role: 'room_owner', preferred: true }],
      pendingAction: {
        httpMethod: 'POST',
        httpPath: `/api/chat-rooms/${room.id}/messages`,
        payloadJson: '{}'
      }
    });
    const event = eventFor(created.request.requestId, {
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TEST_ADMIN}`
      },
      body: JSON.stringify({ reason: 'not appropriate' })
    });
    const response = await runHandler(POST as AnyHandler, event);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { request: { status: string; reason: string } };
    expect(body.request.status).toBe('denied');
    expect(body.request.reason).toContain('not appropriate');
    const pa = getPendingActionForRequest(created.request.requestId);
    expect(pa?.replayStatus).toBe('denied');
  });

  it('room owner can deny their own room request', async () => {
    const room = createChatRoom({ name: 'owner-deny', whoCreatedIt: '@deny-owner' });
    const created = createPermissionRequest({
      requesterHandle: '@speedyc',
      action: 'chat.post',
      targetKind: 'room',
      targetId: room.id,
      approvers: [{ handle: '@deny-owner', role: 'room_owner', preferred: true }]
    });
    const { pidChainEntry } = seedTerminal('@deny-owner', 90001, room.id);
    const event = eventFor(created.request.requestId, {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pidChain: [pidChainEntry] })
    });
    const response = await runHandler(POST as AnyHandler, event);
    expect(response.status).toBe(200);
  });

  it('non-approver gets 403 with structured payload', async () => {
    const room = createChatRoom({ name: 'no-deny', whoCreatedIt: '@jwpk' });
    const created = createPermissionRequest({
      requesterHandle: '@speedyc',
      action: 'chat.post',
      targetKind: 'room',
      targetId: room.id,
      approvers: [{ handle: '@jwpk', role: 'room_owner', preferred: true }]
    });
    const otherRoom = createChatRoom({ name: 'other', whoCreatedIt: '@other' });
    const { pidChainEntry } = seedTerminal('@rando', 90002, otherRoom.id);
    const event = eventFor(created.request.requestId, {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pidChain: [pidChainEntry] })
    });
    const response = await runHandler(POST as AnyHandler, event);
    expect(response.status).toBe(403);
    const body = (await response.json()) as { permission_denied?: { reason?: string } };
    expect(body.permission_denied?.reason).toBe('not_room_owner');
  });

  it('returns 401 on unauthenticated probe', async () => {
    delete process.env.ANT_ADMIN_TOKEN;
    const event = eventFor('req_x', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({})
    });
    const response = await runHandler(POST as AnyHandler, event);
    expect(response.status).toBe(401);
  });

  it('returns 404 when request does not exist', async () => {
    const event = eventFor('req_nope', {
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TEST_ADMIN}`
      },
      body: JSON.stringify({})
    });
    const response = await runHandler(POST as AnyHandler, event);
    expect(response.status).toBe(404);
  });

  it('returns 409 when request is already denied', async () => {
    const room = createChatRoom({ name: 'double-deny', whoCreatedIt: '@jwpk' });
    const created = createPermissionRequest({
      requesterHandle: '@s',
      action: 'chat.post',
      targetKind: 'room',
      targetId: room.id,
      approvers: [{ handle: '@jwpk', role: 'room_owner', preferred: true }]
    });
    await runHandler(
      POST as AnyHandler,
      eventFor(created.request.requestId, {
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${TEST_ADMIN}`
        },
        body: JSON.stringify({})
      })
    );
    const response = await runHandler(
      POST as AnyHandler,
      eventFor(created.request.requestId, {
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${TEST_ADMIN}`
        },
        body: JSON.stringify({})
      })
    );
    expect(response.status).toBe(409);
  });

  // sec-iter1 Fix #1 attack-scenario tests for the deny gate (mirror
  // of the approve test cases). Same attack surface, same fix.
  describe('sec-iter1 Fix #1: privilege escalation via memberships[0]', () => {
    it('rejects the attack via deny path: caller per-room membership row reuses victim handle but terminal_records.handle is attacker handle', async () => {
      const room = createChatRoom({ name: 'esc-deny', whoCreatedIt: '@jwpk' });
      const created = createPermissionRequest({
        requesterHandle: '@speedyc',
        action: 'chat.post',
        targetKind: 'room',
        targetId: room.id,
        approvers: [{ handle: '@jwpk', role: 'room_owner', preferred: true }]
      });
      const attackerTerminal = upsertTerminal({
        pid: 90050,
        pid_start: '2026-05-30T00:00:00.000Z',
        name: 'attacker-deny-pane',
        ttlSeconds: 60 * 60
      });
      createTerminalRecord({
        sessionId: attackerTerminal.id,
        name: 'attacker-deny-pane',
        handle: '@attacker'
      });
      const otherRoom = createChatRoom({ name: 'noise', whoCreatedIt: '@otherowner' });
      addMembership({
        room_id: otherRoom.id,
        handle: '@jwpk',
        terminal_id: attackerTerminal.id
      });

      const event = eventFor(created.request.requestId, {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          pidChain: [{ pid: 90050, pid_start: '2026-05-30T00:00:00.000Z' }]
        })
      });
      const response = await runHandler(POST as AnyHandler, event);
      expect(response.status).toBe(403);
      const body = (await response.json()) as {
        permission_denied?: { reason?: string };
      };
      expect(body.permission_denied?.reason).toBe('not_room_owner');
    });

    it('fail-closes (401) when caller terminal has no terminal_records row', async () => {
      const room = createChatRoom({ name: 'deny-no-record', whoCreatedIt: '@jwpk' });
      const created = createPermissionRequest({
        requesterHandle: '@speedyc',
        action: 'chat.post',
        targetKind: 'room',
        targetId: room.id,
        approvers: [{ handle: '@jwpk', role: 'room_owner', preferred: true }]
      });
      const terminal = upsertTerminal({
        pid: 90060,
        pid_start: '2026-05-30T00:00:01.000Z',
        name: 'deny-no-record',
        ttlSeconds: 60 * 60
      });
      addMembership({ room_id: room.id, handle: '@jwpk', terminal_id: terminal.id });

      const event = eventFor(created.request.requestId, {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          pidChain: [{ pid: 90060, pid_start: '2026-05-30T00:00:01.000Z' }]
        })
      });
      const response = await runHandler(POST as AnyHandler, event);
      expect(response.status).toBe(401);
    });
  });

  it('rejects non-string reason (400)', async () => {
    const room = createChatRoom({ name: 'bad-reason', whoCreatedIt: '@jwpk' });
    const created = createPermissionRequest({
      requesterHandle: '@s',
      action: 'chat.post',
      targetKind: 'room',
      targetId: room.id,
      approvers: [{ handle: '@jwpk', role: 'room_owner', preferred: true }]
    });
    const event = eventFor(created.request.requestId, {
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TEST_ADMIN}`
      },
      body: JSON.stringify({ reason: 12345 })
    });
    const response = await runHandler(POST as AnyHandler, event);
    expect(response.status).toBe(400);
  });

  /**
   * Sec-iter2 Fix #3 (2026-05-30): same structural fix as approve —
   * admin-spoofing via a planted '@admin' handle no longer succeeds
   * because the gate reads `caller.isAdminBearer` (proven token) and
   * not a string-eq to ADMIN_BEARER_HANDLE.
   */
  describe('sec-iter2 Fix #3: typed isAdminBearer discriminator (structural)', () => {
    it('planted @admin handle does NOT bypass the deny gate', async () => {
      const { getIdentityDb } = await import('$lib/server/db');
      const room = createChatRoom({ name: 'iter2-deny', whoCreatedIt: '@jwpk' });
      const created = createPermissionRequest({
        requesterHandle: '@speedyc',
        action: 'chat.post',
        targetKind: 'room',
        targetId: room.id,
        approvers: [{ handle: '@jwpk', role: 'room_owner', preferred: true }]
      });
      const terminal = upsertTerminal({
        pid: 70080,
        pid_start: '2026-05-30T01:00:00.000Z',
        name: 'deny-spoof',
        ttlSeconds: 60 * 60
      });
      // Plant @admin via raw SQL (the public API rejects this; the test
      // simulates a hypothetical future writer that forgot the
      // choke-point validation).
      const now = Date.now();
      getIdentityDb().prepare(
        `INSERT INTO terminal_records (session_id, name, auto_forward_chat, tmux_target_pane, handle, created_at_ms, updated_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(terminal.id, 'deny-spoof', 1, `${terminal.id}:0.0`, '@admin', now, now);

      const event = eventFor(created.request.requestId, {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          pidChain: [{ pid: 70080, pid_start: '2026-05-30T01:00:00.000Z' }]
        })
      });
      const response = await runHandler(POST as AnyHandler, event);
      expect(response.status).toBe(403);
    });
  });
});
