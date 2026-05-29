/**
 * reclaimRequestsStore tests — v0.2 PR-C acceptance criteria.
 *
 * Covers the create -> approve -> execute -> expire lifecycle and the
 * atomic-swap invariant (memberships move, old runtime archives,
 * reclaim_request flips to executed in a single transaction).
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIdentityDbForTests, getIdentityDb } from './db';
import { upsertTerminal } from './terminalsStore';
import { addMembership, listMembershipsForRoom } from './roomMembershipsStore';
import {
  createReclaimRequest,
  getReclaimRequest,
  listPendingReclaimRequestsForAgent,
  approveReclaimRequest,
  executeReclaimRequest,
  expireStaleReclaimRequests
} from './reclaimRequestsStore';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-reclaim-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
});

function makeTerminal(name: string): string {
  return upsertTerminal({ pid: 100, pid_start: 'pst', name }).id;
}

describe('createReclaimRequest', () => {
  it('inserts a row with status=pending and the supplied expiry window', () => {
    const oldTerm = makeTerminal('old-runtime');
    const newTerm = makeTerminal('new-runtime');
    const now = 1_000_000_000_000;
    const result = createReclaimRequest({
      agentId: 'agent-tiger',
      oldRuntimeId: oldTerm,
      newRuntimeId: newTerm,
      challenge: 'challenge-opaque-token',
      requestedByAgentId: 'agent-tiger',
      nowMs: now
    });
    expect(result.requestId).toMatch(/^rcm_/);
    expect(result.expiresAtMs).toBe(now + 30 * 60 * 1000);
    const row = getReclaimRequest(result.requestId);
    expect(row).not.toBeNull();
    expect(row?.status).toBe('pending');
    expect(row?.old_runtime_id).toBe(oldTerm);
    expect(row?.new_runtime_id).toBe(newTerm);
    expect(row?.agent_id).toBe('agent-tiger');
    expect(row?.requested_at_ms).toBe(now);
  });

  it('honours a custom ttl when supplied', () => {
    const now = 1_000_000_000_000;
    const result = createReclaimRequest({
      agentId: 'agent-tiger',
      oldRuntimeId: null,
      newRuntimeId: makeTerminal('new-runtime'),
      challenge: 'opaque',
      requestedByAgentId: 'admin',
      nowMs: now,
      ttlMs: 60_000
    });
    expect(result.expiresAtMs).toBe(now + 60_000);
  });

  it('lists pending requests per agent', () => {
    const newTerm = makeTerminal('new-runtime');
    const r = createReclaimRequest({
      agentId: 'agent-tiger', oldRuntimeId: null, newRuntimeId: newTerm,
      challenge: 'c', requestedByAgentId: 'admin', nowMs: 1
    });
    const pending = listPendingReclaimRequestsForAgent('agent-tiger');
    expect(pending.map((p) => p.request_id)).toEqual([r.requestId]);
    expect(listPendingReclaimRequestsForAgent('agent-other')).toEqual([]);
  });
});

describe('approveReclaimRequest', () => {
  it('flips pending -> approved and records approver + timestamp', () => {
    const r = createReclaimRequest({
      agentId: 'agent-a', oldRuntimeId: null, newRuntimeId: makeTerminal('new'),
      challenge: 'c', requestedByAgentId: 'admin', nowMs: 1
    });
    const res = approveReclaimRequest({ requestId: r.requestId, approverAgentId: 'super-admin', nowMs: 2 });
    expect(res).toEqual({ ok: true, status: 'approved' });
    const row = getReclaimRequest(r.requestId);
    expect(row?.status).toBe('approved');
    expect(row?.approved_by_agent_id).toBe('super-admin');
    expect(row?.approved_at_ms).toBe(2);
  });

  it('returns not-found for an unknown requestId', () => {
    const res = approveReclaimRequest({ requestId: 'rcm_missing', approverAgentId: 'admin', nowMs: 1 });
    expect(res).toEqual({ ok: false, reason: 'not-found' });
  });

  it('returns not-pending if the request was already approved', () => {
    const r = createReclaimRequest({
      agentId: 'a', oldRuntimeId: null, newRuntimeId: makeTerminal('new'),
      challenge: 'c', requestedByAgentId: 'admin', nowMs: 1
    });
    approveReclaimRequest({ requestId: r.requestId, approverAgentId: 'admin', nowMs: 2 });
    const second = approveReclaimRequest({ requestId: r.requestId, approverAgentId: 'admin', nowMs: 3 });
    expect(second).toEqual({ ok: false, reason: 'not-pending' });
  });

  it('returns expired and marks the row expired when ttl has lapsed', () => {
    const r = createReclaimRequest({
      agentId: 'a', oldRuntimeId: null, newRuntimeId: makeTerminal('new'),
      challenge: 'c', requestedByAgentId: 'admin', nowMs: 1, ttlMs: 100
    });
    const res = approveReclaimRequest({ requestId: r.requestId, approverAgentId: 'admin', nowMs: 9999 });
    expect(res).toEqual({ ok: false, reason: 'expired' });
    expect(getReclaimRequest(r.requestId)?.status).toBe('expired');
  });
});

describe('executeReclaimRequest (atomic swap)', () => {
  it('moves every active membership from old runtime to new, archives old, flips status=executed', () => {
    const oldTerm = makeTerminal('old-runtime');
    const newTerm = makeTerminal('new-runtime');
    addMembership({ room_id: 'room-1', handle: '@tiger', terminal_id: oldTerm });
    addMembership({ room_id: 'room-2', handle: '@tiger', terminal_id: oldTerm });

    const r = createReclaimRequest({
      agentId: 'agent-tiger', oldRuntimeId: oldTerm, newRuntimeId: newTerm,
      challenge: 'opaque', requestedByAgentId: 'admin', nowMs: 1000
    });
    approveReclaimRequest({ requestId: r.requestId, approverAgentId: 'admin', nowMs: 1100 });

    const exec = executeReclaimRequest({ requestId: r.requestId, nowMs: 1200 });
    expect(exec).toMatchObject({ ok: true, oldArchived: true });
    if (exec.ok) expect(exec.affectedRoomIds.sort()).toEqual(['room-1', 'room-2']);

    // Memberships now point at new runtime.
    const room1 = listMembershipsForRoom('room-1');
    expect(room1).toHaveLength(1);
    expect(room1[0]?.terminal_id).toBe(newTerm);
    const room2 = listMembershipsForRoom('room-2');
    expect(room2[0]?.terminal_id).toBe(newTerm);

    // Old runtime row is archived.
    const db = getIdentityDb();
    const oldRow = db.prepare(`SELECT status FROM terminals WHERE id = ?`).get(oldTerm) as { status: string };
    expect(oldRow.status).toBe('archived');

    // Reclaim request flipped to executed.
    const finalRow = getReclaimRequest(r.requestId);
    expect(finalRow?.status).toBe('executed');
    expect(finalRow?.executed_at_ms).toBe(1200);
  });

  it('is a no-op archive when old_runtime_id is null (clean-slate reclaim)', () => {
    const newTerm = makeTerminal('new-runtime');
    const r = createReclaimRequest({
      agentId: 'agent-a', oldRuntimeId: null, newRuntimeId: newTerm,
      challenge: 'c', requestedByAgentId: 'admin', nowMs: 1
    });
    approveReclaimRequest({ requestId: r.requestId, approverAgentId: 'admin', nowMs: 2 });
    const exec = executeReclaimRequest({ requestId: r.requestId, nowMs: 3 });
    expect(exec).toEqual({ ok: true, affectedRoomIds: [], oldArchived: false });
    expect(getReclaimRequest(r.requestId)?.status).toBe('executed');
  });

  it('returns not-approved when called on a pending request', () => {
    const r = createReclaimRequest({
      agentId: 'a', oldRuntimeId: null, newRuntimeId: makeTerminal('new'),
      challenge: 'c', requestedByAgentId: 'admin', nowMs: 1
    });
    const res = executeReclaimRequest({ requestId: r.requestId, nowMs: 2 });
    expect(res).toEqual({ ok: false, reason: 'not-approved' });
  });

  it('returns not-found for an unknown requestId', () => {
    const res = executeReclaimRequest({ requestId: 'rcm_missing', nowMs: 1 });
    expect(res).toEqual({ ok: false, reason: 'not-found' });
  });

  it('returns expired when ttl has lapsed between approve and execute', () => {
    const newTerm = makeTerminal('new-runtime');
    const r = createReclaimRequest({
      agentId: 'a', oldRuntimeId: null, newRuntimeId: newTerm,
      challenge: 'c', requestedByAgentId: 'admin', nowMs: 1, ttlMs: 100
    });
    approveReclaimRequest({ requestId: r.requestId, approverAgentId: 'admin', nowMs: 50 });
    const res = executeReclaimRequest({ requestId: r.requestId, nowMs: 99999 });
    expect(res).toEqual({ ok: false, reason: 'expired' });
    expect(getReclaimRequest(r.requestId)?.status).toBe('expired');
  });

  it('refuses re-execute on an already-executed request', () => {
    const newTerm = makeTerminal('new-runtime');
    const r = createReclaimRequest({
      agentId: 'a', oldRuntimeId: null, newRuntimeId: newTerm,
      challenge: 'c', requestedByAgentId: 'admin', nowMs: 1
    });
    approveReclaimRequest({ requestId: r.requestId, approverAgentId: 'admin', nowMs: 2 });
    executeReclaimRequest({ requestId: r.requestId, nowMs: 3 });
    const second = executeReclaimRequest({ requestId: r.requestId, nowMs: 4 });
    expect(second).toEqual({ ok: false, reason: 'not-approved' });
  });

  it('idempotent-archive: re-archive on an already-archived old runtime reports oldArchived=false', () => {
    const oldTerm = makeTerminal('old-runtime');
    const newTerm = makeTerminal('new-runtime');
    // Manually flip the old runtime to archived before the swap.
    getIdentityDb().prepare(`UPDATE terminals SET status = 'archived' WHERE id = ?`).run(oldTerm);

    addMembership({ room_id: 'room-x', handle: '@x', terminal_id: oldTerm });

    const r = createReclaimRequest({
      agentId: 'a', oldRuntimeId: oldTerm, newRuntimeId: newTerm,
      challenge: 'c', requestedByAgentId: 'admin', nowMs: 1
    });
    approveReclaimRequest({ requestId: r.requestId, approverAgentId: 'admin', nowMs: 2 });
    const exec = executeReclaimRequest({ requestId: r.requestId, nowMs: 3 });
    expect(exec).toMatchObject({ ok: true, oldArchived: false });
    if (exec.ok) expect(exec.affectedRoomIds).toEqual(['room-x']);
  });
});

describe('expireStaleReclaimRequests', () => {
  it('flips pending rows past expiry to status=expired and returns the count', () => {
    const newTerm = makeTerminal('new-runtime');
    const r1 = createReclaimRequest({
      agentId: 'a', oldRuntimeId: null, newRuntimeId: newTerm,
      challenge: 'c', requestedByAgentId: 'admin', nowMs: 1, ttlMs: 10
    });
    const r2 = createReclaimRequest({
      agentId: 'b', oldRuntimeId: null, newRuntimeId: newTerm,
      challenge: 'c', requestedByAgentId: 'admin', nowMs: 1, ttlMs: 10_000_000
    });
    const count = expireStaleReclaimRequests(9999);
    expect(count).toBe(1);
    expect(getReclaimRequest(r1.requestId)?.status).toBe('expired');
    expect(getReclaimRequest(r2.requestId)?.status).toBe('pending');
  });

  it('skips already-approved + already-executed rows', () => {
    const newTerm = makeTerminal('new-runtime');
    const r = createReclaimRequest({
      agentId: 'a', oldRuntimeId: null, newRuntimeId: newTerm,
      challenge: 'c', requestedByAgentId: 'admin', nowMs: 1, ttlMs: 10
    });
    approveReclaimRequest({ requestId: r.requestId, approverAgentId: 'admin', nowMs: 2 });
    const count = expireStaleReclaimRequests(9999);
    expect(count).toBe(0);
    expect(getReclaimRequest(r.requestId)?.status).toBe('approved');
  });
});
