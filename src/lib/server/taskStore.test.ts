import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getIdentityDb, resetIdentityDbForTests } from './db';
import {
  createTask, getTask, listTasks, listTasksForPlan, listTasksForRoom, updateTask, deleteTask,
  addDependency, removeDependency, planCompletion, listPlanCompletions,
  TaskDependencyError, isTaskStatus
} from './taskStore';
import {
  appendPlanEvent, resetPlanModeStoreForTests, type PlanEvent
} from './planModeStore';

function seedSection(planId: string, title: string, order = 0): void {
  const ev: PlanEvent = {
    id: `${planId}-sec-${order}`,
    plan_id: planId,
    kind: 'plan_section',
    title,
    order,
    author_handle: '@test',
    author_kind: 'system',
    ts_millis: Date.now(),
    evidence: []
  };
  appendPlanEvent(ev);
}

let tmpDir: string;
const prevDbPath = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-taskstore-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
});

beforeEach(() => resetPlanModeStoreForTests());

afterEach(() => {
  resetPlanModeStoreForTests();
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (prevDbPath === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = prevDbPath;
});

describe('taskStore CRUD', () => {
  it('creates and reads a task with defaults', () => {
    const t = createTask({ id: 't1', subject: 'do thing' });
    expect(t.status).toBe('pending');
    expect(t.planId).toBeNull();
    expect(t.blocks).toEqual([]);
    expect(t.blockedBy).toEqual([]);
    expect(t.evidence).toEqual([]);
    expect(getTask('t1')?.subject).toBe('do thing');
  });

  it('JWPK Q1: a task is first-class — exists standalone with null plan_id', () => {
    const t = createTask({ id: 't-standalone', subject: 'no plan' });
    expect(t.planId).toBeNull();
    expect(listTasks().map((x) => x.id)).toContain('t-standalone');
  });

  it('updates partial fields and bumps updated_at', () => {
    createTask({ id: 't2', subject: 's', priority: 3 });
    const before = getTask('t2')!.updatedAtMs;
    const u = updateTask('t2', { status: 'in_progress', priority: 1 });
    expect(u?.status).toBe('in_progress');
    expect(u?.priority).toBe(1);
    expect(u!.updatedAtMs).toBeGreaterThanOrEqual(before);
  });

  it('soft-deletes (status=deleted), excluded from default list', () => {
    createTask({ id: 't3', subject: 's' });
    expect(deleteTask('t3')).toBe(true);
    expect(getTask('t3')?.status).toBe('deleted');
    expect(listTasks().find((x) => x.id === 't3')).toBeUndefined();
    expect(listTasks({ includeDeleted: true }).find((x) => x.id === 't3')).toBeDefined();
  });

  it('updateTask returns null for unknown id', () => {
    expect(updateTask('nope', { subject: 'x' })).toBeNull();
  });
});

describe('listTasksForPlan ordering', () => {
  it('orders by priority asc with nulls last, then created order', () => {
    createTask({ id: 'a', subject: 'a', planId: 'P', priority: 2 });
    createTask({ id: 'b', subject: 'b', planId: 'P', priority: null });
    createTask({ id: 'c', subject: 'c', planId: 'P', priority: 1 });
    createTask({ id: 'd', subject: 'd', planId: 'OTHER', priority: 1 });
    expect(listTasksForPlan('P').map((t) => t.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('dependency mirror', () => {
  it('addDependency mirrors blocked_by/blocks in one txn', () => {
    createTask({ id: 'x', subject: 'x' });
    createTask({ id: 'y', subject: 'y' });
    addDependency('x', 'y'); // x blocked_by y
    expect(getTask('x')?.blockedBy).toEqual(['y']);
    expect(getTask('y')?.blocks).toEqual(['x']);
  });

  it('addDependency is idempotent (no duplicate edges)', () => {
    createTask({ id: 'x', subject: 'x' });
    createTask({ id: 'y', subject: 'y' });
    addDependency('x', 'y');
    addDependency('x', 'y');
    expect(getTask('x')?.blockedBy).toEqual(['y']);
    expect(getTask('y')?.blocks).toEqual(['x']);
  });

  it('rejects self-edge', () => {
    createTask({ id: 'x', subject: 'x' });
    expect(() => addDependency('x', 'x')).toThrow(TaskDependencyError);
  });

  it('rejects edge to missing/deleted task', () => {
    createTask({ id: 'x', subject: 'x' });
    expect(() => addDependency('x', 'ghost')).toThrow(/not found/);
    createTask({ id: 'z', subject: 'z' });
    deleteTask('z');
    expect(() => addDependency('x', 'z')).toThrow(/not found/);
  });

  it('removeDependency clears both sides', () => {
    createTask({ id: 'x', subject: 'x' });
    createTask({ id: 'y', subject: 'y' });
    addDependency('x', 'y');
    removeDependency('x', 'y');
    expect(getTask('x')?.blockedBy).toEqual([]);
    expect(getTask('y')?.blocks).toEqual([]);
  });
});

describe('plan completion (donut metric)', () => {
  it('pct = completed / total over non-deleted plan tasks', () => {
    createTask({ id: '1', subject: '1', planId: 'P', status: 'completed' });
    createTask({ id: '2', subject: '2', planId: 'P', status: 'completed' });
    createTask({ id: '3', subject: '3', planId: 'P', status: 'pending' });
    createTask({ id: '4', subject: '4', planId: 'P', status: 'deleted' });
    const c = planCompletion('P');
    expect(c.total).toBe(3);
    expect(c.completed).toBe(2);
    expect(c.pct).toBeCloseTo(2 / 3);
  });

  it('pct = 0 and title null for a plan with no tasks/section', () => {
    expect(planCompletion('empty')).toEqual({
      planId: 'empty', title: null, total: 0, completed: 0, pct: 0
    });
  });

  it('listPlanCompletions excludes standalone (null plan_id) tasks', () => {
    createTask({ id: 's', subject: 's' }); // standalone, no plan
    createTask({ id: 'p1', subject: 'p1', planId: 'PLAN-A', status: 'completed' });
    const plans = listPlanCompletions();
    expect(plans.map((p) => p.planId)).toEqual(['PLAN-A']);
  });
});

describe('S1.2 plan title enrichment (read-only)', () => {
  it('resolves title from the plan_section root event', () => {
    createTask({ id: 'pt1', subject: 't', planId: 'PLAN-T' });
    seedSection('PLAN-T', 'Human Plan Title');
    expect(planCompletion('PLAN-T').title).toBe('Human Plan Title');
  });

  it('title is null when the plan has no section event (FE falls back to planId)', () => {
    createTask({ id: 'pt2', subject: 't', planId: 'PLAN-NO-SEC' });
    expect(planCompletion('PLAN-NO-SEC').title).toBeNull();
  });

  it('picks the lowest-order section as the root title', () => {
    createTask({ id: 'pt3', subject: 't', planId: 'PLAN-M' });
    seedSection('PLAN-M', 'Second', 2);
    seedSection('PLAN-M', 'Root', 0);
    expect(planCompletion('PLAN-M').title).toBe('Root');
  });

  it('listPlanCompletions carries the resolved title', () => {
    createTask({ id: 'pt4', subject: 't', planId: 'PLAN-L', status: 'completed' });
    seedSection('PLAN-L', 'Listed Plan');
    expect(listPlanCompletions()).toEqual([
      { planId: 'PLAN-L', title: 'Listed Plan', total: 1, completed: 1, pct: 1 }
    ]);
  });
});

describe('isTaskStatus guard', () => {
  it('accepts valid, rejects invalid', () => {
    expect(isTaskStatus('in_progress')).toBe(true);
    expect(isTaskStatus('nope')).toBe(false);
    expect(isTaskStatus(42)).toBe(false);
  });
});

describe('listTasksForRoom', () => {
  it('returns standalone tasks when no plans are attached', () => {
    createTask({ id: 'sa1', subject: 'Standalone one', planId: null });
    createTask({ id: 'sa2', subject: 'Standalone two', planId: null });
    getIdentityDb().prepare(`UPDATE tasks SET room_id = ? WHERE id IN (?, ?)`).run('ROOM-NO-PLANS', 'sa1', 'sa2');
    createTask({ id: 'sa-other', subject: 'Other room standalone', planId: null });
    getIdentityDb().prepare(`UPDATE tasks SET room_id = ? WHERE id = ?`).run('OTHER-ROOM', 'sa-other');
    createTask({ id: 'pl1', subject: 'Plan task', planId: 'PLAN-X' });
    const tasks = listTasksForRoom('ROOM-NO-PLANS');
    expect(tasks.map((t) => t.id)).toEqual(['sa1', 'sa2']);
    expect(tasks.every((t) => t.planId == null)).toBe(true);
  });

  it('returns plan-linked tasks for plans attached to the room', () => {
    const db = getIdentityDb();
    const now = Date.now();
    db.prepare(`INSERT INTO chat_rooms (id, name, summary, attention_state, last_update, when_it_was_created, who_created_it, creation_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run('ROOM-1', 'Test', '', 'ready', '', '', '@test', 1);
    db.prepare(`INSERT INTO plan_rooms (plan_id, room_id, attached_at_ms, attached_by) VALUES (?, ?, ?, ?)`).run('PLAN-A', 'ROOM-1', now, '@test');
    createTask({ id: 't1', subject: 'Plan A task', planId: 'PLAN-A' });
    createTask({ id: 't2', subject: 'Standalone', planId: null });
    db.prepare(`UPDATE tasks SET room_id = ? WHERE id = ?`).run('ROOM-1', 't2');
    createTask({ id: 't3', subject: 'Other standalone', planId: null });
    db.prepare(`UPDATE tasks SET room_id = ? WHERE id = ?`).run('ROOM-2', 't3');
    const tasks = listTasksForRoom('ROOM-1');
    expect(tasks.map((t) => t.id).sort()).toEqual(['t1', 't2']);
  });

  it('excludes deleted tasks', () => {
    createTask({ id: 'td1', subject: 'Deleted', planId: null });
    getIdentityDb().prepare(`UPDATE tasks SET room_id = ? WHERE id = ?`).run('ROOM-DEL', 'td1');
    deleteTask('td1');
    const tasks = listTasksForRoom('ROOM-DEL');
    expect(tasks).toHaveLength(0);
  });

  it('includes planTitle when plan row exists', () => {
    const db = getIdentityDb();
    const now = Date.now();
    db.prepare(`INSERT INTO chat_rooms (id, name, summary, attention_state, last_update, when_it_was_created, who_created_it, creation_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run('ROOM-T', 'Test', '', 'ready', '', '', '@test', 2);
    db.prepare(`INSERT INTO plans (id, title, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?)`).run('PLAN-T', 'My Plan', now, now);
    db.prepare(`INSERT INTO plan_rooms (plan_id, room_id, attached_at_ms, attached_by) VALUES (?, ?, ?, ?)`).run('PLAN-T', 'ROOM-T', now, '@test');
    createTask({ id: 'tp1', subject: 'Task with plan', planId: 'PLAN-T' });
    const tasks = listTasksForRoom('ROOM-T');
    expect(tasks).toHaveLength(1);
    expect(tasks[0].planTitle).toBe('My Plan');
  });
});
