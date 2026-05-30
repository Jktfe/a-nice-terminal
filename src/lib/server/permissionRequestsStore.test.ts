/**
 * Tests for permissionRequestsStore — Stage B substrate (plan milestone
 * p3-stage-b-permission-requests of ant-substrate-v0.2-2026-05-29).
 *
 * Covers:
 *   - createPermissionRequest atomic write (with + without pending action)
 *   - approveRequest emits grant + flips replay_status ready_for_replay
 *   - approveRequest on expired pending_action keeps it expired
 *   - denyRequest flips replay_status='denied'
 *   - expireRequest is idempotent on already-decided rows
 *   - sweepExpiredPendingActions transitions both rows
 *   - getPermissionRequest / list helpers / markPendingActionReplayed
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  approveRequest,
  createPermissionRequest,
  DEFAULT_PENDING_ACTION_TTL_MS,
  denyRequest,
  expireRequest,
  getPendingActionForRequest,
  getPermissionRequest,
  listAllPendingActionsForTests,
  listAllPermissionRequestsForTests,
  listPendingForApprover,
  listPendingForRequester,
  markPendingActionReplayed,
  resetPermissionRequestsForTests,
  sweepExpiredPendingActions
} from './permissionRequestsStore';
import { lookupActiveGrant, resetGrantsShimForTests } from './grantsShimStore';
import { resetIdentityDbForTests } from './db';

const APPROVERS = [
  { handle: '@jwpk', role: 'room_owner', preferred: true }
];

describe('permissionRequestsStore', () => {
  beforeEach(() => {
    resetIdentityDbForTests();
    resetPermissionRequestsForTests();
    resetGrantsShimForTests();
  });

  describe('createPermissionRequest', () => {
    it('writes a request row with no pending_action when omitted', () => {
      const result = createPermissionRequest({
        requesterHandle: '@speedyc',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'orsz2321qb',
        reason: 'no_membership',
        approvers: APPROVERS,
        nowMs: 1_000_000
      });
      expect(result.request.requestId).toMatch(/^req_/);
      expect(result.request.status).toBe('pending');
      expect(result.request.requesterHandle).toBe('@speedyc');
      expect(result.request.reason).toBe('no_membership');
      expect(result.request.approverHandles).toEqual(APPROVERS);
      expect(result.request.pendingActionId).toBeNull();
      expect(result.pendingAction).toBeNull();
    });

    it('atomically writes both rows when pendingAction is supplied', () => {
      const result = createPermissionRequest({
        requesterHandle: 'speedyc',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'orsz2321qb',
        reason: 'no_membership',
        approvers: APPROVERS,
        pendingAction: {
          httpMethod: 'POST',
          httpPath: '/api/chat-rooms/orsz2321qb/messages',
          payloadJson: JSON.stringify({ body: 'hi' })
        },
        nowMs: 2_000_000
      });
      expect(result.request.pendingActionId).not.toBeNull();
      expect(result.pendingAction).not.toBeNull();
      expect(result.pendingAction?.requestId).toBe(result.request.requestId);
      expect(result.pendingAction?.replayStatus).toBe('pending');
      expect(result.pendingAction?.expiresAtMs).toBe(
        2_000_000 + DEFAULT_PENDING_ACTION_TTL_MS
      );
      // Handle normalisation applied.
      expect(result.request.requesterHandle).toBe('@speedyc');
    });

    it('honours an override TTL on the pending action', () => {
      const result = createPermissionRequest({
        requesterHandle: '@x',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'r1',
        approvers: APPROVERS,
        pendingAction: {
          httpMethod: 'POST',
          httpPath: '/api/x',
          payloadJson: '{}',
          ttlMs: 30_000
        },
        nowMs: 5_000_000
      });
      expect(result.pendingAction?.expiresAtMs).toBe(5_030_000);
    });

    it('persists approvers as JSON that survives round-trip', () => {
      const result = createPermissionRequest({
        requesterHandle: '@x',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'r1',
        approvers: [
          { handle: '@a', role: 'room_owner', preferred: true },
          { handle: '@b', role: 'org_admin', preferred: false }
        ]
      });
      const fetched = getPermissionRequest(result.request.requestId);
      expect(fetched?.approverHandles).toHaveLength(2);
      expect(fetched?.approverHandles[0].handle).toBe('@a');
      expect(fetched?.approverHandles[1].role).toBe('org_admin');
    });
  });

  describe('approveRequest', () => {
    it('writes a grant + flips request.status=approved + pending_action ready_for_replay', () => {
      const created = createPermissionRequest({
        requesterHandle: '@speedyc',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'orsz2321qb',
        approvers: APPROVERS,
        pendingAction: {
          httpMethod: 'POST',
          httpPath: '/api/chat-rooms/orsz2321qb/messages',
          payloadJson: '{"body":"hi"}'
        },
        nowMs: 10_000
      });
      const result = approveRequest({
        requestId: created.request.requestId,
        decidedByHandle: '@jwpk',
        decisionScope: 'always-for-room',
        nowMs: 15_000
      });
      expect(result.request.status).toBe('approved');
      expect(result.request.decidedByHandle).toBe('@jwpk');
      expect(result.request.decisionScope).toBe('always-for-room');
      expect(result.request.resultingGrantId).toBe(result.grant.grantId);
      expect(result.pendingAction?.replayStatus).toBe('ready_for_replay');
      // The grant is queryable via grantsShimStore — meaning the same auth
      // gate that backs `no_grant` decisions now sees the grant.
      const grant = lookupActiveGrant({
        granteeHandle: '@speedyc',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'orsz2321qb'
      });
      expect(grant).not.toBeNull();
      expect(grant?.scope).toBe('always-for-room');
    });

    it('default scope is once', () => {
      const created = createPermissionRequest({
        requesterHandle: '@speedyc',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'r1',
        approvers: APPROVERS
      });
      const result = approveRequest({
        requestId: created.request.requestId,
        decidedByHandle: '@jwpk'
      });
      expect(result.request.decisionScope).toBe('once');
      expect(result.grant.scope).toBe('once');
    });

    it('does NOT flip an already-expired pending_action to ready_for_replay', () => {
      const created = createPermissionRequest({
        requesterHandle: '@speedyc',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'r1',
        approvers: APPROVERS,
        pendingAction: {
          httpMethod: 'POST',
          httpPath: '/api/x',
          payloadJson: '{}',
          ttlMs: 1_000
        },
        nowMs: 100_000
      });
      // 101s later — pending_action is expired by wall clock.
      const result = approveRequest({
        requestId: created.request.requestId,
        decidedByHandle: '@jwpk',
        nowMs: 200_000
      });
      // Request still flips to approved; the grant lands.
      expect(result.request.status).toBe('approved');
      // But the pending_action stays at 'pending' (sweep will catch it).
      // It is NOT flipped to ready_for_replay because expires_at_ms < now.
      expect(result.pendingAction?.replayStatus).toBe('pending');
    });

    it('throws when the request is missing', () => {
      expect(() =>
        approveRequest({ requestId: 'req_does_not_exist', decidedByHandle: '@jwpk' })
      ).toThrowError(/not found/);
    });

    it('throws when the request is already approved (no double-grant)', () => {
      const created = createPermissionRequest({
        requesterHandle: '@s',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'r1',
        approvers: APPROVERS
      });
      approveRequest({
        requestId: created.request.requestId,
        decidedByHandle: '@jwpk'
      });
      expect(() =>
        approveRequest({
          requestId: created.request.requestId,
          decidedByHandle: '@jwpk'
        })
      ).toThrowError(/cannot be approved/);
    });
  });

  describe('denyRequest', () => {
    it('flips status=denied + pending_action replay_status=denied', () => {
      const created = createPermissionRequest({
        requesterHandle: '@speedyc',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'r1',
        approvers: APPROVERS,
        pendingAction: {
          httpMethod: 'POST',
          httpPath: '/api/x',
          payloadJson: '{}'
        }
      });
      const result = denyRequest({
        requestId: created.request.requestId,
        decidedByHandle: '@jwpk',
        reason: 'not appropriate'
      });
      expect(result.status).toBe('denied');
      expect(result.decidedByHandle).toBe('@jwpk');
      expect(result.reason).toContain('not appropriate');
      const pa = getPendingActionForRequest(created.request.requestId);
      expect(pa?.replayStatus).toBe('denied');
      // No grant created.
      const grant = lookupActiveGrant({
        granteeHandle: '@speedyc',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'r1'
      });
      expect(grant).toBeNull();
    });

    it('throws when the request is missing or already decided', () => {
      expect(() =>
        denyRequest({ requestId: 'req_nope', decidedByHandle: '@jwpk' })
      ).toThrowError(/not found/);
      const created = createPermissionRequest({
        requesterHandle: '@s',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'r1',
        approvers: APPROVERS
      });
      denyRequest({ requestId: created.request.requestId, decidedByHandle: '@jwpk' });
      expect(() =>
        denyRequest({ requestId: created.request.requestId, decidedByHandle: '@jwpk' })
      ).toThrowError(/cannot be denied/);
    });
  });

  describe('expireRequest', () => {
    it('flips pending → expired and propagates to pending_action', () => {
      const created = createPermissionRequest({
        requesterHandle: '@s',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'r1',
        approvers: APPROVERS,
        pendingAction: {
          httpMethod: 'POST',
          httpPath: '/api/x',
          payloadJson: '{}'
        }
      });
      const result = expireRequest({ requestId: created.request.requestId, nowMs: 999 });
      expect(result.status).toBe('expired');
      expect(result.decidedAtMs).toBe(999);
      const pa = getPendingActionForRequest(created.request.requestId);
      expect(pa?.replayStatus).toBe('expired');
    });

    it('is idempotent on already-decided rows', () => {
      const created = createPermissionRequest({
        requesterHandle: '@s',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'r1',
        approvers: APPROVERS
      });
      denyRequest({ requestId: created.request.requestId, decidedByHandle: '@jwpk' });
      const result = expireRequest({ requestId: created.request.requestId });
      // Still denied, expire was a no-op.
      expect(result.status).toBe('denied');
    });
  });

  describe('sweepExpiredPendingActions', () => {
    it('transitions expired pending_actions + their requests', () => {
      const a = createPermissionRequest({
        requesterHandle: '@s',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'r1',
        approvers: APPROVERS,
        pendingAction: {
          httpMethod: 'POST',
          httpPath: '/api/x',
          payloadJson: '{}',
          ttlMs: 1_000
        },
        nowMs: 100
      });
      const b = createPermissionRequest({
        requesterHandle: '@s',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'r2',
        approvers: APPROVERS,
        pendingAction: {
          httpMethod: 'POST',
          httpPath: '/api/y',
          payloadJson: '{}',
          ttlMs: 1_000_000_000
        },
        nowMs: 100
      });
      const result = sweepExpiredPendingActions(10_000);
      expect(result.expired).toBe(1);
      expect(result.requestsExpired).toBe(1);
      // a expired, b still pending.
      expect(getPermissionRequest(a.request.requestId)?.status).toBe('expired');
      expect(getPermissionRequest(b.request.requestId)?.status).toBe('pending');
      const paA = getPendingActionForRequest(a.request.requestId);
      expect(paA?.replayStatus).toBe('expired');
    });

    it('returns zero counts when nothing to sweep', () => {
      const result = sweepExpiredPendingActions(0);
      expect(result.expired).toBe(0);
      expect(result.requestsExpired).toBe(0);
    });

    it('does not re-flip already-expired rows on a second sweep', () => {
      createPermissionRequest({
        requesterHandle: '@s',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'r1',
        approvers: APPROVERS,
        pendingAction: {
          httpMethod: 'POST',
          httpPath: '/api/x',
          payloadJson: '{}',
          ttlMs: 1_000
        },
        nowMs: 100
      });
      const first = sweepExpiredPendingActions(10_000);
      const second = sweepExpiredPendingActions(20_000);
      expect(first.expired).toBe(1);
      expect(second.expired).toBe(0);
    });
  });

  describe('markPendingActionReplayed', () => {
    it('flips ready_for_replay → replayed_by_caller exactly once', () => {
      const created = createPermissionRequest({
        requesterHandle: '@s',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'r1',
        approvers: APPROVERS,
        pendingAction: {
          httpMethod: 'POST',
          httpPath: '/api/x',
          payloadJson: '{}'
        }
      });
      approveRequest({
        requestId: created.request.requestId,
        decidedByHandle: '@jwpk'
      });
      const actionId = created.request.pendingActionId!;
      const first = markPendingActionReplayed({ actionId, nowMs: 500 });
      expect(first).toBe(true);
      // Idempotent — second call is a no-op (replay_status is now
      // 'replayed_by_caller', not 'ready_for_replay').
      const second = markPendingActionReplayed({ actionId, nowMs: 600 });
      expect(second).toBe(false);
      const pa = getPendingActionForRequest(created.request.requestId);
      expect(pa?.replayStatus).toBe('replayed_by_caller');
      expect(pa?.replayedAtMs).toBe(500);
    });

    it('does NOT flip a pending row (must be approved first)', () => {
      const created = createPermissionRequest({
        requesterHandle: '@s',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'r1',
        approvers: APPROVERS,
        pendingAction: {
          httpMethod: 'POST',
          httpPath: '/api/x',
          payloadJson: '{}'
        }
      });
      const result = markPendingActionReplayed({
        actionId: created.request.pendingActionId!
      });
      expect(result).toBe(false);
    });
  });

  describe('list helpers', () => {
    it('listPendingForApprover returns requests where the handle is in the snapshot', () => {
      const a = createPermissionRequest({
        requesterHandle: '@s',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'r1',
        approvers: [{ handle: '@jwpk', role: 'room_owner', preferred: true }]
      });
      createPermissionRequest({
        requesterHandle: '@s',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'r2',
        approvers: [{ handle: '@somebodyelse', role: 'room_owner', preferred: true }]
      });
      const jwpkList = listPendingForApprover('@jwpk');
      expect(jwpkList).toHaveLength(1);
      expect(jwpkList[0].requestId).toBe(a.request.requestId);
      // Normalisation: handle without leading @ resolves the same way.
      expect(listPendingForApprover('jwpk')).toHaveLength(1);
    });

    it('listPendingForApprover excludes decided requests', () => {
      const a = createPermissionRequest({
        requesterHandle: '@s',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'r1',
        approvers: [{ handle: '@jwpk', role: 'room_owner', preferred: true }]
      });
      denyRequest({ requestId: a.request.requestId, decidedByHandle: '@jwpk' });
      expect(listPendingForApprover('@jwpk')).toHaveLength(0);
    });

    it('listPendingForRequester returns my own pending requests', () => {
      createPermissionRequest({
        requesterHandle: '@speedyc',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'r1',
        approvers: APPROVERS
      });
      createPermissionRequest({
        requesterHandle: '@otheragent',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'r2',
        approvers: APPROVERS
      });
      const mine = listPendingForRequester('@speedyc');
      expect(mine).toHaveLength(1);
      expect(mine[0].requesterHandle).toBe('@speedyc');
    });
  });

  describe('test-only helpers', () => {
    it('listAllPermissionRequestsForTests + listAllPendingActionsForTests return every row', () => {
      createPermissionRequest({
        requesterHandle: '@s',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'r1',
        approvers: APPROVERS,
        pendingAction: {
          httpMethod: 'POST',
          httpPath: '/api/x',
          payloadJson: '{}'
        }
      });
      expect(listAllPermissionRequestsForTests()).toHaveLength(1);
      expect(listAllPendingActionsForTests()).toHaveLength(1);
    });

    it('resetPermissionRequestsForTests truncates both tables', () => {
      createPermissionRequest({
        requesterHandle: '@s',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'r1',
        approvers: APPROVERS,
        pendingAction: {
          httpMethod: 'POST',
          httpPath: '/api/x',
          payloadJson: '{}'
        }
      });
      resetPermissionRequestsForTests();
      expect(listAllPermissionRequestsForTests()).toHaveLength(0);
      expect(listAllPendingActionsForTests()).toHaveLength(0);
    });
  });
});
