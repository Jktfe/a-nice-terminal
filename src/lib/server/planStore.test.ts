import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createPlan,
  getPlan,
  listPlans,
  archivePlan,
  restorePlan,
  softDeletePlan,
  restoreDeletedPlan,
  updatePlan,
  ensurePlanRow,
  PlanExistsError,
  _resetPlanStoreForTests
} from './planStore';
import {
  createTask,
  listActivePlanCompletions,
  listArchivedPlanCompletions,
  listDeletedPlanCompletions,
  _resetTaskStoreForTests
} from './taskStore';

// Per-worker DB isolation is handled by db.ts when VITEST is set.
function resetAll() {
  _resetPlanStoreForTests();
  _resetTaskStoreForTests();
}

beforeEach(resetAll);
afterEach(resetAll);

describe('planStore', () => {
  it('createPlan creates a record with timestamps and null lifecycle', () => {
    const before = Date.now();
    const p = createPlan({ id: 'plan-a', title: 'Alpha', createdBy: '@tester' });
    expect(p.id).toBe('plan-a');
    expect(p.title).toBe('Alpha');
    expect(p.createdBy).toBe('@tester');
    expect(p.archivedAtMs).toBeNull();
    expect(p.deletedAtMs).toBeNull();
    expect(p.createdAtMs).toBeGreaterThanOrEqual(before);
    expect(p.updatedAtMs).toBeGreaterThanOrEqual(before);
    expect(getPlan('plan-a')?.title).toBe('Alpha');
  });

  it('createPlan throws PlanExistsError on duplicate id', () => {
    createPlan({ id: 'dup' });
    expect(() => createPlan({ id: 'dup' })).toThrow(PlanExistsError);
  });

  it('listPlans defaults to state=active, excludes archived + deleted', () => {
    createPlan({ id: 'p-active' });
    createPlan({ id: 'p-arch' });
    createPlan({ id: 'p-del' });
    archivePlan('p-arch');
    softDeletePlan('p-del');
    const ids = listPlans().map((p) => p.id);
    expect(ids).toEqual(['p-active']);
  });

  it('listPlans state filters: archived / deleted / all', () => {
    createPlan({ id: 'p-active' });
    createPlan({ id: 'p-arch' });
    createPlan({ id: 'p-del' });
    archivePlan('p-arch');
    softDeletePlan('p-del');
    expect(listPlans({ state: 'archived' }).map((p) => p.id)).toEqual(['p-arch']);
    expect(listPlans({ state: 'deleted' }).map((p) => p.id)).toEqual(['p-del']);
    const all = listPlans({ state: 'all' }).map((p) => p.id).sort();
    expect(all).toEqual(['p-active', 'p-arch', 'p-del']);
  });

  it('archivePlan sets archived_at_ms + updated_at_ms; idempotent', () => {
    createPlan({ id: 'p1' });
    const archived = archivePlan('p1');
    expect(archived?.archivedAtMs).not.toBeNull();
    const firstArchivedAt = archived!.archivedAtMs;
    // Idempotent: second call returns the unchanged row.
    const again = archivePlan('p1');
    expect(again?.archivedAtMs).toBe(firstArchivedAt);
  });

  it('archivePlan returns null for unknown id', () => {
    expect(archivePlan('ghost')).toBeNull();
  });

  it('restorePlan clears archived_at_ms; idempotent on already-active', () => {
    createPlan({ id: 'p1' });
    archivePlan('p1');
    const restored = restorePlan('p1');
    expect(restored?.archivedAtMs).toBeNull();
    // Idempotent on already-active:
    const again = restorePlan('p1');
    expect(again?.archivedAtMs).toBeNull();
  });

  it('softDeletePlan sets deleted_at_ms (precedence over archived)', () => {
    createPlan({ id: 'p1' });
    archivePlan('p1');
    const deleted = softDeletePlan('p1');
    expect(deleted?.deletedAtMs).not.toBeNull();
    // Still has archived_at_ms (delete doesn't clear it), but lifecycle
    // queries surface the row only in state='deleted'.
    expect(deleted?.archivedAtMs).not.toBeNull();
    expect(listPlans({ state: 'deleted' }).map((p) => p.id)).toEqual(['p1']);
    expect(listPlans({ state: 'archived' })).toHaveLength(0);
  });

  it('restoreDeletedPlan clears deleted_at_ms; idempotent', () => {
    createPlan({ id: 'p1' });
    softDeletePlan('p1');
    const restored = restoreDeletedPlan('p1');
    expect(restored?.deletedAtMs).toBeNull();
    const again = restoreDeletedPlan('p1');
    expect(again?.deletedAtMs).toBeNull();
  });

  it('updatePlan applies partial fields', () => {
    createPlan({ id: 'p1', title: 'Old', description: 'Desc' });
    const updated = updatePlan('p1', { title: 'New' });
    expect(updated?.title).toBe('New');
    expect(updated?.description).toBe('Desc');
    const desc = updatePlan('p1', { description: null });
    expect(desc?.title).toBe('New');
    expect(desc?.description).toBeNull();
  });

  it('updatePlan returns null for unknown id', () => {
    expect(updatePlan('ghost', { title: 'x' })).toBeNull();
  });

  it('ensurePlanRow is INSERT OR IGNORE — no overwrite of existing title', () => {
    const first = ensurePlanRow('p1', { title: 'First' });
    expect(first.title).toBe('First');
    // Second call with a different title MUST NOT overwrite.
    const second = ensurePlanRow('p1', { title: 'Different' });
    expect(second.title).toBe('First');
    expect(second.id).toBe('p1');
  });

  it('taskStore.createTask with non-null planId auto-creates plans row', () => {
    expect(getPlan('auto-plan')).toBeNull();
    createTask({ id: 't1', subject: 's', planId: 'auto-plan' });
    const plan = getPlan('auto-plan');
    expect(plan).not.toBeNull();
    expect(plan?.archivedAtMs).toBeNull();
    expect(plan?.deletedAtMs).toBeNull();
  });

  it('listActivePlanCompletions filter respects plans.archived_at_ms', () => {
    // 2 plans, both with active tasks; archive one and confirm it drops out.
    createTask({ id: 't-a', subject: 'a', planId: 'plan-active' });
    createTask({ id: 't-b', subject: 'b', planId: 'plan-archived' });
    // Auto-created rows exist now; archive plan-archived directly.
    archivePlan('plan-archived');
    const ids = listActivePlanCompletions().map((c) => c.planId);
    expect(ids).toEqual(['plan-active']);
  });

  it('listActivePlanCompletions includes explicit active plans with no tasks', () => {
    createPlan({ id: 'room-empty', title: 'Room Empty Plan' });
    createTask({ id: 't-active', subject: 'a', planId: 'plan-active' });

    const completions = listActivePlanCompletions();

    expect(completions.map((c) => c.planId)).toEqual(['plan-active', 'room-empty']);
    expect(completions.find((c) => c.planId === 'room-empty')).toMatchObject({
      title: 'Room Empty Plan',
      total: 0,
      completed: 0,
      pct: 0
    });
  });

  it('listActivePlanCompletions keeps legacy implicit plans (no plans row) visible', () => {
    // Insert a task with a planId, then drop the auto-created plans row
    // to simulate a legacy task that predates the plans entity.
    createTask({ id: 't-legacy', subject: 'l', planId: 'legacy-plan' });
    _resetPlanStoreForTests();
    const ids = listActivePlanCompletions().map((c) => c.planId);
    expect(ids).toContain('legacy-plan');
  });

  it('listDeletedPlanCompletions only returns plans with deleted_at_ms set', () => {
    // Three plans: active, archived, deleted. listDeletedPlanCompletions
    // returns only the third regardless of archive state precedence.
    createPlan({ id: 'p-active', title: 'Active' });
    createPlan({ id: 'p-archived', title: 'Archived' });
    createPlan({ id: 'p-deleted', title: 'Deleted' });
    archivePlan('p-archived');
    softDeletePlan('p-deleted');
    // Plus an archived-then-deleted plan — should still appear (delete
    // precedence). archived-only must NOT appear.
    createPlan({ id: 'p-archived-deleted', title: 'Both' });
    archivePlan('p-archived-deleted');
    softDeletePlan('p-archived-deleted');
    const deletedIds = listDeletedPlanCompletions().map((c) => c.planId).sort();
    expect(deletedIds).toEqual(['p-archived-deleted', 'p-deleted']);
    const archivedIds = listArchivedPlanCompletions().map((c) => c.planId);
    expect(archivedIds).toEqual(['p-archived']);
  });

  it('ensurePlanRow on a legacy implicit plan materialises the row so lifecycle can be applied', () => {
    // Simulate the legacy state: a task referencing a plan_id, but no
    // plans row (pre-ensurePlanRow data). The /api/plans/:id PATCH route
    // uses this pattern to unblock archive/delete on legacy data.
    createTask({ id: 't-legacy', subject: 'l', planId: 'legacy-plan' });
    _resetPlanStoreForTests();
    expect(getPlan('legacy-plan')).toBeNull();
    // Operator triggers archive — route calls ensurePlanRow then archives.
    const row = ensurePlanRow('legacy-plan');
    expect(row.title).toBeNull();
    const archived = archivePlan('legacy-plan');
    expect(archived?.archivedAtMs).not.toBeNull();
    // Now appears in archived-completions feed (task count = 1).
    const archivedIds = listArchivedPlanCompletions().map((c) => c.planId);
    expect(archivedIds).toContain('legacy-plan');
  });
});
