import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIdentityDbForTests } from './db';
import { listFocusEvents, getCurrentFocus } from './stageStore';
import { appendPlanEvent } from './planModeStore';
import { createTask, _resetTaskStoreForTests } from './taskStore';

let tmpDir: string;
const prevDbPath = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-stagestore-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
  _resetTaskStoreForTests();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  if (prevDbPath === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = prevDbPath;
});

describe('stageStore', () => {
  it('empty store → no focus events', () => {
    expect(listFocusEvents('stage-1')).toEqual([]);
    expect(getCurrentFocus('stage-1')).toBeNull();
  });

  it('picks up plan_event with stage_focus evidence', () => {
    appendPlanEvent({
      id: 'evt-1',
      plan_id: 'plan-A',
      kind: 'plan_decision',
      title: 'focus slide 3',
      order: 0,
      author_handle: '@tester',
      author_kind: 'agent',
      ts_millis: 100,
      evidence: [
        { kind: 'stage_focus', ref: 'stage:demo:slide-3', label: 'slide 3' }
      ]
    });
    const events = listFocusEvents('demo');
    expect(events).toHaveLength(1);
    expect(events[0]?.label).toBe('slide 3');
    expect(events[0]?.source).toBe('plan_event');
    expect(events[0]?.tsMs).toBe(100);
    expect(getCurrentFocus('demo')?.ref).toBe('stage:demo:slide-3');
  });

  it('orders mixed plan + task events chronologically; getCurrentFocus returns latest', () => {
    appendPlanEvent({
      id: 'evt-old',
      plan_id: 'plan-A',
      kind: 'plan_decision',
      title: 'older focus',
      order: 0,
      author_handle: '@tester',
      author_kind: 'agent',
      ts_millis: 100,
      evidence: [{ kind: 'stage_focus', ref: 'stage:demo:slide-1', label: 'slide 1' }]
    });

    createTask({
      id: 'task-newer',
      subject: 'task with newer focus',
      planId: 'plan-A',
      evidence: [{ kind: 'stage_focus', ref: 'stage:demo:slide-2', label: 'slide 2' }]
    });

    const events = listFocusEvents('demo');
    expect(events).toHaveLength(2);
    expect(events[0]?.ref).toBe('stage:demo:slide-1');
    expect(events[1]?.ref).toBe('stage:demo:slide-2');
    expect(getCurrentFocus('demo')?.ref).toBe('stage:demo:slide-2');
  });

  it('filters by stageId — unrelated stages are excluded', () => {
    appendPlanEvent({
      id: 'evt-1',
      plan_id: 'plan-A',
      kind: 'plan_decision',
      title: 'other stage focus',
      order: 0,
      author_handle: '@tester',
      author_kind: 'agent',
      ts_millis: 100,
      evidence: [{ kind: 'stage_focus', ref: 'stage:other:slide-7', label: 'other slide 7' }]
    });
    expect(listFocusEvents('demo')).toEqual([]);
    expect(getCurrentFocus('demo')).toBeNull();
    expect(listFocusEvents('other')).toHaveLength(1);
  });

  it('ignores non-stage_focus evidence kinds', () => {
    appendPlanEvent({
      id: 'evt-1',
      plan_id: 'plan-A',
      kind: 'plan_decision',
      title: 'unrelated evidence',
      order: 0,
      author_handle: '@tester',
      author_kind: 'agent',
      ts_millis: 100,
      evidence: [
        { kind: 'proposal', ref: 'stage:demo:slide-5', label: 'wrong kind' },
        { kind: 'url', ref: 'http://example.com' }
      ]
    });
    expect(listFocusEvents('demo')).toEqual([]);
  });
});
