import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resolveLensActor,
  visibilityForActor,
  requireReadableLens,
  requireWritableLens,
  requireAuditReadableLens,
  scopeIdFor,
  type ResolvedLensActor
} from './verificationLensApi';
import { createValidationSchema, archiveValidationSchema } from './validationLensStore';
import { getIdentityDb } from './db';

/**
 * Sec-iter3 defense-in-depth tests for verificationLensApi.
 *
 * The critical invariant under test: actor authority MUST be driven by
 * `actor.isAdminBearer === true`, NOT by `actor.handle === '@admin'`.
 *
 * Pre-iter3 the lens API short-circuited via string-eq on the handle. If
 * a future writer ever lands the literal '@admin' into an attacker-
 * controlled handle field, that attacker would gain admin authority on
 * lens reads / writes / audit. The fix routes admin through a typed
 * `isAdminBearer` flag that can ONLY be set by the constant-time
 * ANT_ADMIN_TOKEN match inside `resolveLensActor`.
 *
 * These tests plant `@admin` as `actor.handle` via direct construction
 * (the same shape an attacker would land) and assert that NONE of the
 * authority paths grant admin power.
 */

beforeEach(() => {
  const db = getIdentityDb();
  db.prepare('DELETE FROM verification_lenses').run();
});

afterEach(() => {
  const db = getIdentityDb();
  db.prepare('DELETE FROM verification_lenses').run();
  delete process.env.ANT_ADMIN_TOKEN;
});

function plantedAdminHandleActor(): ResolvedLensActor {
  // An attacker who somehow lands '@admin' into a handle field but did
  // NOT supply a valid ANT_ADMIN_TOKEN Bearer header. The defense-in-
  // depth invariant: isAdminBearer is false, so authority is denied.
  return { handle: '@admin', kind: 'human', isAdminBearer: false };
}

function genuineAdminBearerActor(): ResolvedLensActor {
  // The shape `resolveLensActor` returns when tryAdminBearer matches.
  return { handle: '@admin', kind: 'human', isAdminBearer: true };
}

function ordinaryUserActor(handle: string): ResolvedLensActor {
  return { handle, kind: 'human', isAdminBearer: false };
}

describe('resolveLensActor', () => {
  it('returns isAdminBearer=true ONLY when ANT_ADMIN_TOKEN Bearer matches', () => {
    process.env.ANT_ADMIN_TOKEN = 'secret-token-value';
    const request = new Request('http://test.local/api/verification/lenses', {
      headers: { authorization: 'Bearer secret-token-value' }
    });
    const actor = resolveLensActor(request, null);
    expect(actor).toBeTruthy();
    expect(actor!.isAdminBearer).toBe(true);
    expect(actor!.handle).toBe('@admin');
  });

  it('returns isAdminBearer=false when no admin bearer + no pidchain + no cookie', () => {
    delete process.env.ANT_ADMIN_TOKEN;
    const request = new Request('http://test.local/api/verification/lenses');
    const actor = resolveLensActor(request, null);
    expect(actor).toBeNull();
  });

  it('returns isAdminBearer=false when bearer token does not match', () => {
    process.env.ANT_ADMIN_TOKEN = 'configured-token';
    const request = new Request('http://test.local/api/verification/lenses', {
      headers: { authorization: 'Bearer wrong-token' }
    });
    const actor = resolveLensActor(request, null);
    // No admin bearer match + no cookie/pidChain → returns null.
    expect(actor).toBeNull();
  });
});

describe('visibilityForActor', () => {
  it('treats genuine admin bearer as isAdmin=true', () => {
    const visibility = visibilityForActor(genuineAdminBearerActor());
    expect(visibility.isAdmin).toBe(true);
  });

  it('DOES NOT treat a planted @admin handle as isAdmin=true', () => {
    // Defense-in-depth: an attacker who lands '@admin' as their handle
    // (e.g. via a future writer that opens a new spoof surface) must
    // NOT inherit admin visibility. The check now reads isAdminBearer.
    const visibility = visibilityForActor(plantedAdminHandleActor());
    expect(visibility.isAdmin).toBe(false);
    expect(visibility.handles).toEqual(['@admin']);
  });

  it('returns the handle-scoped visibility for ordinary users', () => {
    const visibility = visibilityForActor(ordinaryUserActor('@alice'));
    expect(visibility.isAdmin).toBe(false);
    expect(visibility.handles).toEqual(['@alice']);
  });

  it('returns empty visibility for null actor', () => {
    const visibility = visibilityForActor(null);
    expect(visibility.isAdmin).toBe(false);
    expect(visibility.handles).toEqual([]);
  });
});

