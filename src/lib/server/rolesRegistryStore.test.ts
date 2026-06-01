/**
 * Tests for rolesRegistryStore — M6.1 RBAC role registry of the antOS
 * Enterprise Control Plane plan.
 *
 * Covers:
 *   - seed idempotency (4 canonical roles materialise once)
 *   - CRUD on a custom role (create + read + patch + delete)
 *   - cannot delete or patch seeded rows
 *   - role-id conflict raises ROLE_ID_CONFLICT
 *   - assignment lifecycle: assign + list-by-handle + list-by-role +
 *     unassign by assignmentId
 *
 * The store API is intentionally narrow + deterministic so capability-
 * policy gates (M3/M4) can target stable role IDs without re-deriving
 * the role catalogue from scratch.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  listRoles,
  getRole,
  createRole,
  updateRole,
  deleteRole,
  assignRole,
  unassignRole,
  listAssignmentsFor,
  listAssignmentsByRole,
  seedRolesRegistry,
  ROLE_ID_CONFLICT,
  SEEDED_ROLE_PROTECTED,
  resetRolesRegistryForTests,
  SEEDED_ROLE_IDS
} from './rolesRegistryStore';
import { resetIdentityDbForTests } from './db';

describe('rolesRegistryStore', () => {
  beforeEach(() => {
    resetIdentityDbForTests();
    resetRolesRegistryForTests();
  });

  describe('seed', () => {
    it('seedRolesRegistry inserts the four canonical roles', () => {
      seedRolesRegistry();
      const roles = listRoles();
      const ids = roles.map((r) => r.roleId).sort();
      expect(ids).toEqual(
        ['super-admin', 'org-admin', 'room-owner', 'member'].sort()
      );
    });

    it('every seeded role is flagged is_seeded=true', () => {
      seedRolesRegistry();
      const roles = listRoles();
      for (const role of roles) {
        expect(role.isSeeded).toBe(true);
      }
    });

    it('seed is idempotent — re-running does not duplicate rows', () => {
      seedRolesRegistry();
      seedRolesRegistry();
      seedRolesRegistry();
      expect(listRoles()).toHaveLength(4);
    });

    it('SEEDED_ROLE_IDS lists the four canonical IDs verbatim', () => {
      expect([...SEEDED_ROLE_IDS].sort()).toEqual(
        ['super-admin', 'org-admin', 'room-owner', 'member'].sort()
      );
    });

    it('super-admin carries the wildcard capability at global scope', () => {
      seedRolesRegistry();
      const role = getRole('super-admin');
      expect(role).not.toBeNull();
      expect(role?.capabilities).toContainEqual({ capability: '*', scope: 'global' });
    });

    it('room-owner carries verification.author at room scope', () => {
      seedRolesRegistry();
      const role = getRole('room-owner');
      expect(role?.capabilities).toContainEqual({
        capability: 'verification.author',
        scope: 'room'
      });
    });

    it('member carries the read-only capability pair at room scope', () => {
      seedRolesRegistry();
      const role = getRole('member');
      const caps = role?.capabilities.map((c) => c.capability).sort() ?? [];
      expect(caps).toEqual(['room.read', 'verification.read']);
    });
  });

  describe('createRole + getRole', () => {
    it('inserts a custom role with capabilities + reads it back', () => {
      const created = createRole({
        roleId: 'auditor',
        name: 'Auditor',
        description: 'Read-only forensic access',
        capabilities: [
          { capability: 'audit.read', scope: 'org' },
          { capability: 'verification.read', scope: 'org' }
        ]
      });
      expect(created.roleId).toBe('auditor');
      expect(created.isSeeded).toBe(false);
      const fetched = getRole('auditor');
      expect(fetched?.name).toBe('Auditor');
      expect(fetched?.capabilities).toHaveLength(2);
    });

    it('returns null for an unknown roleId', () => {
      expect(getRole('does-not-exist')).toBeNull();
    });

    it('throws ROLE_ID_CONFLICT when the same roleId is created twice', () => {
      createRole({ roleId: 'x', name: 'X', capabilities: [] });
      expect(() =>
        createRole({ roleId: 'x', name: 'X again', capabilities: [] })
      ).toThrow(ROLE_ID_CONFLICT);
    });

    it('throws ROLE_ID_CONFLICT when the roleId collides with a seeded id', () => {
      seedRolesRegistry();
      expect(() =>
        createRole({
          roleId: 'super-admin',
          name: 'Shadow super',
          capabilities: []
        })
      ).toThrow(ROLE_ID_CONFLICT);
    });
  });

  describe('updateRole', () => {
    it('patches name + description + capabilities on a custom role', () => {
      createRole({ roleId: 'tmp', name: 'Tmp', capabilities: [] });
      updateRole('tmp', {
        name: 'Renamed',
        description: 'New desc',
        capabilities: [{ capability: 'room.read', scope: 'room' }]
      });
      const fetched = getRole('tmp');
      expect(fetched?.name).toBe('Renamed');
      expect(fetched?.description).toBe('New desc');
      expect(fetched?.capabilities).toEqual([
        { capability: 'room.read', scope: 'room' }
      ]);
    });

    it('refuses to patch a seeded role', () => {
      seedRolesRegistry();
      expect(() =>
        updateRole('member', { name: 'Member-prime', capabilities: [] })
      ).toThrow(SEEDED_ROLE_PROTECTED);
    });

    it('returns null patches as no-ops (does not clobber existing values)', () => {
      createRole({
        roleId: 'tmp',
        name: 'Tmp',
        description: 'desc',
        capabilities: [{ capability: 'a', scope: 'org' }]
      });
      updateRole('tmp', {});
      const fetched = getRole('tmp');
      expect(fetched?.name).toBe('Tmp');
      expect(fetched?.description).toBe('desc');
      expect(fetched?.capabilities).toHaveLength(1);
    });
  });

  describe('deleteRole', () => {
    it('removes a custom role + cascades assignments first', () => {
      createRole({ roleId: 'tmp', name: 'Tmp', capabilities: [] });
      assignRole({
        roleId: 'tmp',
        identityHandle: '@speedy',
        scopeKind: 'org',
        scopeId: 'org_x',
        assignedByHandle: '@admin'
      });
      expect(listAssignmentsByRole('tmp')).toHaveLength(1);
      deleteRole('tmp');
      expect(getRole('tmp')).toBeNull();
      expect(listAssignmentsByRole('tmp')).toHaveLength(0);
    });

    it('refuses to delete a seeded role', () => {
      seedRolesRegistry();
      expect(() => deleteRole('super-admin')).toThrow(SEEDED_ROLE_PROTECTED);
      expect(getRole('super-admin')).not.toBeNull();
    });

    it('deleting an unknown role is a no-op (no throw)', () => {
      expect(() => deleteRole('unknown')).not.toThrow();
    });
  });

  describe('assignRole + unassignRole', () => {
    beforeEach(() => {
      seedRolesRegistry();
    });

    it('assigns + lists assignments for the handle', () => {
      const a = assignRole({
        roleId: 'org-admin',
        identityHandle: '@speedy',
        scopeKind: 'org',
        scopeId: 'org_x',
        assignedByHandle: '@admin'
      });
      expect(a.assignmentId).toMatch(/^ra_/);
      const rows = listAssignmentsFor('@speedy');
      expect(rows).toHaveLength(1);
      expect(rows[0].roleId).toBe('org-admin');
      expect(rows[0].scopeKind).toBe('org');
      expect(rows[0].scopeId).toBe('org_x');
      expect(rows[0].assignedByHandle).toBe('@admin');
    });

    it('normalises identity handles missing the leading @ on write + read', () => {
      assignRole({
        roleId: 'member',
        identityHandle: 'rox',
        scopeKind: 'room',
        scopeId: 'r1',
        assignedByHandle: 'admin'
      });
      const rows = listAssignmentsFor('rox');
      expect(rows).toHaveLength(1);
      expect(rows[0].identityHandle).toBe('@rox');
      expect(rows[0].assignedByHandle).toBe('@admin');
    });

    it('lists assignments by role across handles', () => {
      assignRole({
        roleId: 'member',
        identityHandle: '@a',
        scopeKind: 'room',
        scopeId: 'r1',
        assignedByHandle: '@admin'
      });
      assignRole({
        roleId: 'member',
        identityHandle: '@b',
        scopeKind: 'room',
        scopeId: 'r1',
        assignedByHandle: '@admin'
      });
      const rows = listAssignmentsByRole('member');
      expect(rows).toHaveLength(2);
    });

    it('unassignRole removes the row by assignmentId', () => {
      const a = assignRole({
        roleId: 'member',
        identityHandle: '@a',
        scopeKind: 'room',
        scopeId: 'r1',
        assignedByHandle: '@admin'
      });
      unassignRole(a.assignmentId);
      expect(listAssignmentsFor('@a')).toHaveLength(0);
    });

    it('assigning a role that does not exist throws', () => {
      expect(() =>
        assignRole({
          roleId: 'nope',
          identityHandle: '@a',
          scopeKind: 'org',
          scopeId: 'o1',
          assignedByHandle: '@admin'
        })
      ).toThrow();
    });
  });
});
