/**
 * /api/permission-requests/[requestId]/approve endpoint tests — Stage B
 * substrate (plan milestone p3-stage-b-permission-requests of
 * ant-substrate-v0.2-2026-05-29).
 *
 * Covers:
 *   - 404 on unknown request (after auth)
 *   - 409 on already-decided request
 *   - 403 + structured payload for non-approver
 *   - 201 happy path for room owner — grant lands + ready_for_replay set
 *   - admin-bearer bypass
 *   - invalid decisionScope -> 400
 *   - 401 on unauthenticated probe
 *   - non-approver cannot probe via missing-id (401 wins over 404)
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST } from './+server';
import { resetIdentityDbForTests } from '$lib/server/db';
import {
  createPermissionRequest,
  resetPermissionRequestsForTests
} from '$lib/server/permissionRequestsStore';
import {
  lookupActiveGrant,
  resetGrantsShimForTests
} from '$lib/server/grantsShimStore';
import { createChatRoom } from '$lib/server/chatRoomStore';
import { upsertTerminal } from '$lib/server/terminalsStore';
import { addMembership } from '$lib/server/roomMembershipsStore';

let tmpDir: string;
const previousDbEnv = process.env.ANT_FRESH_DB_PATH;
const previousAdminToken = process.env.ANT_ADMIN_TOKEN;
const TEST_ADMIN = 'admin-token-for-approve-tests';

type AnyHandler = (event: unknown) => unknown;

function eventFor(requestId: string, init: RequestInit): unknown {
  const url = new URL(
    `http://localhost/api/permission-requests/${requestId}/approve`
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
  addMembership({ room_id: roomId, handle, terminal_id: terminal.id });
  return { terminal, pidChainEntry: { pid, pid_start: `2026-05-29T20:00:0${pid % 10}.000Z` } };
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-permission-approve-'));
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

describe('POST /api/permission-requests/[requestId]/approve', () => {
  it('admin-bearer bypasses approver gate + writes grant + flips replay_status', async () => {
    const room = createChatRoom({ name: 'admin-ok', whoCreatedIt: '@jwpk' });
    const created = createPermissionRequest({
      requesterHandle: '@speedyc',
      action: 'chat.post',
      targetKind: 'room',
      targetId: room.id,
      approvers: [{ handle: '@jwpk', role: 'room_owner', preferred: true }],
      pendingAction: {
        httpMethod: 'POST',
        httpPath: `/api/chat-rooms/${room.id}/messages`,
        payloadJson: '{"body":"hi"}'
      }
    });

    const event = eventFor(created.request.requestId, {
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TEST_ADMIN}`
      },
      body: JSON.stringify({})
    });
    const response = await runHandler(POST as AnyHandler, event);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      request: { status: string; resultingGrantId: string };
      grant: { grantId: string };
      replay: { ready: boolean; status: string; actionId: string };
    };
    expect(body.request.status).toBe('approved');
    expect(body.grant.grantId).toMatch(/^gr_/);
    expect(body.replay.ready).toBe(true);
    expect(body.replay.status).toBe('ready_for_replay');
    // Grant queryable via existing store helper.
    const grant = lookupActiveGrant({
      granteeHandle: '@speedyc',
      action: 'chat.post',
      targetKind: 'room',
      targetId: room.id
    });
    expect(grant).not.toBeNull();
  });

  it('room owner can approve their own room request', async () => {
    const room = createChatRoom({ name: 'owner-approve', whoCreatedIt: '@jwpk' });
    const created = createPermissionRequest({
      requesterHandle: '@speedyc',
      action: 'chat.post',
      targetKind: 'room',
      targetId: room.id,
      approvers: [{ handle: '@jwpk', role: 'room_owner', preferred: true }]
    });
    const { pidChainEntry } = seedTerminal('@jwpk', 80001, room.id);

    const event = eventFor(created.request.requestId, {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pidChain: [pidChainEntry] })
    });
    const response = await runHandler(POST as AnyHandler, event);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { request: { status: string } };
    expect(body.request.status).toBe('approved');
  });

  it('non-approver gets 403 with structured permission_denied payload', async () => {
    const room = createChatRoom({ name: 'non-approver', whoCreatedIt: '@jwpk' });
    const created = createPermissionRequest({
      requesterHandle: '@speedyc',
      action: 'chat.post',
      targetKind: 'room',
      targetId: room.id,
      approvers: [{ handle: '@jwpk', role: 'room_owner', preferred: true }]
    });
    // @rando is authenticated but NOT a room owner.
    const otherRoom = createChatRoom({ name: 'other', whoCreatedIt: '@other' });
    const { pidChainEntry } = seedTerminal('@rando', 80002, otherRoom.id);

    const event = eventFor(created.request.requestId, {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pidChain: [pidChainEntry] })
    });
    const response = await runHandler(POST as AnyHandler, event);
    expect(response.status).toBe(403);
    const body = (await response.json()) as {
      permission_denied?: { reason?: string; approvers?: Array<{ handle: string }> };
    };
    expect(body.permission_denied?.reason).toBe('not_room_owner');
    expect(body.permission_denied?.approvers?.[0].handle).toBe('@jwpk');
  });

  it('returns 401 on unauthenticated probe', async () => {
    delete process.env.ANT_ADMIN_TOKEN;
    const event = eventFor('req_anything', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({})
    });
    const response = await runHandler(POST as AnyHandler, event);
    expect(response.status).toBe(401);
  });

  it('returns 404 when request does not exist', async () => {
    const event = eventFor('req_does_not_exist', {
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TEST_ADMIN}`
      },
      body: JSON.stringify({})
    });
    const response = await runHandler(POST as AnyHandler, event);
    expect(response.status).toBe(404);
  });

  it('returns 409 when request is already decided', async () => {
    const room = createChatRoom({ name: 'already-decided', whoCreatedIt: '@jwpk' });
    const created = createPermissionRequest({
      requesterHandle: '@speedyc',
      action: 'chat.post',
      targetKind: 'room',
      targetId: room.id,
      approvers: [{ handle: '@jwpk', role: 'room_owner', preferred: true }]
    });
    // First approve succeeds.
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
    // Second approve 409s.
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

  it('returns 400 on invalid decisionScope', async () => {
    const room = createChatRoom({ name: 'bad-scope', whoCreatedIt: '@jwpk' });
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
      body: JSON.stringify({ decisionScope: 'forever' })
    });
    const response = await runHandler(POST as AnyHandler, event);
    expect(response.status).toBe(400);
  });

  it('rejects non-admin system-scoped approval with 403', async () => {
    // System-scoped requests are admin-bearer only — even an authenticated
    // room owner can't approve them.
    const otherRoom = createChatRoom({ name: 'other', whoCreatedIt: '@jwpk' });
    const created = createPermissionRequest({
      requesterHandle: '@speedyc',
      action: 'system.reclaim',
      targetKind: 'system',
      targetId: 'global',
      approvers: []
    });
    const { pidChainEntry } = seedTerminal('@jwpk', 80003, otherRoom.id);
    const event = eventFor(created.request.requestId, {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pidChain: [pidChainEntry] })
    });
    const response = await runHandler(POST as AnyHandler, event);
    expect(response.status).toBe(403);
  });

  it('happy path honours decisionScope=always-for-room on the grant', async () => {
    const room = createChatRoom({ name: 'scoped-grant', whoCreatedIt: '@jwpk' });
    const created = createPermissionRequest({
      requesterHandle: '@speedyc',
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
      body: JSON.stringify({ decisionScope: 'always-for-room' })
    });
    const response = await runHandler(POST as AnyHandler, event);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { grant: { scope: string } };
    expect(body.grant.scope).toBe('always-for-room');
  });
});
