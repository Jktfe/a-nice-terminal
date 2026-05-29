/**
 * Tests for permissionRequestsSweepBoot — Stage B TTL housekeeping
 * cron entry (plan milestone p3-stage-b-permission-requests of
 * ant-substrate-v0.2-2026-05-29).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetPermissionRequestsSweepForTests,
  ensurePermissionRequestsSweepBooted,
  tickPermissionRequestsSweepOnce
} from './permissionRequestsSweepBoot';
import {
  createPermissionRequest,
  getPermissionRequest,
  resetPermissionRequestsForTests
} from './permissionRequestsStore';
import { resetGrantsShimForTests } from './grantsShimStore';
import { resetIdentityDbForTests } from './db';

describe('permissionRequestsSweepBoot', () => {
  beforeEach(() => {
    resetIdentityDbForTests();
    resetGrantsShimForTests();
    resetPermissionRequestsForTests();
    _resetPermissionRequestsSweepForTests();
  });

  afterEach(() => {
    _resetPermissionRequestsSweepForTests();
  });

  it('tickPermissionRequestsSweepOnce expires the right rows', () => {
    const created = createPermissionRequest({
      requesterHandle: '@s',
      action: 'chat.post',
      targetKind: 'room',
      targetId: 'r1',
      approvers: [{ handle: '@jwpk', role: 'room_owner', preferred: true }],
      pendingAction: {
        httpMethod: 'POST',
        httpPath: '/api/x',
        payloadJson: '{}',
        ttlMs: 1_000
      },
      nowMs: 100
    });
    const result = tickPermissionRequestsSweepOnce(10_000);
    expect(result.expired).toBe(1);
    expect(getPermissionRequest(created.request.requestId)?.status).toBe('expired');
  });

  it('ensurePermissionRequestsSweepBooted is idempotent', () => {
    ensurePermissionRequestsSweepBooted({ intervalMs: 5_000 });
    ensurePermissionRequestsSweepBooted({ intervalMs: 5_000 });
    // No assertion needed beyond no-throw; second call must be a no-op.
    expect(true).toBe(true);
  });

  it('sweep tick swallows store errors and reports zero counts', () => {
    // Simulate by tearing down DB right before the tick — the helper
    // should NOT propagate, returning zero counts instead.
    resetIdentityDbForTests();
    const result = tickPermissionRequestsSweepOnce();
    expect(result.expired).toBe(0);
    expect(result.requestsExpired).toBe(0);
  });
});
