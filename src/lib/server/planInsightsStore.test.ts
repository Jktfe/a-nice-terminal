import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { computeInsights } from './planInsightsStore';
import {
  createPlan,
  archivePlan,
  softDeletePlan,
  _resetPlanStoreForTests
} from './planStore';
import {
  createTask,
  addDependency,
  _resetTaskStoreForTests
} from './taskStore';
import {
  attachPlanToRoom,
  _resetPlanRoomLinksForTests
} from './planRoomLinkStore';
import { createChatRoom, resetChatRoomStoreForTests } from './chatRoomStore';

function resetAll() {
  _resetPlanRoomLinksForTests();
  _resetTaskStoreForTests();
  _resetPlanStoreForTests();
  resetChatRoomStoreForTests();
}

beforeEach(resetAll);
afterEach(resetAll);

describe('planInsightsStore.computeInsights', () => {
  it('returns all-zeros + duration:null over an empty DB', () => {
    const insights = computeInsights();
    expect(insights.plans.total).toBe(0);
    expect(insights.plans.active).toBe(0);
    expect(insights.plans.archived).toBe(0);
    expect(insights.plans.deletedSoft).toBe(0);
    expect(insights.plans.avgCompletionPctActive).toBe(0);
    expect(insights.tasks.total).toBe(0);
    expect(insights.tasks.byStatus).toEqual({
      pending: 0,
      in_progress: 0,
      blocked: 0,
      completed: 0
    });
    expect(insights.tasks.byPriority).toEqual({ '1': 0, '2': 0, '3': 0, none: 0 });
    expect(insights.tasks.withTimestamps).toBe(0);
    expect(insights.tasks.standalone).toBe(0);
    expect(insights.duration).toBeNull();
    expect(insights.topPlans.byCompletedCount).toEqual([]);
    expect(insights.topPlans.byTotalCount).toEqual([]);
    expect(insights.topRooms).toEqual([]);
    expect(insights.topAgents).toEqual([]);
    expect(insights.mostBlockedTasks).toEqual([]);
    expect(insights.dependencies).toEqual({ taskCount: 0, edgeCount: 0 });
    expect(typeof insights.generatedAtMs).toBe('number');
  });

  it('counts task statuses across a seeded plan', () => {
    createTask({ id: 't-1', subject: 'a', planId: 'p1', status: 'completed' });
    createTask({ id: 't-2', subject: 'b', planId: 'p1', status: 'in_progress' });
    createTask({ id: 't-3', subject: 'c', planId: 'p1', status: 'pending' });
    const insights = computeInsights();
    expect(insights.tasks.total).toBe(3);
    expect(insights.tasks.byStatus).toEqual({
      pending: 1,
      in_progress: 1,
      blocked: 0,
      completed: 1
    });
  });

  it('avgCompletionPctActive averages across 2 active plans at different ratios', () => {
    // Plan A: 2 of 4 completed = 0.5
    createTask({ id: 'a-1', subject: 'a1', planId: 'plan-a', status: 'completed' });
    createTask({ id: 'a-2', subject: 'a2', planId: 'plan-a', status: 'completed' });
    createTask({ id: 'a-3', subject: 'a3', planId: 'plan-a', status: 'pending' });
    createTask({ id: 'a-4', subject: 'a4', planId: 'plan-a', status: 'pending' });
    // Plan B: 1 of 4 completed = 0.25
    createTask({ id: 'b-1', subject: 'b1', planId: 'plan-b', status: 'completed' });
    createTask({ id: 'b-2', subject: 'b2', planId: 'plan-b', status: 'pending' });
    createTask({ id: 'b-3', subject: 'b3', planId: 'plan-b', status: 'pending' });
    createTask({ id: 'b-4', subject: 'b4', planId: 'plan-b', status: 'pending' });
    const insights = computeInsights();
    // (0.5 + 0.25) / 2 = 0.375
    expect(insights.plans.avgCompletionPctActive).toBeCloseTo(0.375, 5);
    expect(insights.plans.active).toBe(2);
  });

  it('topPlans.byCompletedCount sorts descending, ties broken by total desc', () => {
    // alpha: 3 completed, 4 total
    createTask({ id: 'al-1', subject: 'x', planId: 'alpha', status: 'completed' });
    createTask({ id: 'al-2', subject: 'x', planId: 'alpha', status: 'completed' });
    createTask({ id: 'al-3', subject: 'x', planId: 'alpha', status: 'completed' });
    createTask({ id: 'al-4', subject: 'x', planId: 'alpha', status: 'pending' });
    // beta: 3 completed, 3 total — same completed, smaller total
    createTask({ id: 'be-1', subject: 'x', planId: 'beta', status: 'completed' });
    createTask({ id: 'be-2', subject: 'x', planId: 'beta', status: 'completed' });
    createTask({ id: 'be-3', subject: 'x', planId: 'beta', status: 'completed' });
    // gamma: 1 completed, 5 total
    createTask({ id: 'ga-1', subject: 'x', planId: 'gamma', status: 'completed' });
    createTask({ id: 'ga-2', subject: 'x', planId: 'gamma', status: 'pending' });
    createTask({ id: 'ga-3', subject: 'x', planId: 'gamma', status: 'pending' });
    createTask({ id: 'ga-4', subject: 'x', planId: 'gamma', status: 'pending' });
    createTask({ id: 'ga-5', subject: 'x', planId: 'gamma', status: 'pending' });
    const insights = computeInsights();
    const ids = insights.topPlans.byCompletedCount.map((p) => p.planId);
    // alpha + beta both have 3 completed — tie-break by total desc → alpha (4) > beta (3)
    expect(ids[0]).toBe('alpha');
    expect(ids[1]).toBe('beta');
    expect(ids[2]).toBe('gamma');
  });

  it('topRooms ranks by attached-plan count', () => {
    const r1 = createChatRoom({ name: 'hot-room', whoCreatedIt: '@tester' });
    const r2 = createChatRoom({ name: 'cool-room', whoCreatedIt: '@tester' });
    // hot-room: 2 plans; cool-room: 1 plan
    attachPlanToRoom({ planId: 'p-a', roomId: r1.id });
    attachPlanToRoom({ planId: 'p-b', roomId: r1.id });
    attachPlanToRoom({ planId: 'p-c', roomId: r2.id });
    const insights = computeInsights();
    expect(insights.topRooms[0].roomId).toBe(r1.id);
    expect(insights.topRooms[0].planCount).toBe(2);
    expect(insights.topRooms[1].roomId).toBe(r2.id);
    expect(insights.topRooms[1].planCount).toBe(1);
  });

  it('computes duration stats correctly across timestamped tasks', () => {
    // Three tasks with explicit durations of 10s, 20s, 30s.
    const base = 1_000_000;
    createTask({
      id: 'd-1',
      subject: 'x',
      status: 'completed',
      startedAtMs: base,
      endedAtMs: base + 10_000
    });
    createTask({
      id: 'd-2',
      subject: 'x',
      status: 'completed',
      startedAtMs: base,
      endedAtMs: base + 20_000
    });
    createTask({
      id: 'd-3',
      subject: 'x',
      status: 'completed',
      startedAtMs: base,
      endedAtMs: base + 30_000
    });
    const insights = computeInsights();
    expect(insights.duration).not.toBeNull();
    expect(insights.duration!.measuredCount).toBe(3);
    expect(insights.duration!.totalMs).toBe(60_000);
    expect(insights.duration!.avgMs).toBe(20_000);
    expect(insights.duration!.medianMs).toBe(20_000);
    expect(insights.duration!.minMs).toBe(10_000);
    expect(insights.duration!.maxMs).toBe(30_000);
    expect(insights.tasks.withTimestamps).toBe(3);
  });

  it('mostBlockedTasks sorts by blockedBy length descending', () => {
    createTask({ id: 'blocker-1', subject: 'B1', planId: 'p1' });
    createTask({ id: 'blocker-2', subject: 'B2', planId: 'p1' });
    createTask({ id: 'blocker-3', subject: 'B3', planId: 'p1' });
    createTask({ id: 'victim-2', subject: 'V2', planId: 'p1' });
    createTask({ id: 'victim-3', subject: 'V3', planId: 'p1' });
    addDependency('victim-2', 'blocker-1');
    addDependency('victim-2', 'blocker-2');
    addDependency('victim-3', 'blocker-1');
    addDependency('victim-3', 'blocker-2');
    addDependency('victim-3', 'blocker-3');
    const insights = computeInsights();
    // victim-3 has 3 blockers, victim-2 has 2.
    expect(insights.mostBlockedTasks[0].taskId).toBe('victim-3');
    expect(insights.mostBlockedTasks[0].blockedByCount).toBe(3);
    expect(insights.mostBlockedTasks[1].taskId).toBe('victim-2');
    expect(insights.mostBlockedTasks[1].blockedByCount).toBe(2);
    // edges = 2 + 3 = 5 (directed, single side)
    expect(insights.dependencies.edgeCount).toBe(5);
  });

  it('excludes archived + soft-deleted plans from plans.active', () => {
    // Three explicit plans, one each in active/archived/deleted state.
    createPlan({ id: 'p-active' });
    createPlan({ id: 'p-arch' });
    createPlan({ id: 'p-del' });
    archivePlan('p-arch');
    softDeletePlan('p-del');
    // Plus an implicit (legacy) plan via a task.
    createTask({ id: 't-imp', subject: 'imp', planId: 'p-implicit' });
    // The auto-created plans row for p-implicit will exist now; remove
    // explicit rows to simulate the legacy case — but planStore reset
    // would wipe ALL rows so instead we accept its presence as active.
    const insights = computeInsights();
    // Explicit active: p-active + p-implicit (auto-created) = 2 active.
    expect(insights.plans.active).toBe(2);
    expect(insights.plans.archived).toBe(1);
    expect(insights.plans.deletedSoft).toBe(1);
    // total = 4 explicit rows (deletedSoft still counts in total).
    expect(insights.plans.total).toBe(4);
  });
});
