/**
 * taskOutcomeRecorder tests — the live lifecycle hook that the
 * /api/tasks/:taskId route calls. Verifies the before→after status
 * transition is classified and an append-only task_outcomes row is
 * written, that non-outcome transitions write nothing, and that the JWPK
 * status mapper is correct.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIdentityDbForTests } from './db';
import { listLatestOutcomes, listOutcomesForTask } from './taskOutcomesStore';
import { recordTaskTransitionOutcome, jwpkStatusToDb } from './taskOutcomeRecorder';

let tmpDir: string;
const prevDbPath = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-task-outcome-recorder-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (prevDbPath === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = prevDbPath;
});

describe('jwpkStatusToDb', () => {
  it('maps the JWPK labels to the DB enum', () => {
    expect(jwpkStatusToDb('todo')).toBe('pending');
    expect(jwpkStatusToDb('done')).toBe('completed');
    expect(jwpkStatusToDb('cancelled')).toBe('deleted');
    expect(jwpkStatusToDb('in_progress')).toBe('in_progress');
    expect(jwpkStatusToDb('blocked')).toBe('blocked');
    expect(jwpkStatusToDb('weird')).toBe('weird'); // pass-through
  });
});

describe('recordTaskTransitionOutcome', () => {
  it('records a clean outcome on in_progress→completed', () => {
    const rec = recordTaskTransitionOutcome({
      taskId: 't-clean', fromStatus: 'in_progress', toStatus: 'completed'
    });
    expect(rec?.outcome).toBe('clean');
    expect(rec?.source).toBe('live');
    expect(listOutcomesForTask('t-clean')).toHaveLength(1);
  });

  it('records a reopened outcome on completed→in_progress', () => {
    const rec = recordTaskTransitionOutcome({
      taskId: 't-reopen', fromStatus: 'completed', toStatus: 'in_progress'
    });
    expect(rec?.outcome).toBe('reopened');
  });

  it('records an abandoned outcome on →deleted', () => {
    const rec = recordTaskTransitionOutcome({
      taskId: 't-del', fromStatus: 'in_progress', toStatus: 'deleted'
    });
    expect(rec?.outcome).toBe('abandoned');
  });

  it('records a corrected outcome on an operator re-scope with no status move', () => {
    const rec = recordTaskTransitionOutcome({
      taskId: 't-fix', fromStatus: 'in_progress', toStatus: 'in_progress',
      operatorRescopeAfterWork: true
    });
    expect(rec?.outcome).toBe('corrected');
  });

  it('writes NOTHING on a non-outcome transition (pending→in_progress)', () => {
    const rec = recordTaskTransitionOutcome({
      taskId: 't-progress', fromStatus: 'pending', toStatus: 'in_progress'
    });
    expect(rec).toBeNull();
    expect(listOutcomesForTask('t-progress')).toHaveLength(0);
  });

  it('writes NOTHING on a no-op status with no re-scope flag', () => {
    const rec = recordTaskTransitionOutcome({
      taskId: 't-noop', fromStatus: 'in_progress', toStatus: 'in_progress'
    });
    expect(rec).toBeNull();
  });

  it('a later reopen supersedes an earlier clean for the same task', () => {
    recordTaskTransitionOutcome({ taskId: 't', fromStatus: 'in_progress', toStatus: 'completed' });
    recordTaskTransitionOutcome({ taskId: 't', fromStatus: 'completed', toStatus: 'in_progress' });
    const latest = listLatestOutcomes().find((r) => r.taskId === 't');
    expect(latest?.outcome).toBe('reopened');
  });
});
