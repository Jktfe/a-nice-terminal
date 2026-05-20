/**
 * tasksStore tests — JWPK TASKS-SUBSYSTEM (2026-05-16).
 *
 * Covers JWPK-shape CRUD, filter combinations, status enum mapping,
 * assignment, and reset-for-tests scope. Uses a per-test tmpdir DB so
 * the Lane-D taskStore tests run side-by-side without interference.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIdentityDbForTests } from './db';
import {
  createTask,
  getTask,
  listTasks,
  updateTaskStatus,
  assignTask,
  updateTask,
  resetTasksStoreForTests,
  isJwpkTaskStatus
} from './tasksStore';

let tmpDir: string;
const prevDbPath = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-tasksstore-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (prevDbPath === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = prevDbPath;
});

describe('tasksStore JWPK shape', () => {
  it('createTask defaults: status=todo, empty description, no assignees', () => {
    const t = createTask({ title: 'do thing' });
    expect(t.title).toBe('do thing');
    expect(t.description).toBe('');
    expect(t.status).toBe('todo');
    expect(t.assignedTo).toBeNull();
    expect(t.assignedTerminalId).toBeNull();
    expect(t.roomId).toBeNull();
    expect(t.parentTaskId).toBeNull();
    expect(t.completedAtMs).toBeNull();
    expect(typeof t.id).toBe('string');
    expect(t.id.length).toBeGreaterThan(0);
  });

  it('createTask accepts explicit id + every JWPK field', () => {
    const t = createTask({
      id: 'fixed-id',
      title: 'with everything',
      description: 'long form',
      status: 'in_progress',
      assignedTo: '@claude2',
      assignedTerminalId: 't_abc123',
      roomId: 'room-xyz',
      parentTaskId: 'parent-task',
      createdBy: '@james',
      orderIndex: 5
    });
    expect(t.id).toBe('fixed-id');
    expect(t.description).toBe('long form');
    expect(t.status).toBe('in_progress');
    expect(t.assignedTo).toBe('@claude2');
    expect(t.assignedTerminalId).toBe('t_abc123');
    expect(t.roomId).toBe('room-xyz');
    expect(t.parentTaskId).toBe('parent-task');
    expect(t.createdBy).toBe('@james');
    expect(t.orderIndex).toBe(5);
  });

  it('createTask can attach a JWPK task to a plan', () => {
    const t = createTask({
      id: 'task-plan',
      title: 'planned',
      planId: 'v4-fresh-ant'
    });

    expect(t.planId).toBe('v4-fresh-ant');
  });

  it('createTask rejects empty title', () => {
    expect(() => createTask({ title: '' })).toThrow();
    expect(() => createTask({ title: '   ' })).toThrow();
  });

  it('getTask returns null for missing id', () => {
    expect(getTask('does-not-exist')).toBeNull();
  });

  it('listTasks orders by order_index ASC then created_at ASC', async () => {
    const a = createTask({ title: 'a', orderIndex: 2 });
    // tiny wait so created_at_ms differs by ≥1ms across rows
    await new Promise((r) => setTimeout(r, 2));
    const b = createTask({ title: 'b', orderIndex: 1 });
    await new Promise((r) => setTimeout(r, 2));
    const c = createTask({ title: 'c', orderIndex: 1 });
    const ids = listTasks().map((t) => t.id);
    // b (order 1, earlier created), c (order 1, later created), a (order 2)
    expect(ids).toEqual([b.id, c.id, a.id]);
  });

  it('listTasks filter by assignedTerminalId returns only matching rows', () => {
    createTask({ title: 'tA', assignedTerminalId: 't_one' });
    createTask({ title: 'tB', assignedTerminalId: 't_two' });
    createTask({ title: 'tC' });
    const onlyOne = listTasks({ assignedTerminalId: 't_one' });
    expect(onlyOne.map((t) => t.title).sort()).toEqual(['tA']);
  });

  it('listTasks filter by assignedTo combines JWPK + Lane-D assigned_agent', () => {
    createTask({ title: 'jwpk', assignedTo: '@claude2' });
    createTask({ title: 'other', assignedTo: '@other' });
    const r = listTasks({ assignedTo: '@claude2' });
    expect(r.map((t) => t.title)).toEqual(['jwpk']);
  });

  it('listTasks filter by status maps JWPK enum to DB enum', () => {
    createTask({ title: 'todoTask' });
    createTask({ title: 'doneTask', status: 'done' });
    const open = listTasks({ status: 'todo' });
    expect(open.map((t) => t.title)).toEqual(['todoTask']);
    const done = listTasks({ status: 'done' });
    expect(done.map((t) => t.title)).toEqual(['doneTask']);
  });

  it('listTasks filter by roomId returns only matching rows', () => {
    createTask({ title: 'inRoomA', roomId: 'room-A' });
    createTask({ title: 'inRoomB', roomId: 'room-B' });
    createTask({ title: 'unbound' });
    expect(listTasks({ roomId: 'room-A' }).map((t) => t.title)).toEqual(['inRoomA']);
  });

  it('listTasks excludes cancelled by default, includes when includeCancelled', () => {
    createTask({ id: 'live', title: 'live' });
    createTask({ id: 'gone', title: 'gone', status: 'cancelled' });
    expect(listTasks().map((t) => t.id)).toEqual(['live']);
    const all = listTasks({ includeCancelled: true });
    expect(all.map((t) => t.id).sort()).toEqual(['gone', 'live']);
  });

  it('updateTaskStatus flips status, stamps completed_at_ms when done', () => {
    const t = createTask({ title: 'flip' });
    const before = t.completedAtMs;
    expect(before).toBeNull();
    const done = updateTaskStatus(t.id, 'done');
    expect(done?.status).toBe('done');
    expect(typeof done?.completedAtMs).toBe('number');
    // re-opening clears the stamp
    const back = updateTaskStatus(t.id, 'todo');
    expect(back?.status).toBe('todo');
    expect(back?.completedAtMs).toBeNull();
  });

  it('updateTaskStatus returns null for missing id', () => {
    expect(updateTaskStatus('nope', 'done')).toBeNull();
  });

  it('assignTask updates assignedTo and assignedTerminalId independently', () => {
    const t = createTask({ title: 'a' });
    const r1 = assignTask(t.id, { assignedTo: '@codex2' });
    expect(r1?.assignedTo).toBe('@codex2');
    expect(r1?.assignedTerminalId).toBeNull();
    const r2 = assignTask(t.id, { assignedTerminalId: 't_999' });
    expect(r2?.assignedTo).toBe('@codex2');
    expect(r2?.assignedTerminalId).toBe('t_999');
  });

  it('updateTask patches title + description + assigned_to', () => {
    const t = createTask({ title: 'old', description: 'old desc' });
    const u = updateTask(t.id, {
      title: 'new',
      description: 'new desc',
      assignedTo: '@new-assignee'
    });
    expect(u?.title).toBe('new');
    expect(u?.description).toBe('new desc');
    expect(u?.assignedTo).toBe('@new-assignee');
  });

  it('isJwpkTaskStatus accepts all 5 values', () => {
    for (const s of ['todo', 'in_progress', 'done', 'cancelled', 'blocked']) {
      expect(isJwpkTaskStatus(s)).toBe(true);
    }
    expect(isJwpkTaskStatus('pending')).toBe(false);
    expect(isJwpkTaskStatus(42)).toBe(false);
  });

  it('resetTasksStoreForTests removes every row', () => {
    createTask({ title: 'one' });
    createTask({ title: 'two' });
    expect(listTasks()).toHaveLength(2);
    resetTasksStoreForTests();
    expect(listTasks()).toHaveLength(0);
  });
});
