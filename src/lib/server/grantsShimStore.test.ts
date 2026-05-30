/**
 * Tests for grantsShimStore — Stage A grants table backing the
 * `ant grant` CLI verb + auth-gate `no_grant` lookup (plan milestone
 * p3-stage-a-grant-cli of ant-substrate-v0.2-2026-05-29).
 *
 * Covers T4 + T5 of the PR spec: grant insert → lookup hits → revoke
 * → lookup misses. Plus normalisation, scope passthrough, and
 * idempotent re-revoke.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  grantPermission,
  revokePermission,
  lookupActiveGrant,
  listAllGrantsForTests,
  resetGrantsShimForTests
} from './grantsShimStore';
import { resetIdentityDbForTests } from './db';

describe('grantsShimStore', () => {
  beforeEach(() => {
    resetIdentityDbForTests();
    resetGrantsShimForTests();
  });

  describe('grantPermission + lookupActiveGrant', () => {
    it('T4: grant inserts an active row that lookup finds', () => {
      grantPermission({
        granteeHandle: '@speedyc',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'orsz2321qb',
        grantedByHandle: '@jwpk'
      });
      const found = lookupActiveGrant({
        granteeHandle: '@speedyc',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'orsz2321qb'
      });
      expect(found).not.toBeNull();
      expect(found?.granteeHandle).toBe('@speedyc');
      expect(found?.grantedByHandle).toBe('@jwpk');
      expect(found?.revokedAtMs).toBeNull();
    });

    it('defaults scope to once when omitted', () => {
      const granted = grantPermission({
        granteeHandle: '@x',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'r1',
        grantedByHandle: '@owner'
      });
      expect(granted.scope).toBe('once');
    });

    it('records explicit scope when supplied', () => {
      const granted = grantPermission({
        granteeHandle: '@x',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'r1',
        grantedByHandle: '@owner',
        scope: 'always-for-room'
      });
      expect(granted.scope).toBe('always-for-room');
    });

    it('normalises handles missing the leading @ on read and write paths', () => {
      grantPermission({
        granteeHandle: 'speedyc',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'r1',
        grantedByHandle: 'jwpk'
      });
      const found = lookupActiveGrant({
        granteeHandle: 'speedyc',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'r1'
      });
      expect(found?.granteeHandle).toBe('@speedyc');
      expect(found?.grantedByHandle).toBe('@jwpk');
    });

    it('returns null when no active grant exists', () => {
      const found = lookupActiveGrant({
        granteeHandle: '@nobody',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'r1'
      });
      expect(found).toBeNull();
    });

    it('returns the most recent active grant when multiple exist', () => {
      grantPermission({
        granteeHandle: '@x',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'r1',
        grantedByHandle: '@owner',
        nowMs: 1000
      });
      grantPermission({
        granteeHandle: '@x',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'r1',
        grantedByHandle: '@owner2',
        nowMs: 2000
      });
      const found = lookupActiveGrant({
        granteeHandle: '@x',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'r1'
      });
      expect(found?.grantedAtMs).toBe(2000);
      expect(found?.grantedByHandle).toBe('@owner2');
    });
  });

  describe('revokePermission', () => {
    it('T5: revoke removes the active row from lookup', () => {
      grantPermission({
        granteeHandle: '@x',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'r1',
        grantedByHandle: '@owner'
      });
      expect(
        lookupActiveGrant({
          granteeHandle: '@x',
          action: 'chat.post',
          targetKind: 'room',
          targetId: 'r1'
        })
      ).not.toBeNull();
      const revokedCount = revokePermission({
        granteeHandle: '@x',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'r1'
      });
      expect(revokedCount).toBe(1);
      expect(
        lookupActiveGrant({
          granteeHandle: '@x',
          action: 'chat.post',
          targetKind: 'room',
          targetId: 'r1'
        })
      ).toBeNull();
    });

    it('returns 0 when no active grant exists', () => {
      const count = revokePermission({
        granteeHandle: '@nobody',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'r1'
      });
      expect(count).toBe(0);
    });

    it('is idempotent — re-revoking returns 0 the second time', () => {
      grantPermission({
        granteeHandle: '@x',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'r1',
        grantedByHandle: '@owner'
      });
      expect(
        revokePermission({
          granteeHandle: '@x',
          action: 'chat.post',
          targetKind: 'room',
          targetId: 'r1'
        })
      ).toBe(1);
      expect(
        revokePermission({
          granteeHandle: '@x',
          action: 'chat.post',
          targetKind: 'room',
          targetId: 'r1'
        })
      ).toBe(0);
    });

    it('preserves the audit trail — revoked rows still appear via listAllGrantsForTests', () => {
      grantPermission({
        granteeHandle: '@x',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'r1',
        grantedByHandle: '@owner'
      });
      revokePermission({
        granteeHandle: '@x',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'r1'
      });
      const all = listAllGrantsForTests();
      expect(all).toHaveLength(1);
      expect(all[0].revokedAtMs).not.toBeNull();
    });

    it('grant-revoke-grant cycle: subsequent grant becomes the active row', () => {
      grantPermission({
        granteeHandle: '@x',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'r1',
        grantedByHandle: '@owner',
        nowMs: 1000
      });
      revokePermission({
        granteeHandle: '@x',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'r1',
        nowMs: 1500
      });
      grantPermission({
        granteeHandle: '@x',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'r1',
        grantedByHandle: '@owner',
        nowMs: 2000
      });
      const found = lookupActiveGrant({
        granteeHandle: '@x',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'r1'
      });
      expect(found).not.toBeNull();
      expect(found?.grantedAtMs).toBe(2000);
      expect(listAllGrantsForTests()).toHaveLength(2);
    });
  });
});
