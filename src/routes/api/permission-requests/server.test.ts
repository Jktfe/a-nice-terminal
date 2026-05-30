/**
 * /api/permission-requests POST endpoint tests — Stage B substrate
 * (plan milestone p3-stage-b-permission-requests of
 * ant-substrate-v0.2-2026-05-29).
 *
 * Covers: identity resolution, body validation (400), unauthenticated
 * (401), happy path (201) with + without pending_action, approver
 * snapshot persistence.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST } from './+server';
import { resetIdentityDbForTests } from '$lib/server/db';
import {
  listAllPermissionRequestsForTests,
  resetPermissionRequestsForTests
} from '$lib/server/permissionRequestsStore';
import { resetGrantsShimForTests } from '$lib/server/grantsShimStore';
import { createChatRoom } from '$lib/server/chatRoomStore';
import { upsertTerminal } from '$lib/server/terminalsStore';
import { addMembership } from '$lib/server/roomMembershipsStore';

let tmpDir: string;
const previousDbEnv = process.env.ANT_FRESH_DB_PATH;
const previousAdminToken = process.env.ANT_ADMIN_TOKEN;
const TEST_ADMIN = 'admin-token-for-permission-requests-tests';

type AnyHandler = (event: unknown) => unknown;

function eventFor(init: RequestInit): unknown {
  const url = new URL('http://localhost/api/permission-requests');
  const request = new Request(url.toString(), { method: 'POST', ...init });
  return { request, params: {}, url };
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
  return {
    terminal,
    pidChainEntry: { pid, pid_start: `2026-05-29T20:00:0${pid % 10}.000Z` }
  };
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-permission-requests-'));
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

describe('POST /api/permission-requests', () => {
  it('admin-bearer creates a request with no pending_action', async () => {
    const room = createChatRoom({ name: 'r1', whoCreatedIt: '@jwpk' });
    const event = eventFor({
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TEST_ADMIN}`
      },
      body: JSON.stringify({
        action: 'chat.post',
        targetKind: 'room',
        targetId: room.id,
        reason: 'no_membership'
      })
    });
    const response = await runHandler(POST as AnyHandler, event);
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      request: { requestId: string; status: string; approverHandles: Array<{ handle: string }> };
      pendingAction: unknown;
    };
    expect(body.request.requestId).toMatch(/^req_/);
    expect(body.request.status).toBe('pending');
    expect(body.request.approverHandles[0].handle).toBe('@jwpk');
    expect(body.pendingAction).toBeNull();
  });

  it('authenticated pidChain caller creates a request bound to their handle', async () => {
    const room = createChatRoom({ name: 'r2', whoCreatedIt: '@jwpk' });
    // Different room so caller is not the approver — they're just a member.
    const otherRoom = createChatRoom({ name: 'other', whoCreatedIt: '@other' });
    const { pidChainEntry } = seedTerminal('@speedyc', 70001, otherRoom.id);
    const event = eventFor({
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'chat.post',
        targetKind: 'room',
        targetId: room.id,
        reason: 'no_membership',
        pidChain: [pidChainEntry]
      })
    });
    const response = await runHandler(POST as AnyHandler, event);
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      request: { requesterHandle: string };
    };
    expect(body.request.requesterHandle).toBe('@speedyc');
  });

  it('happy path with pendingAction parks the original action', async () => {
    const room = createChatRoom({ name: 'r3', whoCreatedIt: '@jwpk' });
    const event = eventFor({
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TEST_ADMIN}`
      },
      body: JSON.stringify({
        action: 'chat.post',
        targetKind: 'room',
        targetId: room.id,
        pendingAction: {
          http_method: 'POST',
          http_path: `/api/chat-rooms/${room.id}/messages`,
          payload: { body: 'hello' }
        }
      })
    });
    const response = await runHandler(POST as AnyHandler, event);
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      request: { pendingActionId: string | null };
      pendingAction: { actionId: string; httpMethod: string; replayStatus: string } | null;
    };
    expect(body.request.pendingActionId).not.toBeNull();
    expect(body.pendingAction?.httpMethod).toBe('POST');
    expect(body.pendingAction?.replayStatus).toBe('pending');
    // Round-trip via store proves the row landed.
    expect(listAllPermissionRequestsForTests()).toHaveLength(1);
  });

  it('rejects unauthenticated callers (401)', async () => {
    delete process.env.ANT_ADMIN_TOKEN;
    const event = eventFor({
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'r1'
      })
    });
    const response = await runHandler(POST as AnyHandler, event);
    expect(response.status).toBe(401);
  });

  it('rejects malformed body — missing action (400)', async () => {
    const event = eventFor({
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TEST_ADMIN}`
      },
      body: JSON.stringify({ targetKind: 'room', targetId: 'r1' })
    });
    const response = await runHandler(POST as AnyHandler, event);
    expect(response.status).toBe(400);
  });

  it('rejects invalid targetKind (400)', async () => {
    const event = eventFor({
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TEST_ADMIN}`
      },
      body: JSON.stringify({
        action: 'chat.post',
        targetKind: 'magic',
        targetId: 'r1'
      })
    });
    const response = await runHandler(POST as AnyHandler, event);
    expect(response.status).toBe(400);
  });

  it('rejects pendingAction with bad http_method (400)', async () => {
    const event = eventFor({
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TEST_ADMIN}`
      },
      body: JSON.stringify({
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'r1',
        pendingAction: {
          http_method: 'GET',
          http_path: '/api/x',
          payload: {}
        }
      })
    });
    const response = await runHandler(POST as AnyHandler, event);
    expect(response.status).toBe(400);
  });

  it('rejects pendingAction with relative http_path (400)', async () => {
    const event = eventFor({
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TEST_ADMIN}`
      },
      body: JSON.stringify({
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'r1',
        pendingAction: {
          http_method: 'POST',
          http_path: 'no-leading-slash',
          payload: {}
        }
      })
    });
    const response = await runHandler(POST as AnyHandler, event);
    expect(response.status).toBe(400);
  });

  it('rejects pendingAction with non-positive ttlMs (400)', async () => {
    const event = eventFor({
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TEST_ADMIN}`
      },
      body: JSON.stringify({
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'r1',
        pendingAction: {
          http_method: 'POST',
          http_path: '/api/x',
          payload: {},
          ttlMs: -1
        }
      })
    });
    const response = await runHandler(POST as AnyHandler, event);
    expect(response.status).toBe(400);
  });

  it('rejects non-JSON body (400)', async () => {
    const event = eventFor({
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TEST_ADMIN}`
      },
      body: '{not-json'
    });
    const response = await runHandler(POST as AnyHandler, event);
    expect(response.status).toBe(400);
  });

  it('snapshots room-owner approvers at request-creation time', async () => {
    const room = createChatRoom({ name: 'snap', whoCreatedIt: '@jwpk' });
    const event = eventFor({
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TEST_ADMIN}`
      },
      body: JSON.stringify({
        action: 'chat.post',
        targetKind: 'room',
        targetId: room.id
      })
    });
    const response = await runHandler(POST as AnyHandler, event);
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      request: { approverHandles: Array<{ handle: string; role: string; preferred: boolean }> };
    };
    expect(body.request.approverHandles).toHaveLength(1);
    expect(body.request.approverHandles[0].handle).toBe('@jwpk');
    expect(body.request.approverHandles[0].role).toBe('room_owner');
    expect(body.request.approverHandles[0].preferred).toBe(true);
  });

  it('empty approver list is accepted for unknown room (system-style targets)', async () => {
    const event = eventFor({
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TEST_ADMIN}`
      },
      body: JSON.stringify({
        action: 'system.reclaim',
        targetKind: 'system',
        targetId: 'global'
      })
    });
    const response = await runHandler(POST as AnyHandler, event);
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      request: { approverHandles: unknown[] };
    };
    expect(body.request.approverHandles).toEqual([]);
  });
});
