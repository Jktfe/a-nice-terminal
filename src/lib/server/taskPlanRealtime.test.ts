import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getIdentityDb, resetIdentityDbForTests } from './db';
import { createTask } from './taskStore';
import { attachPlanToRoom } from './planRoomLinkStore';
import { subscribeRoomEvents } from './eventBroadcast';
import {
  roomIdsForTask,
  broadcastTaskChanged,
  broadcastPlanChanged
} from './taskPlanRealtime';

let tmpDir: string;
const prevDbPath = process.env.ANT_FRESH_DB_PATH;

/** Insert a minimal chat_room row (FK target for plan_rooms). */
function seedRoom(id: string, order: number): void {
  getIdentityDb()
    .prepare(
      `INSERT INTO chat_rooms (id, name, summary, attention_state, last_update, when_it_was_created, who_created_it, creation_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, id, '', 'ready', '', '', '@test', order);
}

/** Capture every event broadcast to a room; returns {events, stop}. */
function capture(roomId: string): { events: Record<string, unknown>[]; stop: () => void } {
  const events: Record<string, unknown>[] = [];
  const stop = subscribeRoomEvents(roomId, (e) => events.push(e));
  return { events, stop };
}

const stops: Array<() => void> = [];
function watch(roomId: string): Record<string, unknown>[] {
  const { events, stop } = capture(roomId);
  stops.push(stop);
  return events;
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-taskplanrt-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
});

afterEach(() => {
  while (stops.length) stops.pop()!();
  if (prevDbPath === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = prevDbPath;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('roomIdsForTask (reverse of listTasksForRoom)', () => {
  it('resolves a plan-linked task to every room hosting the plan', () => {
    seedRoom('ROOM-1', 1);
    seedRoom('ROOM-2', 2);
    attachPlanToRoom({ planId: 'PLAN-A', roomId: 'ROOM-1' });
    attachPlanToRoom({ planId: 'PLAN-A', roomId: 'ROOM-2' });
    createTask({ id: 'T1', subject: 'wire it', planId: 'PLAN-A' });

    expect(roomIdsForTask('T1').sort()).toEqual(['ROOM-1', 'ROOM-2']);
  });

  it('resolves a standalone task (no plan) to its own room only', () => {
    seedRoom('ROOM-3', 3);
    createTask({ id: 'T-STANDALONE', subject: 'lone task' }); // plan_id NULL
    getIdentityDb().prepare(`UPDATE tasks SET room_id = ? WHERE id = ?`).run('ROOM-3', 'T-STANDALONE');

    expect(roomIdsForTask('T-STANDALONE')).toEqual(['ROOM-3']);
  });

  it('returns [] for a task whose plan is attached to no room', () => {
    createTask({ id: 'T-ORPHAN', subject: 'no room', planId: 'PLAN-Z' });
    expect(roomIdsForTask('T-ORPHAN')).toEqual([]);
  });

  it('still resolves a soft-deleted task (row survives status=deleted)', () => {
    seedRoom('ROOM-1', 1);
    attachPlanToRoom({ planId: 'PLAN-A', roomId: 'ROOM-1' });
    createTask({ id: 'T1', subject: 'doomed', planId: 'PLAN-A' });
    getIdentityDb().prepare(`UPDATE tasks SET status = 'deleted' WHERE id = ?`).run('T1');

    expect(roomIdsForTask('T1')).toEqual(['ROOM-1']);
  });
});

describe('broadcastTaskChanged', () => {
  it('fans a typed task_changed event to every hosting room', () => {
    seedRoom('ROOM-1', 1);
    seedRoom('ROOM-2', 2);
    attachPlanToRoom({ planId: 'PLAN-A', roomId: 'ROOM-1' });
    attachPlanToRoom({ planId: 'PLAN-A', roomId: 'ROOM-2' });
    createTask({ id: 'T1', subject: 'wire it', planId: 'PLAN-A' });

    const r1 = watch('ROOM-1');
    const r2 = watch('ROOM-2');

    const notified = broadcastTaskChanged('T1', { action: 'updated', planId: 'PLAN-A', status: 'completed' });

    expect(notified.sort()).toEqual(['ROOM-1', 'ROOM-2']);
    expect(r1).toHaveLength(1);
    expect(r1[0]).toMatchObject({
      type: 'task_changed',
      action: 'updated',
      taskId: 'T1',
      planId: 'PLAN-A',
      status: 'completed'
    });
    expect(typeof r1[0].seq).toBe('number'); // eventBroadcast stamps a seq
    expect(r2[0]).toMatchObject({ type: 'task_changed', taskId: 'T1' });
  });

  it('omits status when not supplied and is a no-op when no room hosts the task', () => {
    seedRoom('ROOM-1', 1);
    attachPlanToRoom({ planId: 'PLAN-A', roomId: 'ROOM-1' });
    createTask({ id: 'T1', subject: 'x', planId: 'PLAN-A' });
    createTask({ id: 'T-ORPHAN', subject: 'y', planId: 'PLAN-Z' });

    const r1 = watch('ROOM-1');
    expect(broadcastTaskChanged('T-ORPHAN', { action: 'deleted' })).toEqual([]);
    expect(r1).toHaveLength(0);

    broadcastTaskChanged('T1', { action: 'created', planId: 'PLAN-A' });
    expect(r1[0]).not.toHaveProperty('status');
  });
});

describe('broadcastPlanChanged', () => {
  it('fans plan_changed to every hosting room', () => {
    seedRoom('ROOM-1', 1);
    attachPlanToRoom({ planId: 'PLAN-A', roomId: 'ROOM-1' });
    const r1 = watch('ROOM-1');

    const notified = broadcastPlanChanged('PLAN-A', { action: 'updated' });

    expect(notified).toEqual(['ROOM-1']);
    expect(r1[0]).toMatchObject({ type: 'plan_changed', action: 'updated', planId: 'PLAN-A' });
  });

  it('includes extraRoomIds (e.g. a just-detached room) and de-dupes', () => {
    seedRoom('ROOM-1', 1);
    seedRoom('ROOM-2', 2);
    attachPlanToRoom({ planId: 'PLAN-A', roomId: 'ROOM-1' });
    const r1 = watch('ROOM-1');
    const r2 = watch('ROOM-2'); // detached: no longer in plan_rooms

    // ROOM-1 is in listRoomsForPlan AND passed as extra → must appear once.
    const notified = broadcastPlanChanged('PLAN-A', { action: 'detached' }, ['ROOM-1', 'ROOM-2']);

    expect(notified.sort()).toEqual(['ROOM-1', 'ROOM-2']);
    expect(r1).toHaveLength(1); // de-duped, not twice
    expect(r2[0]).toMatchObject({ type: 'plan_changed', action: 'detached', planId: 'PLAN-A' });
  });
});
