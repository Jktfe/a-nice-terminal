import { describe, it, expect, beforeEach } from 'vitest';
import {
  createValidationSchema,
  listValidationSchemas,
  getValidationSchema,
  archiveValidationSchema,
  createValidationRun,
  completeValidationRun,
  listValidationRunsForClaim,
  seedValidationSchemas,
} from './validationLensStore';
import { getIdentityDb } from './db';

describe('validationLensStore', () => {
  const db = getIdentityDb();

  beforeEach(() => {
    db.prepare('DELETE FROM verification_observations').run();
    db.prepare('DELETE FROM verification_lenses').run();
  });

  describe('create + list', () => {
    it('creates and lists a schema', () => {
      createValidationSchema({
        id: 'test-1', name: 'Test Lens', description: 'A test lens', lensKind: 'poc',
        rulesJson: '[]', createdBy: '@test', archivedAtMs: null,
      });
      const list = listValidationSchemas();
      expect(list).toHaveLength(1);
      expect(list[0].name).toBe('Test Lens');
      expect(list[0].lensKind).toBe('poc');
    });

    it('excludes archived by default', () => {
      createValidationSchema({
        id: 'test-2', name: 'Archived Lens', lensKind: 'custom',
        description: 'Archived test lens',
        rulesJson: '[]', createdBy: '@test', archivedAtMs: null,
      });
      archiveValidationSchema('test-2');
      const list = listValidationSchemas();
      expect(list).toHaveLength(0);
      const all = listValidationSchemas(true);
      expect(all).toHaveLength(1);
    });

    it('defaults schemas to public/global scope', () => {
      createValidationSchema({
        id: 'test-public-default', name: 'Default Public Lens', lensKind: 'custom',
        description: 'Defaults to public/global when no owner scope is supplied.',
        rulesJson: '[]', createdBy: '@test', archivedAtMs: null,
      });

      const schema = getValidationSchema('test-public-default');
      expect(schema).toMatchObject({
        scope: 'public',
        scopeId: 'global',
      });
    });

    it('filters visible schemas by public, user, and org scope', () => {
      createValidationSchema({
        id: 'public-lens', name: 'Public Lens', lensKind: 'custom',
        description: 'Visible to everyone',
        rulesJson: '[]', createdBy: '@test', archivedAtMs: null,
        scope: 'public', scopeId: 'global',
      });
      createValidationSchema({
        id: 'user-lens', name: 'User Lens', lensKind: 'custom',
        description: 'Visible to @james',
        rulesJson: '[]', createdBy: '@test', archivedAtMs: null,
        scope: 'user', scopeId: '@james',
      });
      createValidationSchema({
        id: 'org-lens', name: 'Org Lens', lensKind: 'custom',
        description: 'Visible to org_newmodel_team',
        rulesJson: '[]', createdBy: '@test', archivedAtMs: null,
        scope: 'org', scopeId: 'org_newmodel_team',
      });
      createValidationSchema({
        id: 'other-user-lens', name: 'Other User Lens', lensKind: 'custom',
        description: 'Hidden from @james',
        rulesJson: '[]', createdBy: '@test', archivedAtMs: null,
        scope: 'user', scopeId: '@other',
      });
      createValidationSchema({
        id: 'other-org-lens', name: 'Other Org Lens', lensKind: 'custom',
        description: 'Hidden from org_newmodel_team',
        rulesJson: '[]', createdBy: '@test', archivedAtMs: null,
        scope: 'org', scopeId: 'org_other',
      });

      const visible = listValidationSchemas({
        visibleTo: {
          handles: ['@james'],
          orgId: 'org_newmodel_team',
          isAdmin: false,
        },
      });
      expect(visible.map((schema) => schema.id).sort()).toEqual([
        'org-lens',
        'public-lens',
        'user-lens',
      ]);
    });
  });

  describe('validation runs', () => {
    it('creates and completes a run', () => {
      createValidationSchema({
        id: 'schema-1', name: 'POC', lensKind: 'poc',
        description: 'POC test lens',
        rulesJson: '[]', createdBy: '@test', archivedAtMs: null,
      });
      createValidationRun({
        id: 'run-1', schemaId: 'schema-1', claimAnchor: 'claim-a',
        claimText: 'We do X', status: 'pending', score: null, resultJson: null, runBy: '@test',
      });
      completeValidationRun('run-1', 'passed', 95, '{"checks":3}');
      const runs = listValidationRunsForClaim('claim-a');
      expect(runs).toHaveLength(1);
      expect(runs[0].status).toBe('passed');
      expect(runs[0].score).toBe(95);
    });
  });

  describe('seed', () => {
    it('idempotently seeds default schemas', () => {
      seedValidationSchemas();
      seedValidationSchemas(); // idempotent
      const list = listValidationSchemas();
      expect(list.length).toBeGreaterThanOrEqual(3);
    });
  });
});
