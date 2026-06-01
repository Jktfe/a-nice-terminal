import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIdentityDbForTests } from './db';
import { createChatRoom, resetChatRoomStoreForTests } from './chatRoomStore';
import { attachPlanToRoom, _resetPlanRoomLinksForTests } from './planRoomLinkStore';
import { appendPlanEvent, resetPlanModeStoreForTests, type PlanEvent } from './planModeStore';
import { createPlan, _resetPlanStoreForTests } from './planStore';
import { createTask, _resetTaskStoreForTests } from './taskStore';
import { buildPlanCockpit } from './planCockpitStore';

let tmpDir: string;
const prevDbPath = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-plan-cockpit-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
  resetPlanModeStoreForTests();
});

afterEach(() => {
  _resetPlanRoomLinksForTests();
  _resetTaskStoreForTests();
  _resetPlanStoreForTests();
  resetChatRoomStoreForTests();
  resetPlanModeStoreForTests();
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (prevDbPath === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = prevDbPath;
});

function event(overrides: Partial<PlanEvent> & { id: string; kind: PlanEvent['kind']; title: string }): PlanEvent {
  return {
    plan_id: 'launch-plan',
    order: 0,
    author_handle: '@evolveantcodex',
    author_kind: 'agent',
    ts_millis: 1_000,
    evidence: [],
    ...overrides
  };
}

describe('buildPlanCockpit', () => {
  it('projects plan metadata, task progress, rooms, phases, milestones, decisions, and activity', () => {
    createPlan({
      id: 'launch-plan',
      title: 'Launch cockpit',
      description: 'Restore v3-style planning visibility.',
      createdBy: '@you'
    });
    const room = createChatRoom({ name: 'discussion: server', whoCreatedIt: '@you' });
    attachPlanToRoom({ planId: 'launch-plan', roomId: room.id, attachedBy: '@you' });
    createTask({
      id: 'task-a',
      subject: 'Build cockpit endpoint',
      status: 'completed',
      priority: 1,
      planId: 'launch-plan',
      assignedAgent: '@evolveantcodex',
      evidence: [{ kind: 'file', ref: 'src/lib/server/planCockpitStore.ts', label: 'store' }]
    });
    createTask({
      id: 'task-b',
      subject: 'Wire cockpit UI',
      status: 'pending',
      priority: 2,
      planId: 'launch-plan',
      assignedAgent: '@evolveantsvelte'
    });
    appendPlanEvent(event({
      id: 'section-foundation',
      kind: 'plan_section',
      title: 'Foundation',
      body: 'Server contract first.',
      status: 'active',
      order: 1,
      ts_millis: 1_000
    }));
    appendPlanEvent(event({
      id: 'milestone-api',
      kind: 'plan_milestone',
      parent_id: 'section-foundation',
      milestone_id: 'api',
      title: 'Cockpit API',
      status: 'done',
      owner: '@evolveantcodex',
      order: 1,
      ts_millis: 1_100
    }));
    appendPlanEvent(event({
      id: 'milestone-ui',
      kind: 'plan_milestone',
      parent_id: 'section-foundation',
      milestone_id: 'ui',
      title: 'Cockpit UI',
      status: 'active',
      owner: '@evolveantsvelte',
      order: 2,
      ts_millis: 1_200
    }));
    appendPlanEvent(event({
      id: 'test-api',
      kind: 'plan_test',
      milestone_id: 'api',
      title: 'Endpoint route tests',
      status: 'passing',
      evidence: [{ kind: 'run_event', ref: 'vitest-136a' }],
      ts_millis: 1_300
    }));
    appendPlanEvent(event({
      id: 'decision-primary',
      kind: 'plan_decision',
      parent_id: 'section-foundation',
      title: 'Cockpit is primary',
      body: 'Gantt remains secondary.',
      status: 'done',
      ts_millis: 1_400
    }));

    const cockpit = buildPlanCockpit('launch-plan');

    expect(cockpit?.plan).toMatchObject({
      id: 'launch-plan',
      title: 'Launch cockpit',
      description: 'Restore v3-style planning visibility.',
      lifecycle: 'active'
    });
    expect(cockpit?.progress.tasks).toEqual({ total: 2, completed: 1, pct: 0.5 });
    expect(cockpit?.progress.milestones).toEqual({ total: 2, completed: 1, pct: 0.5 });
    expect(cockpit?.progress.phases).toEqual([
      { id: 'section-foundation', title: 'Foundation', total: 2, completed: 1, pct: 0.5 }
    ]);
    expect(cockpit?.rooms).toEqual([
      expect.objectContaining({ roomId: room.id, name: 'discussion: server', attachedBy: '@you' })
    ]);
    expect(cockpit?.phases).toHaveLength(1);
    expect(cockpit?.phases[0].milestones.map((m) => m.title)).toEqual([
      'Cockpit API',
      'Cockpit UI'
    ]);
    expect(cockpit?.phases[0].milestones[0].tests.map((t) => t.title)).toEqual([
      'Endpoint route tests'
    ]);
    expect(cockpit?.phases[0].decisions.map((d) => d.title)).toEqual(['Cockpit is primary']);
    expect(cockpit?.unphasedTasks.map((t) => t.id)).toEqual(['task-a', 'task-b']);
    expect(cockpit?.recentActivity.map((a) => a.refId)).toContain('decision-primary');
    expect(cockpit?.recentActivity.map((a) => a.refId)).toContain('task-b');
  });

  it('keeps a task-only plan useful when no plan-mode events exist', () => {
    createTask({ id: 't-hi', subject: 'High priority', planId: 'task-only', priority: 1 });
    createTask({ id: 't-lo', subject: 'Low priority', planId: 'task-only', priority: 2 });

    const cockpit = buildPlanCockpit('task-only');

    expect(cockpit?.plan.id).toBe('task-only');
    expect(cockpit?.phases).toEqual([]);
    expect(cockpit?.unphasedTasks.map((task) => task.id)).toEqual(['t-hi', 't-lo']);
    expect(cockpit?.progress.tasks).toEqual({ total: 2, completed: 0, pct: 0 });
  });


  it('includes evidence entries in recentActivity', () => {
    createPlan({ id: 'ev-plan', title: 'Evidence plan', createdBy: '@you' });
    createTask({
      id: 't-ev',
      subject: 'Task with evidence',
      planId: 'ev-plan',
      status: 'completed',
      evidence: [
        { kind: 'url', ref: 'https://example.com', label: 'Example link' },
        { kind: 'file', ref: '/tmp/log.txt' }
      ]
    });

    const cockpit = buildPlanCockpit('ev-plan');
    const activityKinds = cockpit?.recentActivity.map((a) => a.kind) ?? [];
    expect(activityKinds).toContain('evidence');
    const evActivity = cockpit?.recentActivity.filter((a) => a.kind === 'evidence') ?? [];
    expect(evActivity.length).toBe(2);
    expect(evActivity[0]).toMatchObject({
      kind: 'evidence',
      refId: 'https://example.com',
      title: 'Example link'
    });
    expect(evActivity[1]).toMatchObject({
      kind: 'evidence',
      refId: '/tmp/log.txt',
      title: '/tmp/log.txt'
    });
  });
  it('returns null for a completely unknown plan', () => {
    expect(buildPlanCockpit('missing-plan')).toBeNull();
  });
});
