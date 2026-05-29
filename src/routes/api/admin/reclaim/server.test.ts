/**
 * POST /api/admin/reclaim endpoint tests — v0.2 PR-C acceptance.
 *
 * Covers admin-bearer auth, action=request, action=approve, auto-approve
 * end-to-end (request -> approve -> execute -> archive), and the lapsed-TTL
 * error path.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIdentityDbForTests, getIdentityDb } from '$lib/server/db';
import { upsertTerminal } from '$lib/server/terminalsStore';
import { addMembership } from '$lib/server/roomMembershipsStore';
import { createReclaimRequest, getReclaimRequest } from '$lib/server/reclaimRequestsStore';
import { POST } from './+server';

type RouteEvent = Parameters<typeof POST>[0];

const ADMIN_TOKEN = 'reclaim-admin-token';
const PREV_ADMIN = process.env.ANT_ADMIN_TOKEN;
const PREV_DB = process.env.ANT_FRESH_DB_PATH;

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-reclaim-route-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN;
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (PREV_DB === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB;
  if (PREV_ADMIN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = PREV_ADMIN;
});

function authHeaders(token = ADMIN_TOKEN): Record<string, string> {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

function postEvent(bodyValue: unknown, headers = authHeaders(), action?: string): RouteEvent {
  const body = typeof bodyValue === 'string' ? bodyValue : JSON.stringify(bodyValue);
  const queryString = action ? `?action=${encodeURIComponent(action)}` : '';
  const fullUrl = `http://test.local/api/admin/reclaim${queryString}`;
  return {
    request: new Request(fullUrl, { method: 'POST', body, headers }),
    url: new URL(fullUrl)
  } as RouteEvent;
}

async function expectStatus(promise: unknown, expected: number): Promise<void> {
  let captured: unknown = null;
  try { await promise; } catch (failure) { captured = failure; }
  expect(captured).toBeTruthy();
  expect((captured as { status?: number }).status).toBe(expected);
}

function makeTerminal(name: string): string {
  return upsertTerminal({ pid: 100, pid_start: 'p', name }).id;
}

describe('POST /api/admin/reclaim', () => {
  it('returns 401 when admin bearer is missing or wrong', async () => {
    await expectStatus(POST(postEvent({ agentId: 'a', newRuntimeId: 'n', challenge: 'c', requestedByAgentId: 'r' }, { 'content-type': 'application/json' }, 'request')), 401);
    await expectStatus(POST(postEvent({ agentId: 'a', newRuntimeId: 'n', challenge: 'c', requestedByAgentId: 'r' }, { authorization: 'Bearer wrong', 'content-type': 'application/json' }, 'request')), 401);
  });

  it('returns 400 when action is missing', async () => {
    await expectStatus(POST(postEvent({ agentId: 'a' })), 400);
  });

  it('returns 400 on a non-JSON body', async () => {
    await expectStatus(POST(postEvent('not-json', authHeaders(), 'request')), 400);
  });

  it('action=request creates a pending reclaim_request and returns the requestId', async () => {
    const newTerm = makeTerminal('new-runtime');
    const response = await POST(postEvent({
      agentId: 'agent-a',
      newRuntimeId: newTerm,
      challenge: 'opaque-token',
      requestedByAgentId: 'admin'
    }, authHeaders(), 'request'));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.requestId).toMatch(/^rcm_/);
    expect(payload.status).toBe('pending');
    expect(typeof payload.expiresAtMs).toBe('number');
    expect(getReclaimRequest(payload.requestId)?.status).toBe('pending');
  });

  it('action=request with autoApprove=true atomically requests + executes', async () => {
    const oldTerm = makeTerminal('old-runtime');
    const newTerm = makeTerminal('new-runtime');
    addMembership({ room_id: 'room-1', handle: '@tiger', terminal_id: oldTerm });
    addMembership({ room_id: 'room-2', handle: '@tiger', terminal_id: oldTerm });

    const response = await POST(postEvent({
      agentId: 'agent-tiger',
      oldRuntimeId: oldTerm,
      newRuntimeId: newTerm,
      challenge: 'opaque',
      requestedByAgentId: 'admin',
      autoApprove: true
    }, authHeaders(), 'request'));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.status).toBe('executed');
    expect(payload.affectedRoomIds.sort()).toEqual(['room-1', 'room-2']);
    expect(payload.oldArchived).toBe(true);

    // Old runtime archived.
    const db = getIdentityDb();
    const oldRow = db.prepare(`SELECT status FROM terminals WHERE id = ?`).get(oldTerm) as { status: string };
    expect(oldRow.status).toBe('archived');
  });

  it('action=approve returns 404 on unknown requestId', async () => {
    await expectStatus(POST(postEvent({
      requestId: 'rcm_missing',
      approverAgentId: 'admin'
    }, authHeaders(), 'approve')), 404);
  });

  it('action=approve returns 409 when the request is already expired', async () => {
    const newTerm = makeTerminal('new-runtime');
    const created = createReclaimRequest({
      agentId: 'a', oldRuntimeId: null, newRuntimeId: newTerm,
      challenge: 'c', requestedByAgentId: 'admin',
      nowMs: 1, ttlMs: 10
    });
    // Force the row to be visibly past expiry without flipping it ourselves —
    // approve will detect lapsed TTL and return reason='expired'.
    getIdentityDb().prepare(`UPDATE reclaim_requests SET expires_at_ms = 1 WHERE request_id = ?`).run(created.requestId);
    await expectStatus(POST(postEvent({
      requestId: created.requestId,
      approverAgentId: 'admin'
    }, authHeaders(), 'approve')), 409);
  });

  it('action=approve flips pending -> executed and archives the old runtime', async () => {
    const oldTerm = makeTerminal('old-runtime');
    const newTerm = makeTerminal('new-runtime');
    addMembership({ room_id: 'room-1', handle: '@tiger', terminal_id: oldTerm });

    const created = createReclaimRequest({
      agentId: 'agent-tiger', oldRuntimeId: oldTerm, newRuntimeId: newTerm,
      challenge: 'opaque', requestedByAgentId: 'requester',
      nowMs: Date.now()
    });

    const response = await POST(postEvent({
      requestId: created.requestId,
      approverAgentId: 'super-admin'
    }, authHeaders(), 'approve'));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.status).toBe('executed');
    expect(payload.affectedRoomIds).toEqual(['room-1']);
    expect(payload.oldArchived).toBe(true);
    expect(getReclaimRequest(created.requestId)?.status).toBe('executed');
  });

  it('action via body (not query) is honoured', async () => {
    const newTerm = makeTerminal('new-runtime');
    const response = await POST(postEvent({
      action: 'request',
      agentId: 'a',
      newRuntimeId: newTerm,
      challenge: 'c',
      requestedByAgentId: 'admin'
    }));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.status).toBe('pending');
  });
});
