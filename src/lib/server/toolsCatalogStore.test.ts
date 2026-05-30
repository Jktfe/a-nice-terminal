/**
 * Tests for toolsCatalogStore — PR-D tools catalog migration.
 *
 * Coverage:
 *   - register + idempotent re-register
 *   - validation (kind, minTier, scopeKind)
 *   - deprecate (idempotent, blocks on retired)
 *   - retire (idempotent)
 *   - re-register after retire (slug index excludes retired)
 *   - list with filters
 *   - findBySlug / findById
 *   - grantTool + lookupActiveGrant
 *   - grant against retired tool throws
 *   - revokeToolGrant idempotency + scope_id NULL handling
 *   - expires_at_ms in past => not active
 *   - listGrantsForAgent / listGrantsForTool
 *   - listOrphanGrants (the nifty-leak detector)
 *   - listOrphanedTools
 *   - listRevocationsSince
 *   - countActiveGrantsForTool
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  registerTool,
  deprecateTool,
  retireTool,
  listTools,
  findToolBySlug,
  findToolById,
  grantTool,
  revokeToolGrant,
  lookupActiveGrant,
  listGrantsForAgent,
  listGrantsForTool,
  listOrphanGrants,
  listOrphanedTools,
  listRevocationsSince,
  countActiveGrantsForTool,
  resetToolsCatalogForTests
} from './toolsCatalogStore';
import { resetIdentityDbForTests } from './db';

describe('toolsCatalogStore', () => {
  beforeEach(() => {
    resetIdentityDbForTests();
    resetToolsCatalogForTests();
  });

  describe('registerTool', () => {
    it('inserts a new tool row and returns it', () => {
      const tool = registerTool({
        toolSlug: 'notify-me',
        kind: 'skill',
        name: 'Notify Me',
        description: 'Sends push notifications to JWPK iPhone'
      });
      expect(tool.toolId).toMatch(/^tool_/);
      expect(tool.toolSlug).toBe('notify-me');
      expect(tool.kind).toBe('skill');
      expect(tool.minTier).toBe('oss');
      expect(tool.retiredAtMs).toBeNull();
    });

    it('is idempotent when re-registering an active slug', () => {
      const first = registerTool({ toolSlug: 'graphify', kind: 'skill', name: 'Graphify' });
      const second = registerTool({ toolSlug: 'graphify', kind: 'skill', name: 'Graphify v2' });
      expect(second.toolId).toBe(first.toolId);
      expect(second.name).toBe('Graphify');
    });

    it('rejects an invalid kind', () => {
      expect(() =>
        registerTool({ toolSlug: 'x', kind: 'invalid' as 'skill', name: 'X' })
      ).toThrow(/invalid kind/);
    });

    it('rejects an invalid minTier', () => {
      expect(() =>
        registerTool({
          toolSlug: 'x',
          kind: 'skill',
          name: 'X',
          minTier: 'gold' as 'oss'
        })
      ).toThrow(/invalid minTier/);
    });

    it('requires toolSlug', () => {
      expect(() =>
        registerTool({ toolSlug: '', kind: 'skill', name: 'X' })
      ).toThrow(/toolSlug required/);
    });

    it('requires name', () => {
      expect(() =>
        registerTool({ toolSlug: 'x', kind: 'skill', name: '' })
      ).toThrow(/name required/);
    });

    it('round-trips metadata as JSON', () => {
      const tool = registerTool({
        toolSlug: 'x',
        kind: 'skill',
        name: 'X',
        metadata: { triggers: ['/x'], author: 'jwpk' }
      });
      const found = findToolById(tool.toolId);
      expect(found?.metadata).toEqual({ triggers: ['/x'], author: 'jwpk' });
    });

    it('records version, owner_org, min_tier', () => {
      const tool = registerTool({
        toolSlug: 'premium-thing',
        kind: 'skill',
        name: 'PT',
        version: '1.2.3',
        ownerOrg: 'newmodelvc',
        minTier: 'premium'
      });
      expect(tool.version).toBe('1.2.3');
      expect(tool.ownerOrg).toBe('newmodelvc');
      expect(tool.minTier).toBe('premium');
    });
  });

  describe('deprecateTool + retireTool', () => {
    it('deprecates a tool without retiring it', () => {
      const tool = registerTool({ toolSlug: 'x', kind: 'skill', name: 'X' });
      const after = deprecateTool(tool.toolId, 1_700_000_000_000);
      expect(after?.deprecatedAtMs).toBe(1_700_000_000_000);
      expect(after?.retiredAtMs).toBeNull();
    });

    it('is idempotent — re-deprecating preserves the original timestamp', () => {
      const tool = registerTool({ toolSlug: 'x', kind: 'skill', name: 'X' });
      deprecateTool(tool.toolId, 100);
      deprecateTool(tool.toolId, 200);
      const found = findToolById(tool.toolId);
      expect(found?.deprecatedAtMs).toBe(100);
    });

    it('retires a tool and excludes it from findBySlug by default', () => {
      const tool = registerTool({ toolSlug: 'nifty', kind: 'skill', name: 'Nifty' });
      retireTool(tool.toolId, 1_700_000_001_000);
      expect(findToolBySlug('nifty')).toBeNull();
      expect(findToolBySlug('nifty', { includeRetired: true })?.retiredAtMs).toBe(1_700_000_001_000);
    });

    it('allows re-registering the same slug after retire (recovery path)', () => {
      const first = registerTool({ toolSlug: 'recovery', kind: 'skill', name: 'R' });
      retireTool(first.toolId);
      const second = registerTool({ toolSlug: 'recovery', kind: 'skill', name: 'R2' });
      expect(second.toolId).not.toBe(first.toolId);
      expect(findToolBySlug('recovery')?.toolId).toBe(second.toolId);
    });
  });

  describe('listTools', () => {
    it('excludes retired tools by default', () => {
      const a = registerTool({ toolSlug: 'a', kind: 'skill', name: 'A' });
      registerTool({ toolSlug: 'b', kind: 'skill', name: 'B' });
      retireTool(a.toolId);
      const list = listTools();
      expect(list.map((t) => t.toolSlug)).toEqual(['b']);
    });

    it('includes retired tools when asked', () => {
      const a = registerTool({ toolSlug: 'a', kind: 'skill', name: 'A' });
      retireTool(a.toolId);
      const list = listTools({ includeRetired: true });
      expect(list.map((t) => t.toolSlug)).toContain('a');
    });

    it('filters by kind', () => {
      registerTool({ toolSlug: 's1', kind: 'skill', name: 'S1' });
      registerTool({ toolSlug: 'm1', kind: 'mcp', name: 'M1' });
      const list = listTools({ kind: 'mcp' });
      expect(list.map((t) => t.toolSlug)).toEqual(['m1']);
    });

    it('filters by owner_org', () => {
      registerTool({ toolSlug: 'a', kind: 'skill', name: 'A', ownerOrg: 'orgA' });
      registerTool({ toolSlug: 'b', kind: 'skill', name: 'B', ownerOrg: 'orgB' });
      const list = listTools({ ownerOrg: 'orgA' });
      expect(list.map((t) => t.toolSlug)).toEqual(['a']);
    });
  });

  describe('grantTool + lookupActiveGrant', () => {
    it('inserts a grant and lookup finds it', () => {
      const tool = registerTool({ toolSlug: 'x', kind: 'skill', name: 'X' });
      grantTool({
        granteeHandle: '@speedyc',
        toolId: tool.toolId,
        scopeKind: 'global',
        grantedByHandle: '@jwpk'
      });
      const found = lookupActiveGrant({
        granteeHandle: '@speedyc',
        toolId: tool.toolId,
        scopeKind: 'global'
      });
      expect(found).not.toBeNull();
      expect(found?.grantedByHandle).toBe('@jwpk');
    });

    it('normalises handles missing leading @', () => {
      const tool = registerTool({ toolSlug: 'x', kind: 'skill', name: 'X' });
      grantTool({
        granteeHandle: 'speedyc',
        toolId: tool.toolId,
        scopeKind: 'global',
        grantedByHandle: 'jwpk'
      });
      const found = lookupActiveGrant({
        granteeHandle: 'speedyc',
        toolId: tool.toolId,
        scopeKind: 'global'
      });
      expect(found?.granteeHandle).toBe('@speedyc');
      expect(found?.grantedByHandle).toBe('@jwpk');
    });

    it('rejects grants against a retired tool', () => {
      const tool = registerTool({ toolSlug: 'x', kind: 'skill', name: 'X' });
      retireTool(tool.toolId);
      expect(() =>
        grantTool({
          granteeHandle: '@x',
          toolId: tool.toolId,
          scopeKind: 'global',
          grantedByHandle: '@y'
        })
      ).toThrow(/retired/);
    });

    it('rejects grants against an unknown tool', () => {
      expect(() =>
        grantTool({
          granteeHandle: '@x',
          toolId: 'tool_nope',
          scopeKind: 'global',
          grantedByHandle: '@y'
        })
      ).toThrow(/not found/);
    });

    it('rejects invalid scope_kind', () => {
      const tool = registerTool({ toolSlug: 'x', kind: 'skill', name: 'X' });
      expect(() =>
        grantTool({
          granteeHandle: '@x',
          toolId: tool.toolId,
          scopeKind: 'planet' as 'global',
          grantedByHandle: '@y'
        })
      ).toThrow(/invalid scopeKind/);
    });

    it('expired grant is not returned by lookupActiveGrant', () => {
      const tool = registerTool({ toolSlug: 'x', kind: 'skill', name: 'X' });
      grantTool({
        granteeHandle: '@x',
        toolId: tool.toolId,
        scopeKind: 'global',
        grantedByHandle: '@y',
        expiresAtMs: 1000
      });
      const found = lookupActiveGrant(
        { granteeHandle: '@x', toolId: tool.toolId, scopeKind: 'global' },
        2000
      );
      expect(found).toBeNull();
    });

    it('grants with scope_id are scoped correctly', () => {
      const tool = registerTool({ toolSlug: 'x', kind: 'skill', name: 'X' });
      grantTool({
        granteeHandle: '@x',
        toolId: tool.toolId,
        scopeKind: 'room',
        scopeId: 'room-a',
        grantedByHandle: '@y'
      });
      expect(
        lookupActiveGrant({
          granteeHandle: '@x',
          toolId: tool.toolId,
          scopeKind: 'room',
          scopeId: 'room-a'
        })
      ).not.toBeNull();
      expect(
        lookupActiveGrant({
          granteeHandle: '@x',
          toolId: tool.toolId,
          scopeKind: 'room',
          scopeId: 'room-b'
        })
      ).toBeNull();
    });
  });

  describe('revokeToolGrant', () => {
    it('revokes an active grant + lookup returns null', () => {
      const tool = registerTool({ toolSlug: 'x', kind: 'skill', name: 'X' });
      grantTool({
        granteeHandle: '@x',
        toolId: tool.toolId,
        scopeKind: 'global',
        grantedByHandle: '@y'
      });
      const count = revokeToolGrant({
        granteeHandle: '@x',
        toolId: tool.toolId,
        scopeKind: 'global'
      });
      expect(count).toBe(1);
      expect(
        lookupActiveGrant({
          granteeHandle: '@x',
          toolId: tool.toolId,
          scopeKind: 'global'
        })
      ).toBeNull();
    });

    it('returns 0 when no matching grant exists', () => {
      expect(
        revokeToolGrant({ granteeHandle: '@x', toolId: 'tool_x', scopeKind: 'global' })
      ).toBe(0);
    });

    it('is idempotent — re-revoking already-revoked is a no-op', () => {
      const tool = registerTool({ toolSlug: 'x', kind: 'skill', name: 'X' });
      grantTool({
        granteeHandle: '@x',
        toolId: tool.toolId,
        scopeKind: 'global',
        grantedByHandle: '@y'
      });
      expect(
        revokeToolGrant({ granteeHandle: '@x', toolId: tool.toolId, scopeKind: 'global' })
      ).toBe(1);
      expect(
        revokeToolGrant({ granteeHandle: '@x', toolId: tool.toolId, scopeKind: 'global' })
      ).toBe(0);
    });

    it('scope_id NULL revoke does NOT touch scope_id=room-a rows', () => {
      const tool = registerTool({ toolSlug: 'x', kind: 'skill', name: 'X' });
      grantTool({
        granteeHandle: '@x',
        toolId: tool.toolId,
        scopeKind: 'global',
        grantedByHandle: '@y'
      });
      grantTool({
        granteeHandle: '@x',
        toolId: tool.toolId,
        scopeKind: 'room',
        scopeId: 'room-a',
        grantedByHandle: '@y'
      });
      revokeToolGrant({ granteeHandle: '@x', toolId: tool.toolId, scopeKind: 'global' });
      // room-a grant must still be active.
      expect(
        lookupActiveGrant({
          granteeHandle: '@x',
          toolId: tool.toolId,
          scopeKind: 'room',
          scopeId: 'room-a'
        })
      ).not.toBeNull();
    });
  });

  describe('listGrants helpers', () => {
    it('listGrantsForAgent returns active + revoked rows', () => {
      const t1 = registerTool({ toolSlug: 't1', kind: 'skill', name: 'T1' });
      const t2 = registerTool({ toolSlug: 't2', kind: 'skill', name: 'T2' });
      grantTool({
        granteeHandle: '@x',
        toolId: t1.toolId,
        scopeKind: 'global',
        grantedByHandle: '@y'
      });
      grantTool({
        granteeHandle: '@x',
        toolId: t2.toolId,
        scopeKind: 'global',
        grantedByHandle: '@y'
      });
      revokeToolGrant({ granteeHandle: '@x', toolId: t2.toolId, scopeKind: 'global' });
      const all = listGrantsForAgent('@x');
      expect(all).toHaveLength(2);
    });

    it('listGrantsForTool returns active + revoked rows', () => {
      const t1 = registerTool({ toolSlug: 't1', kind: 'skill', name: 'T1' });
      grantTool({
        granteeHandle: '@a',
        toolId: t1.toolId,
        scopeKind: 'global',
        grantedByHandle: '@y'
      });
      grantTool({
        granteeHandle: '@b',
        toolId: t1.toolId,
        scopeKind: 'global',
        grantedByHandle: '@y'
      });
      const all = listGrantsForTool(t1.toolId);
      expect(all).toHaveLength(2);
    });
  });

  describe('listOrphanGrants — the nifty-leak detector', () => {
    it('finds active grants pointing at a retired tool', () => {
      const tool = registerTool({ toolSlug: 'nifty', kind: 'skill', name: 'Nifty' });
      grantTool({
        granteeHandle: '@speedyc',
        toolId: tool.toolId,
        scopeKind: 'global',
        grantedByHandle: '@jwpk'
      });
      retireTool(tool.toolId);
      const orphans = listOrphanGrants();
      expect(orphans).toHaveLength(1);
      expect(orphans[0].toolId).toBe(tool.toolId);
    });

    it('does not list grants whose tool is merely deprecated', () => {
      const tool = registerTool({ toolSlug: 'x', kind: 'skill', name: 'X' });
      grantTool({
        granteeHandle: '@x',
        toolId: tool.toolId,
        scopeKind: 'global',
        grantedByHandle: '@y'
      });
      deprecateTool(tool.toolId);
      expect(listOrphanGrants()).toHaveLength(0);
    });

    it('does not list revoked grants on retired tools', () => {
      const tool = registerTool({ toolSlug: 'x', kind: 'skill', name: 'X' });
      grantTool({
        granteeHandle: '@x',
        toolId: tool.toolId,
        scopeKind: 'global',
        grantedByHandle: '@y'
      });
      revokeToolGrant({ granteeHandle: '@x', toolId: tool.toolId, scopeKind: 'global' });
      retireTool(tool.toolId);
      expect(listOrphanGrants()).toHaveLength(0);
    });
  });

  describe('listOrphanedTools', () => {
    it('finds active tools with zero active grants', () => {
      registerTool({ toolSlug: 'unused', kind: 'skill', name: 'Unused' });
      const used = registerTool({ toolSlug: 'used', kind: 'skill', name: 'Used' });
      grantTool({
        granteeHandle: '@x',
        toolId: used.toolId,
        scopeKind: 'global',
        grantedByHandle: '@y'
      });
      const orphans = listOrphanedTools();
      expect(orphans.map((t) => t.toolSlug)).toEqual(['unused']);
    });

    it('does not list retired tools', () => {
      const t = registerTool({ toolSlug: 'retired', kind: 'skill', name: 'R' });
      retireTool(t.toolId);
      expect(listOrphanedTools().map((x) => x.toolSlug)).not.toContain('retired');
    });

    it('lists tools whose only grants are revoked', () => {
      const t = registerTool({ toolSlug: 'now-empty', kind: 'skill', name: 'NE' });
      grantTool({
        granteeHandle: '@x',
        toolId: t.toolId,
        scopeKind: 'global',
        grantedByHandle: '@y'
      });
      revokeToolGrant({ granteeHandle: '@x', toolId: t.toolId, scopeKind: 'global' });
      expect(listOrphanedTools().map((x) => x.toolSlug)).toContain('now-empty');
    });
  });

  describe('listRevocationsSince', () => {
    it('returns revoked grants newer than the cutoff', () => {
      const t = registerTool({ toolSlug: 'x', kind: 'skill', name: 'X' });
      grantTool({
        granteeHandle: '@a',
        toolId: t.toolId,
        scopeKind: 'global',
        grantedByHandle: '@y',
        nowMs: 1000
      });
      grantTool({
        granteeHandle: '@b',
        toolId: t.toolId,
        scopeKind: 'global',
        grantedByHandle: '@y',
        nowMs: 1000
      });
      revokeToolGrant({
        granteeHandle: '@a',
        toolId: t.toolId,
        scopeKind: 'global',
        nowMs: 5000
      });
      revokeToolGrant({
        granteeHandle: '@b',
        toolId: t.toolId,
        scopeKind: 'global',
        nowMs: 9000
      });
      const since = listRevocationsSince(7000);
      expect(since).toHaveLength(1);
      expect(since[0].granteeHandle).toBe('@b');
    });

    it('skips revoked rows older than the cutoff', () => {
      const t = registerTool({ toolSlug: 'x', kind: 'skill', name: 'X' });
      grantTool({
        granteeHandle: '@a',
        toolId: t.toolId,
        scopeKind: 'global',
        grantedByHandle: '@y',
        nowMs: 1000
      });
      revokeToolGrant({
        granteeHandle: '@a',
        toolId: t.toolId,
        scopeKind: 'global',
        nowMs: 2000
      });
      expect(listRevocationsSince(3000)).toHaveLength(0);
    });
  });

  describe('countActiveGrantsForTool', () => {
    it('counts only active grants', () => {
      const t = registerTool({ toolSlug: 'x', kind: 'skill', name: 'X' });
      grantTool({
        granteeHandle: '@a',
        toolId: t.toolId,
        scopeKind: 'global',
        grantedByHandle: '@y'
      });
      grantTool({
        granteeHandle: '@b',
        toolId: t.toolId,
        scopeKind: 'global',
        grantedByHandle: '@y'
      });
      revokeToolGrant({ granteeHandle: '@b', toolId: t.toolId, scopeKind: 'global' });
      expect(countActiveGrantsForTool(t.toolId)).toBe(1);
    });

    it('returns 0 for a tool with no grants', () => {
      const t = registerTool({ toolSlug: 'x', kind: 'skill', name: 'X' });
      expect(countActiveGrantsForTool(t.toolId)).toBe(0);
    });
  });
});
