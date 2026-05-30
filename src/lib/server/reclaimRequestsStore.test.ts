/**
 * reclaimRequestsStore tests — PR-C super-admin reclaim primitive.
 *
 * Covers create, approve, deny, expire, get, list-pending, plus execute
 * across all four target_kinds (terminal / membership / identity NO-OP /
 * session NO-OP) under both dryRun=true and dryRun=false.
 *
 * Runs against the per-worker isolated DB seeded by db.ts when VITEST is
 * set (no in-memory override needed — db.ts already scopes the DB file
 * per worker).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  approveReclaim,
  createReclaimRequest,
  denyReclaim,
  executeReclaim,
  expireReclaim,
  getReclaimRequest,
  listPendingReclaims,
  resetReclaimRequestsStoreForTests
} from './reclaimRequestsStore';
import { getIdentityDb } from './db';
import { upsertTerminal } from './terminalsStore';
import { addMembership } from './roomMembershipsStore';

beforeEach(() => {
  resetReclaimRequestsStoreForTests();
});

afterEach(() => {
  resetReclaimRequestsStoreForTests();
});

function uniqueTerminal(prefix: string): { id: string; name: string; pid: number } {
  const suffix = randomUUID().slice(0, 8);
  const name = `${prefix}-${suffix}`;
  const pid = Math.floor(Math.random() * 90000) + 10000;
  const row = upsertTerminal({
    name,
    pid,
    pid_start: '1000000',
    source: 'manual'
  });
  return { id: row.id, name, pid };
}

function uniqueRoom(): string {
  // room_memberships has no FK to chat_rooms so any unique id works.
  return `room_${randomUUID().slice(0, 12)}`;
}

describe('reclaimRequestsStore — create + read', () => {
  it('createReclaimRequest persists a row in pending state with signed_payload', () => {
    const req = createReclaimRequest({
      requesterHandle: '@jamesK',
      targetKind: 'terminal',
      targetId: 't_dead',
      reason: 'stale membership blocking reuse'
    });
    expect(req.reclaimId).toMatch(/^rcl_/);
    expect(req.status).toBe('pending');
    expect(req.targetKind).toBe('terminal');
    expect(req.targetId).toBe('t_dead');
    expect(req.requesterHandle).toBe('@jamesK');
    expect(req.signedPayload.length).toBeGreaterThan(0);
    expect(req.signature).toBeNull();
    const parsed = JSON.parse(req.signedPayload);
    expect(parsed.reclaim_id).toBe(req.reclaimId);
    expect(parsed.target_kind).toBe('terminal');
  });

  it('createReclaimRequest stores diagnostic as JSON when supplied', () => {
    const req = createReclaimRequest({
      requesterHandle: '@jamesK',
      targetKind: 'membership',
      targetId: 'm_xyz',
      reason: 'dual-bind',
      diagnostic: { observedRows: 2, expected: 1 }
    });
    expect(req.diagnostic).toEqual({ observedRows: 2, expected: 1 });
  });

  it('createReclaimRequest rejects empty reason', () => {
    expect(() =>
      createReclaimRequest({
        requesterHandle: '@jamesK',
        targetKind: 'terminal',
        targetId: 't_x',
        reason: '   '
      })
    ).toThrow(/reason is required/);
  });

  it('createReclaimRequest trims the reason field', () => {
    const req = createReclaimRequest({
      requesterHandle: '@jamesK',
      targetKind: 'membership',
      targetId: 'm_x',
      reason: '   needs revoke   '
    });
    expect(req.reason).toBe('needs revoke');
  });

  it('getReclaimRequest returns null for an unknown id', () => {
    expect(getReclaimRequest('rcl_does_not_exist')).toBeNull();
  });

  it('getReclaimRequest returns the row for a known id', () => {
    const req = createReclaimRequest({
      requesterHandle: '@jamesK',
      targetKind: 'session',
      targetId: 's_x',
      reason: 'why'
    });
    const fetched = getReclaimRequest(req.reclaimId);
    expect(fetched?.reclaimId).toBe(req.reclaimId);
  });

  it('listPendingReclaims returns only pending rows ordered by created_at_ms', () => {
    const a = createReclaimRequest({
      requesterHandle: '@jamesK',
      targetKind: 'terminal',
      targetId: 't_a',
      reason: 'a'
    });
    const b = createReclaimRequest({
      requesterHandle: '@jamesK',
      targetKind: 'terminal',
      targetId: 't_b',
      reason: 'b'
    });
    denyReclaim({ reclaimId: a.reclaimId, reason: 'not needed' });
    const pending = listPendingReclaims();
    expect(pending.map((r) => r.reclaimId)).toEqual([b.reclaimId]);
  });
});

describe('reclaimRequestsStore — approve / deny / expire', () => {
  it('approveReclaim flips status -> approved and stamps approver', () => {
    const req = createReclaimRequest({
      requesterHandle: '@jamesK',
      targetKind: 'terminal',
      targetId: 't_x',
      reason: 'x'
    });
    const approved = approveReclaim({
      reclaimId: req.reclaimId,
      approvedByHandle: '@admin'
    });
    expect(approved.status).toBe('approved');
    expect(approved.approvedByHandle).toBe('@admin');
    expect(approved.approvedAtMs).not.toBeNull();
  });

  it('approveReclaim rejects a non-pending request', () => {
    const req = createReclaimRequest({
      requesterHandle: '@jamesK',
      targetKind: 'terminal',
      targetId: 't_x',
      reason: 'x'
    });
    denyReclaim({ reclaimId: req.reclaimId, reason: 'no' });
    expect(() =>
      approveReclaim({ reclaimId: req.reclaimId, approvedByHandle: '@admin' })
    ).toThrow(/cannot be approved/);
  });

  it('denyReclaim flips status -> denied and records reason in resulting_actions_json', () => {
    const req = createReclaimRequest({
      requesterHandle: '@jamesK',
      targetKind: 'terminal',
      targetId: 't_x',
      reason: 'x'
    });
    const denied = denyReclaim({
      reclaimId: req.reclaimId,
      reason: 'not safe right now'
    });
    expect(denied.status).toBe('denied');
    expect(denied.resultingActions?.[0]?.detail).toContain('not safe right now');
  });

  it('denyReclaim rejects empty reason', () => {
    const req = createReclaimRequest({
      requesterHandle: '@jamesK',
      targetKind: 'terminal',
      targetId: 't_x',
      reason: 'x'
    });
    expect(() =>
      denyReclaim({ reclaimId: req.reclaimId, reason: '  ' })
    ).toThrow(/deny reason is required/);
  });

  it('denyReclaim refuses already-executed requests', () => {
    const term = uniqueTerminal('reclaim-deny-after-exec');
    const req = createReclaimRequest({
      requesterHandle: '@jamesK',
      targetKind: 'terminal',
      targetId: term.id,
      reason: 'recover'
    });
    executeReclaim({
      reclaimId: req.reclaimId,
      executedByHandle: '@admin'
    });
    expect(() =>
      denyReclaim({ reclaimId: req.reclaimId, reason: 'too late' })
    ).toThrow(/cannot be denied/);
  });

  it('expireReclaim flips status -> expired', () => {
    const req = createReclaimRequest({
      requesterHandle: '@jamesK',
      targetKind: 'terminal',
      targetId: 't_x',
      reason: 'x'
    });
    const expired = expireReclaim({ reclaimId: req.reclaimId });
    expect(expired.status).toBe('expired');
  });

  it('expireReclaim refuses already-decided requests', () => {
    const term = uniqueTerminal('reclaim-expire-after-exec');
    const req = createReclaimRequest({
      requesterHandle: '@jamesK',
      targetKind: 'terminal',
      targetId: term.id,
      reason: 'recover'
    });
    executeReclaim({
      reclaimId: req.reclaimId,
      executedByHandle: '@admin'
    });
    expect(() => expireReclaim({ reclaimId: req.reclaimId })).toThrow(
      /cannot be expired/
    );
  });
});

describe('executeReclaim — terminal target_kind', () => {
  it('dryRun reports actions without mutating rows', () => {
    const term = uniqueTerminal('reclaim-terminal-dry');
    const roomId = uniqueRoom();
    addMembership({ room_id: roomId, handle: '@reclaimerA', terminal_id: term.id });
    const req = createReclaimRequest({
      requesterHandle: '@jamesK',
      targetKind: 'terminal',
      targetId: term.id,
      reason: 'dry test'
    });
    const { request, actions } = executeReclaim({
      reclaimId: req.reclaimId,
      executedByHandle: '@admin',
      dryRun: true
    });
    expect(request.status).toBe('pending');
    expect(actions.find((a) => a.kind === 'terminal_archived')?.dryRun).toBe(true);
    expect(actions.find((a) => a.kind === 'membership_revoked')?.rowsAffected).toBe(1);
    // Verify nothing actually changed:
    const liveStatus = getIdentityDb()
      .prepare(`SELECT status FROM terminals WHERE id = ?`)
      .get(term.id) as { status: string };
    expect(liveStatus.status).toBe('live');
    const memberRevoked = getIdentityDb()
      .prepare(
        `SELECT revoked_at_ms FROM room_memberships WHERE room_id = ? AND handle = ?`
      )
      .get(roomId, '@reclaimerA') as { revoked_at_ms: number | null };
    expect(memberRevoked.revoked_at_ms).toBeNull();
  });

  it('live execute flips terminals.status -> archived and revokes memberships', () => {
    const term = uniqueTerminal('reclaim-terminal-live');
    const roomA = uniqueRoom();
    const roomB = uniqueRoom();
    addMembership({ room_id: roomA, handle: '@reclaimerB', terminal_id: term.id });
    addMembership({ room_id: roomB, handle: '@reclaimerC', terminal_id: term.id });
    const req = createReclaimRequest({
      requesterHandle: '@jamesK',
      targetKind: 'terminal',
      targetId: term.id,
      reason: 'real recover'
    });
    const { request, actions } = executeReclaim({
      reclaimId: req.reclaimId,
      executedByHandle: '@admin'
    });
    expect(request.status).toBe('executed');
    expect(request.executedByHandle).toBe('@admin');
    expect(request.resultingActions).not.toBeNull();
    const archived = actions.find((a) => a.kind === 'terminal_archived');
    expect(archived?.rowsAffected).toBe(1);
    const revoked = actions.find((a) => a.kind === 'membership_revoked');
    expect(revoked?.rowsAffected).toBe(2);
    const liveStatus = getIdentityDb()
      .prepare(`SELECT status FROM terminals WHERE id = ?`)
      .get(term.id) as { status: string };
    expect(liveStatus.status).toBe('archived');
  });

  it('execute on unknown terminal id returns an unknown_target_warning action', () => {
    const req = createReclaimRequest({
      requesterHandle: '@jamesK',
      targetKind: 'terminal',
      targetId: 't_does_not_exist',
      reason: 'ghost'
    });
    const { actions } = executeReclaim({
      reclaimId: req.reclaimId,
      executedByHandle: '@admin'
    });
    expect(actions[0].kind).toBe('unknown_target_warning');
  });

  it('refuses double-execution', () => {
    const term = uniqueTerminal('reclaim-terminal-double');
    const req = createReclaimRequest({
      requesterHandle: '@jamesK',
      targetKind: 'terminal',
      targetId: term.id,
      reason: 'first'
    });
    executeReclaim({
      reclaimId: req.reclaimId,
      executedByHandle: '@admin'
    });
    expect(() =>
      executeReclaim({
        reclaimId: req.reclaimId,
        executedByHandle: '@admin'
      })
    ).toThrow(/already executed/);
  });
});

describe('executeReclaim — membership target_kind', () => {
  it('dryRun reports the would-revoke without flipping revoked_at_ms', () => {
    const term = uniqueTerminal('reclaim-mem-dry');
    const roomId = uniqueRoom();
    addMembership({ room_id: roomId, handle: '@memDry', terminal_id: term.id });
    const membership = getIdentityDb()
      .prepare(
        `SELECT id FROM room_memberships WHERE room_id = ? AND handle = ?`
      )
      .get(roomId, '@memDry') as { id: string };
    const req = createReclaimRequest({
      requesterHandle: '@jamesK',
      targetKind: 'membership',
      targetId: membership.id,
      reason: 'dry'
    });
    const { request, actions } = executeReclaim({
      reclaimId: req.reclaimId,
      executedByHandle: '@admin',
      dryRun: true
    });
    expect(request.status).toBe('pending');
    expect(actions[0].kind).toBe('membership_revoked');
    expect(actions[0].dryRun).toBe(true);
    const live = getIdentityDb()
      .prepare(`SELECT revoked_at_ms FROM room_memberships WHERE id = ?`)
      .get(membership.id) as { revoked_at_ms: number | null };
    expect(live.revoked_at_ms).toBeNull();
  });

  it('live execute flips revoked_at_ms on the row', () => {
    const term = uniqueTerminal('reclaim-mem-live');
    const roomId = uniqueRoom();
    addMembership({ room_id: roomId, handle: '@memLive', terminal_id: term.id });
    const membership = getIdentityDb()
      .prepare(
        `SELECT id FROM room_memberships WHERE room_id = ? AND handle = ?`
      )
      .get(roomId, '@memLive') as { id: string };
    const req = createReclaimRequest({
      requesterHandle: '@jamesK',
      targetKind: 'membership',
      targetId: membership.id,
      reason: 'real'
    });
    const { request, actions } = executeReclaim({
      reclaimId: req.reclaimId,
      executedByHandle: '@admin'
    });
    expect(request.status).toBe('executed');
    expect(actions[0].rowsAffected).toBe(1);
    const updated = getIdentityDb()
      .prepare(`SELECT revoked_at_ms FROM room_memberships WHERE id = ?`)
      .get(membership.id) as { revoked_at_ms: number | null };
    expect(updated.revoked_at_ms).not.toBeNull();
  });

  it('returns already-revoked action when the membership is already revoked', () => {
    const term = uniqueTerminal('reclaim-mem-already');
    const roomId = uniqueRoom();
    addMembership({ room_id: roomId, handle: '@memAlready', terminal_id: term.id });
    const membership = getIdentityDb()
      .prepare(`SELECT id FROM room_memberships WHERE room_id = ? AND handle = ?`)
      .get(roomId, '@memAlready') as { id: string };
    getIdentityDb()
      .prepare(`UPDATE room_memberships SET revoked_at_ms = ? WHERE id = ?`)
      .run(Date.now(), membership.id);
    const req = createReclaimRequest({
      requesterHandle: '@jamesK',
      targetKind: 'membership',
      targetId: membership.id,
      reason: 'after'
    });
    const { actions } = executeReclaim({
      reclaimId: req.reclaimId,
      executedByHandle: '@admin'
    });
    expect(actions[0].detail).toContain('already revoked');
  });

  it('unknown membership id surfaces an unknown_target_warning action', () => {
    const req = createReclaimRequest({
      requesterHandle: '@jamesK',
      targetKind: 'membership',
      targetId: 'm_does_not_exist',
      reason: 'ghost'
    });
    const { actions } = executeReclaim({
      reclaimId: req.reclaimId,
      executedByHandle: '@admin'
    });
    expect(actions[0].kind).toBe('unknown_target_warning');
  });
});

describe('executeReclaim — identity / session NO-OP target_kinds', () => {
  it('identity is a NO-OP returning the pending-v0.2 warning under dryRun', () => {
    const req = createReclaimRequest({
      requesterHandle: '@jamesK',
      targetKind: 'identity',
      targetId: 'id_x',
      reason: 'soon'
    });
    const { request, actions } = executeReclaim({
      reclaimId: req.reclaimId,
      executedByHandle: '@admin',
      dryRun: true
    });
    expect(request.status).toBe('pending');
    expect(actions[0].kind).toBe('noop_identity_pending_v02');
    expect(actions[0].dryRun).toBe(true);
  });

  it('identity NO-OP still flips request status to executed when not dryRun', () => {
    const req = createReclaimRequest({
      requesterHandle: '@jamesK',
      targetKind: 'identity',
      targetId: 'id_y',
      reason: 'soon'
    });
    const { request, actions } = executeReclaim({
      reclaimId: req.reclaimId,
      executedByHandle: '@admin'
    });
    expect(request.status).toBe('executed');
    expect(actions[0].kind).toBe('noop_identity_pending_v02');
  });

  it('session NO-OP returns the pending-v0.2 warning', () => {
    const req = createReclaimRequest({
      requesterHandle: '@jamesK',
      targetKind: 'session',
      targetId: 's_y',
      reason: 'soon'
    });
    const { actions } = executeReclaim({
      reclaimId: req.reclaimId,
      executedByHandle: '@admin'
    });
    expect(actions[0].kind).toBe('noop_session_pending_v02');
  });
});
