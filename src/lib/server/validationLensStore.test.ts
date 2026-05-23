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
    db.prepare('DELETE FROM validation_runs').run();
    db.prepare('DELETE FROM validation_schemas').run();
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
