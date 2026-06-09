/**
 * taskOutcomesStore tests — the append-only delivery-signal instrument.
 *
 * Coverage:
 *   - outcome classification: clean / reopened / corrected / abandoned
 *     (classifyTransition + deriveOutcomeFromTransitions sequence rules)
 *   - snapshot derivation (deriveOutcomeFromSnapshot)
 *   - append-only record + reads (listOutcomesForTask / listLatestOutcomes)
 *   - backfill: derives from the tasks.status snapshot, is IDEMPOTENT
 *     (re-run inserts nothing new), and respects pre-existing live rows
 *   - backfill: derives from audit_events history when task status-delta
 *     events exist (forward-correctness)
 *   - deliverySignal clean-ratio maths (abandoned excluded from denominator)
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getIdentityDb, resetIdentityDbForTests } from './db';
import { createTask, deleteTask } from './taskStore';
import { appendAuditEvent } from './auditEventsStore';
import {
  classifyTransition,
  deriveOutcomeFromTransitions,
  deriveOutcomeFromSnapshot,
  recordTaskOutcome,
  listOutcomesForTask,
  listLatestOutcomes,
  deliverySignal,
  backfillTaskOutcomes,
  isTaskOutcome
} from './taskOutcomesStore';

let tmpDir: string;
const prevDbPath = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-task-outcomes-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (prevDbPath === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = prevDbPath;
});

describe('isTaskOutcome', () => {
  it('accepts the four canonical labels and rejects others', () => {
    for (const ok of ['clean', 'reopened', 'corrected', 'abandoned']) {
      expect(isTaskOutcome(ok)).toBe(true);
    }
    for (const bad of ['done', '', 'CLEAN', null, 42, undefined]) {
      expect(isTaskOutcome(bad)).toBe(false);
    }
  });
});

describe('classifyTransition', () => {
  it('clean: pending→in_progress→completed yields a clean completion', () => {
    expect(classifyTransition({ from: 'pending', to: 'in_progress', workHadBegun: false }))
      .toBeNull(); // progress, not an outcome
    expect(classifyTransition({ from: 'in_progress', to: 'completed', workHadBegun: true }))
      .toBe('clean');
  });

  it('reopened: completed→in_progress is a reversal', () => {
    expect(classifyTransition({ from: 'completed', to: 'in_progress', workHadBegun: true }))
      .toBe('reopened');
  });

  it('reopened: in_progress→pending is a reversal', () => {
    expect(classifyTransition({ from: 'in_progress', to: 'pending', workHadBegun: true }))
      .toBe('reopened');
  });

  it('abandoned: any →deleted/cancelled', () => {
    expect(classifyTransition({ from: 'in_progress', to: 'deleted', workHadBegun: true }))
      .toBe('abandoned');
    expect(classifyTransition({ from: 'pending', to: 'cancelled', workHadBegun: false }))
      .toBe('abandoned');
  });

  it('corrected: operator re-scope (no status move) after work began', () => {
    expect(
      classifyTransition({
        from: 'in_progress', to: 'in_progress', workHadBegun: true, operatorActor: true
      })
    ).toBe('corrected');
    // but NOT when work had not begun
    expect(
      classifyTransition({
        from: 'pending', to: 'pending', workHadBegun: false, operatorActor: true
      })
    ).toBeNull();
  });
});

describe('deriveOutcomeFromTransitions (sequence precedence)', () => {
  it('clean when pending→in_progress→completed with no reversal', () => {
    const out = deriveOutcomeFromTransitions([
      { from: null, to: 'pending' },
      { from: 'pending', to: 'in_progress' },
      { from: 'in_progress', to: 'completed' }
    ]);
    expect(out?.outcome).toBe('clean');
  });

  it('reopened when a completed task is later sent back, even if re-completed', () => {
    const out = deriveOutcomeFromTransitions([
      { from: 'in_progress', to: 'completed' },
      { from: 'completed', to: 'in_progress' }, // reversal
      { from: 'in_progress', to: 'completed' } // re-completed
    ]);
    expect(out?.outcome).toBe('reopened'); // reversal happened → not clean delivery
  });

  it('abandoned dominates everything', () => {
    const out = deriveOutcomeFromTransitions([
      { from: 'in_progress', to: 'completed' },
      { from: 'completed', to: 'in_progress' },
      { from: 'in_progress', to: 'deleted' }
    ]);
    expect(out?.outcome).toBe('abandoned');
  });

  it('null when never completed and not abandoned (still in flight)', () => {
    const out = deriveOutcomeFromTransitions([
      { from: null, to: 'pending' },
      { from: 'pending', to: 'in_progress' }
    ]);
    expect(out).toBeNull();
  });
});

describe('deriveOutcomeFromSnapshot', () => {
  it('completed→clean, deleted/cancelled→abandoned, in-flight→null', () => {
    expect(deriveOutcomeFromSnapshot('completed')?.outcome).toBe('clean');
    expect(deriveOutcomeFromSnapshot('deleted')?.outcome).toBe('abandoned');
    expect(deriveOutcomeFromSnapshot('cancelled')?.outcome).toBe('abandoned');
    expect(deriveOutcomeFromSnapshot('pending')).toBeNull();
    expect(deriveOutcomeFromSnapshot('in_progress')).toBeNull();
    expect(deriveOutcomeFromSnapshot('blocked')).toBeNull();
  });
});

describe('recordTaskOutcome + reads (append-only)', () => {
  it('appends rows and never mutates; latest wins per task', () => {
    recordTaskOutcome({ taskId: 't1', outcome: 'clean', atMs: 100 });
    recordTaskOutcome({ taskId: 't1', outcome: 'reopened', atMs: 200 }); // supersedes
    recordTaskOutcome({ taskId: 't2', outcome: 'clean', atMs: 150 });

    const t1All = listOutcomesForTask('t1');
    expect(t1All.map((r) => r.outcome)).toEqual(['clean', 'reopened']); // both retained

    const latest = listLatestOutcomes();
    const byTask = Object.fromEntries(latest.map((r) => [r.taskId, r.outcome]));
    expect(byTask).toEqual({ t1: 'reopened', t2: 'clean' });
  });

  it('rejects an invalid outcome value', () => {
    // @ts-expect-error — deliberately bad value
    expect(() => recordTaskOutcome({ taskId: 'x', outcome: 'nope' })).toThrow();
  });
});

describe('deliverySignal', () => {
  it('clean-ratio excludes abandoned from the denominator', () => {
    recordTaskOutcome({ taskId: 'a', outcome: 'clean', atMs: 1 });
    recordTaskOutcome({ taskId: 'b', outcome: 'clean', atMs: 1 });
    recordTaskOutcome({ taskId: 'c', outcome: 'clean', atMs: 1 });
    recordTaskOutcome({ taskId: 'd', outcome: 'reopened', atMs: 1 });
    recordTaskOutcome({ taskId: 'e', outcome: 'abandoned', atMs: 1 });

    const sig = deliverySignal();
    expect(sig.total).toBe(5);
    expect(sig.clean).toBe(3);
    expect(sig.reopened).toBe(1);
    expect(sig.abandoned).toBe(1);
    // denominator = clean(3)+reopened(1)+corrected(0) = 4 ; abandoned excluded
    expect(sig.cleanRatio).toBeCloseTo(3 / 4, 10);
  });

  it('null clean-ratio when only abandoned exist', () => {
    recordTaskOutcome({ taskId: 'a', outcome: 'abandoned', atMs: 1 });
    expect(deliverySignal().cleanRatio).toBeNull();
  });
});

describe('backfillTaskOutcomes (snapshot tier)', () => {
  function seedTask(id: string, status: 'pending' | 'in_progress' | 'blocked' | 'completed') {
    createTask({ id, subject: id, status });
  }

  it('derives terminal outcomes from the tasks.status snapshot', () => {
    seedTask('done-1', 'completed');
    seedTask('done-2', 'completed');
    seedTask('wip-1', 'in_progress'); // no terminal outcome
    seedTask('pend-1', 'pending'); // no terminal outcome
    createTask({ id: 'del-1', subject: 'del-1', status: 'completed' });
    deleteTask('del-1'); // → status 'deleted' → abandoned

    const res = backfillTaskOutcomes();
    expect(res.scanned).toBe(5);
    expect(res.inserted).toBe(3); // 2 completed + 1 deleted
    expect(res.skippedNoOutcome).toBe(2); // in_progress + pending
    expect(res.derivedFrom.snapshot).toBe(3);

    const sig = deliverySignal();
    expect(sig.clean).toBe(2);
    expect(sig.abandoned).toBe(1);
    expect(sig.bySource.backfill).toBe(3);
  });

  it('is IDEMPOTENT — a second run inserts nothing new', () => {
    seedTask('done-1', 'completed');
    seedTask('done-2', 'completed');

    const first = backfillTaskOutcomes();
    expect(first.inserted).toBe(2);

    const second = backfillTaskOutcomes();
    expect(second.inserted).toBe(0);
    expect(second.skippedExisting).toBe(2);

    // exactly one row per task — no duplication
    expect(listOutcomesForTask('done-1')).toHaveLength(1);
    expect(listOutcomesForTask('done-2')).toHaveLength(1);
  });

  it('does NOT overwrite a pre-existing LIVE outcome', () => {
    seedTask('reopened-task', 'completed');
    // a live reopen was recorded before backfill ran
    recordTaskOutcome({ taskId: 'reopened-task', outcome: 'reopened', atMs: 50, source: 'live' });

    const res = backfillTaskOutcomes();
    expect(res.skippedExisting).toBe(1);
    expect(res.inserted).toBe(0);

    // the live signal stands — snapshot would have said 'clean'
    expect(deliverySignal().reopened).toBe(1);
    expect(deliverySignal().clean).toBe(0);
  });
});

describe('backfillTaskOutcomes (audit-history tier)', () => {
  it('prefers audit status-delta history over the snapshot', () => {
    // Task whose CURRENT status is completed (snapshot would say clean)…
    createTask({ id: 'reopened-by-audit', subject: 's', status: 'completed' });

    // …but whose audit history shows a reversal. We write task status-delta
    // events via the generic audit log. (entity_kind 'task' is not in the
    // CHECK today, so we use a 'system' entity_kind with a task.status kind
    // and entity_id = the task id — the index keys on entity_id + a kind
    // matching /^task\.status/.)
    appendAuditEvent({
      kind: 'task.status.changed', entityKind: 'system', entityId: 'reopened-by-audit',
      before: { status: 'in_progress' }, after: { status: 'completed' }
    });
    appendAuditEvent({
      kind: 'task.status.changed', entityKind: 'system', entityId: 'reopened-by-audit',
      before: { status: 'completed' }, after: { status: 'in_progress' }
    });
    appendAuditEvent({
      kind: 'task.status.changed', entityKind: 'system', entityId: 'reopened-by-audit',
      before: { status: 'in_progress' }, after: { status: 'completed' }
    });

    const res = backfillTaskOutcomes();
    expect(res.inserted).toBe(1);
    expect(res.derivedFrom.auditHistory).toBe(1);
    expect(res.derivedFrom.snapshot).toBe(0);

    // history wins: a reversal happened → 'reopened', not the snapshot 'clean'
    const sig = deliverySignal();
    expect(sig.reopened).toBe(1);
    expect(sig.clean).toBe(0);
  });
});