describe('requireReadableLens', () => {
  it('grants admin-bearer access to user-scoped lens owned by someone else', () => {
    createValidationSchema({
      id: 'lens-owner-private', name: 'Owner Private', lensKind: 'custom',
      description: null, rulesJson: '{}', createdBy: '@owner', archivedAtMs: null,
      scope: 'user', scopeId: '@owner'
    });
    const result = requireReadableLens('lens-owner-private', genuineAdminBearerActor());
    expect(result.id).toBe('lens-owner-private');
  });

  it('DENIES access when handle="@admin" is planted but isAdminBearer=false', () => {
    createValidationSchema({
      id: 'lens-owner-private-2', name: 'Owner Private 2', lensKind: 'custom',
      description: null, rulesJson: '{}', createdBy: '@owner', archivedAtMs: null,
      scope: 'user', scopeId: '@owner'
    });
    // Attacker plants '@admin' as their handle but has no real admin
    // bearer. The pre-iter3 string-eq check would have GRANTED access
    // (handle === '@admin'). The post-iter3 typed check denies with 403.
    expect(() =>
      requireReadableLens('lens-owner-private-2', plantedAdminHandleActor())
    ).toThrowError(expect.objectContaining({ status: 403 }));
  });

  it('grants ordinary user access to their own user-scoped lens', () => {
    createValidationSchema({
      id: 'lens-alice-own', name: 'Alice Own', lensKind: 'custom',
      description: null, rulesJson: '{}', createdBy: '@alice', archivedAtMs: null,
      scope: 'user', scopeId: '@alice'
    });
    const result = requireReadableLens('lens-alice-own', ordinaryUserActor('@alice'));
    expect(result.id).toBe('lens-alice-own');
  });

  it('denies ordinary user access to another user\'s lens', () => {
    createValidationSchema({
      id: 'lens-bob-own', name: 'Bob Own', lensKind: 'custom',
      description: null, rulesJson: '{}', createdBy: '@bob', archivedAtMs: null,
      scope: 'user', scopeId: '@bob'
    });
    expect(() =>
      requireReadableLens('lens-bob-own', ordinaryUserActor('@alice'))
    ).toThrowError(expect.objectContaining({ status: 403 }));
  });
});

describe('requireWritableLens', () => {
  it('grants admin-bearer write to user-scoped lens owned by someone else', () => {
    createValidationSchema({
      id: 'lens-owner-edit-admin', name: 'Owner Edit Admin', lensKind: 'custom',
      description: null, rulesJson: '{}', createdBy: '@owner', archivedAtMs: null,
      scope: 'user', scopeId: '@owner'
    });
    const result = requireWritableLens('lens-owner-edit-admin', genuineAdminBearerActor());
    expect(result.id).toBe('lens-owner-edit-admin');
  });

  it('DENIES write when handle="@admin" is planted but isAdminBearer=false', () => {
    createValidationSchema({
      id: 'lens-owner-edit-spoof', name: 'Owner Edit Spoof', lensKind: 'custom',
      description: null, rulesJson: '{}', createdBy: '@owner', archivedAtMs: null,
      scope: 'user', scopeId: '@owner'
    });
    // Attacker tries to edit @owner's lens by planting '@admin' as their
    // handle. Pre-iter3: read passes (handle === '@admin'), write passes
    // (handle === '@admin'). Post-iter3: read denies first.
    expect(() =>
      requireWritableLens('lens-owner-edit-spoof', plantedAdminHandleActor())
    ).toThrow();
  });

  it('grants owner write access to their own user-scoped lens', () => {
    createValidationSchema({
      id: 'lens-alice-edit-own', name: 'Alice Edit Own', lensKind: 'custom',
      description: null, rulesJson: '{}', createdBy: '@alice', archivedAtMs: null,
      scope: 'user', scopeId: '@alice'
    });
    const result = requireWritableLens('lens-alice-edit-own', ordinaryUserActor('@alice'));
    expect(result.id).toBe('lens-alice-edit-own');
  });

  it('denies non-owner write access to user-scoped lens', () => {
    createValidationSchema({
      id: 'lens-public-edit', name: 'Public Edit Attempt', lensKind: 'custom',
      description: null, rulesJson: '{}', createdBy: '@bob', archivedAtMs: null,
      scope: 'public', scopeId: 'global'
    });
    // Public lens is readable but only writable by admin bearer.
    expect(() =>
      requireWritableLens('lens-public-edit', ordinaryUserActor('@alice'))
    ).toThrowError(expect.objectContaining({ status: 403 }));
  });
});

describe('requireAuditReadableLens', () => {
  it('grants admin-bearer audit access to archived lens', () => {
    createValidationSchema({
      id: 'lens-archived-admin', name: 'Archived Admin', lensKind: 'custom',
      description: null, rulesJson: '{}', createdBy: '@someone', archivedAtMs: null,
      scope: 'user', scopeId: '@someone'
    });
    archiveValidationSchema('lens-archived-admin');
    const result = requireAuditReadableLens('lens-archived-admin', genuineAdminBearerActor());
    expect(result.id).toBe('lens-archived-admin');
    expect(result.archivedAtMs).not.toBeNull();
  });

  it('DENIES audit when handle="@admin" is planted but isAdminBearer=false', () => {
    createValidationSchema({
      id: 'lens-archived-spoof', name: 'Archived Spoof', lensKind: 'custom',
      description: null, rulesJson: '{}', createdBy: '@someone', archivedAtMs: null,
      scope: 'user', scopeId: '@someone'
    });
    archiveValidationSchema('lens-archived-spoof');
    // Pre-iter3 the spoofed handle would have unlocked archived-audit
    // visibility. Post-iter3 it 404s (archived + not visible).
    expect(() =>
      requireAuditReadableLens('lens-archived-spoof', plantedAdminHandleActor())
    ).toThrow();
  });
});

describe('scopeIdFor', () => {
  it('returns the actor handle for user-scoped lenses', () => {
    expect(scopeIdFor('user', ordinaryUserActor('@alice'), null)).toBe('@alice');
  });

  it('returns "global" for public-scoped lenses', () => {
    expect(scopeIdFor('public', ordinaryUserActor('@alice'), null)).toBe('global');
  });

  it('requires explicit scopeId for org-scoped lenses', () => {
    expect(() => scopeIdFor('org', ordinaryUserActor('@alice'), null)).toThrow();
    expect(scopeIdFor('org', ordinaryUserActor('@alice'), 'org_acme')).toBe('org_acme');
  });
});
