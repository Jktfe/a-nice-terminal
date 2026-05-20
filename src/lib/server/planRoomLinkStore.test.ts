import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  attachPlanToRoom,
  detachPlanFromRoom,
  ensureDefaultPlanForRoom,
  listRoomsForPlan,
  listPlansForRoom,
  sweepAutoCreatedRoomPlans,
  PlanRoomLinkError,
  _resetPlanRoomLinksForTests
} from './planRoomLinkStore';
import { createChatRoom } from './chatRoomStore';
import { createTask, _resetTaskStoreForTests } from './taskStore';
import { createPlan, getPlan, _resetPlanStoreForTests } from './planStore';
import { getIdentityDb } from './db';

// Per-worker DB isolation is handled by db.ts when VITEST is set.
function resetAll() {
  _resetPlanRoomLinksForTests();
  _resetTaskStoreForTests();
  _resetPlanStoreForTests();
  getIdentityDb().prepare(`DELETE FROM chat_rooms`).run();
}

beforeEach(resetAll);
afterEach(resetAll);

describe('planRoomLinkStore', () => {
  it('attachPlanToRoom: creates a link on first call', () => {
    const room = createChatRoom({ name: 'room-A', whoCreatedIt: '@tester' });
    const result = attachPlanToRoom({ planId: 'plan-1', roomId: room.id });
    expect(result).toEqual({ attached: true, alreadyAttached: false });
    expect(listRoomsForPlan('plan-1')).toHaveLength(1);
  });

  it('attachPlanToRoom: idempotent — second call reports alreadyAttached', () => {
    const room = createChatRoom({ name: 'room-A', whoCreatedIt: '@tester' });
    attachPlanToRoom({ planId: 'plan-1', roomId: room.id, attachedBy: '@x' });
    const again = attachPlanToRoom({ planId: 'plan-1', roomId: room.id });
    expect(again).toEqual({ attached: false, alreadyAttached: true });
    // Still exactly one row, no duplicates.
    expect(listRoomsForPlan('plan-1')).toHaveLength(1);
  });

  it('attachPlanToRoom: throws room_not_found for unknown room', () => {
    expect(() =>
      attachPlanToRoom({ planId: 'plan-1', roomId: 'does-not-exist' })
    ).toThrow(PlanRoomLinkError);
    try {
      attachPlanToRoom({ planId: 'plan-1', roomId: 'does-not-exist' });
    } catch (cause) {
      expect((cause as PlanRoomLinkError).reason).toBe('room_not_found');
    }
  });

  it('detachPlanFromRoom: removes a link, returns {removed:true}', () => {
    const room = createChatRoom({ name: 'room-A', whoCreatedIt: '@tester' });
    attachPlanToRoom({ planId: 'plan-1', roomId: room.id });
    const result = detachPlanFromRoom({ planId: 'plan-1', roomId: room.id });
    expect(result).toEqual({ removed: true });
    expect(listRoomsForPlan('plan-1')).toHaveLength(0);
  });

  it('detachPlanFromRoom: idempotent — second call reports removed:false', () => {
    const room = createChatRoom({ name: 'room-A', whoCreatedIt: '@tester' });
    attachPlanToRoom({ planId: 'plan-1', roomId: room.id });
    detachPlanFromRoom({ planId: 'plan-1', roomId: room.id });
    const again = detachPlanFromRoom({ planId: 'plan-1', roomId: room.id });
    expect(again).toEqual({ removed: false });
  });

  it('listRoomsForPlan: joins room.name, orders by attached_at_ms ASC', () => {
    const a = createChatRoom({ name: 'alpha', whoCreatedIt: '@tester' });
    const b = createChatRoom({ name: 'beta', whoCreatedIt: '@tester' });
    attachPlanToRoom({ planId: 'plan-1', roomId: a.id, attachedBy: '@x' });
    attachPlanToRoom({ planId: 'plan-1', roomId: b.id });
    const rooms = listRoomsForPlan('plan-1');
    expect(rooms).toHaveLength(2);
    expect(rooms[0].name).toBe('alpha');
    expect(rooms[0].attachedBy).toBe('@x');
    expect(rooms[1].name).toBe('beta');
    expect(rooms[1].attachedBy).toBe(null);
    // attached_at_ms ordering: alpha first
    expect(rooms[0].attachedAtMs).toBeLessThanOrEqual(rooms[1].attachedAtMs);
  });

  it('listPlansForRoom: returns plans with live completion rollup', () => {
    const room = createChatRoom({ name: 'room-A', whoCreatedIt: '@tester' });
    attachPlanToRoom({ planId: 'plan-1', roomId: room.id });
    attachPlanToRoom({ planId: 'plan-2', roomId: room.id });
    // Seed plan-1 with 2 tasks, 1 completed → 50%; plan-2 with 1 pending → 0%.
    createTask({ id: 't1', subject: 's1', planId: 'plan-1', status: 'completed' });
    createTask({ id: 't2', subject: 's2', planId: 'plan-1' });
    createTask({ id: 't3', subject: 's3', planId: 'plan-2' });

    const plans = listPlansForRoom(room.id);
    expect(plans).toHaveLength(2);
    const p1 = plans.find((p) => p.planId === 'plan-1')!;
    expect(p1.completion.total).toBe(2);
    expect(p1.completion.completed).toBe(1);
    expect(p1.completion.pct).toBe(0.5);
    const p2 = plans.find((p) => p.planId === 'plan-2')!;
    expect(p2.completion.total).toBe(1);
    expect(p2.completion.completed).toBe(0);
    expect(p2.completion.pct).toBe(0);
  });

  it('ensureDefaultPlanForRoom: seeds one persistent room plan when none exists', () => {
    const room = createChatRoom({ name: 'discussion: server', whoCreatedIt: '@tester' });
    const seeded = ensureDefaultPlanForRoom({
      roomId: room.id,
      roomName: room.name,
      createdBy: '@tester'
    });

    expect(seeded.planId).toBe(`room-${room.id}`);
    expect(seeded.attachedBy).toBe('@tester');
    expect(seeded.completion.title).toBe('discussion: server plan');
    expect(listPlansForRoom(room.id).map((p) => p.planId)).toEqual([`room-${room.id}`]);

    const again = ensureDefaultPlanForRoom({
      roomId: room.id,
      roomName: room.name,
      createdBy: '@tester'
    });
    expect(again.planId).toBe(seeded.planId);
    expect(listPlansForRoom(room.id)).toHaveLength(1);
  });

  it('M:N: a plan can attach to multiple rooms; a room can host multiple plans', () => {
    const a = createChatRoom({ name: 'alpha', whoCreatedIt: '@tester' });
    const b = createChatRoom({ name: 'beta', whoCreatedIt: '@tester' });
    attachPlanToRoom({ planId: 'plan-1', roomId: a.id });
    attachPlanToRoom({ planId: 'plan-1', roomId: b.id });
    attachPlanToRoom({ planId: 'plan-2', roomId: a.id });
    // plan-1 in two rooms
    expect(listRoomsForPlan('plan-1').map((r) => r.name).sort()).toEqual(['alpha', 'beta']);
    // room-alpha hosts two plans
    expect(listPlansForRoom(a.id).map((p) => p.planId).sort()).toEqual(['plan-1', 'plan-2']);
    // room-beta hosts only plan-1
    expect(listPlansForRoom(b.id).map((p) => p.planId)).toEqual(['plan-1']);
  });

  it('FK cascade: deleting a chat_room evaporates its plan_rooms rows', () => {
    const a = createChatRoom({ name: 'alpha', whoCreatedIt: '@tester' });
    const b = createChatRoom({ name: 'beta', whoCreatedIt: '@tester' });
    attachPlanToRoom({ planId: 'plan-1', roomId: a.id });
    attachPlanToRoom({ planId: 'plan-1', roomId: b.id });
    expect(listRoomsForPlan('plan-1')).toHaveLength(2);
    // Hard-delete room-a directly via SQL (the app uses soft-delete elsewhere
    // but this test validates the schema-level cascade for safety).
    getIdentityDb().prepare(`DELETE FROM chat_rooms WHERE id = ?`).run(a.id);
    expect(listRoomsForPlan('plan-1').map((r) => r.name)).toEqual(['beta']);
  });

  it('sweepAutoCreatedRoomPlans soft-deletes generated empty room plans and detaches links only', () => {
    const generated = createChatRoom({ name: 'discussion: ui', whoCreatedIt: '@tester' });
    const realWithTask = createChatRoom({ name: 'kept task room', whoCreatedIt: '@tester' });
    const customEmpty = createChatRoom({ name: 'custom empty room', whoCreatedIt: '@tester' });

    ensureDefaultPlanForRoom({
      roomId: generated.id,
      roomName: generated.name,
      createdBy: '@tester'
    });
    ensureDefaultPlanForRoom({
      roomId: realWithTask.id,
      roomName: realWithTask.name,
      createdBy: '@tester'
    });
    createTask({
      id: 'kept-task',
      subject: 'real work',
      planId: `room-${realWithTask.id}`
    });
    createPlan({ id: `room-${customEmpty.id}`, title: 'Custom operator plan', createdBy: '@tester' });
    attachPlanToRoom({
      planId: `room-${customEmpty.id}`,
      roomId: customEmpty.id,
      attachedBy: '@tester'
    });

    const result = sweepAutoCreatedRoomPlans();

    expect(result).toEqual({ softDeleted: 1, detached: 1 });
    expect(getPlan(`room-${generated.id}`)?.deletedAtMs).not.toBeNull();
    expect(listPlansForRoom(generated.id)).toEqual([]);

    expect(getPlan(`room-${realWithTask.id}`)?.deletedAtMs).toBeNull();
    expect(listPlansForRoom(realWithTask.id).map((p) => p.planId)).toEqual([
      `room-${realWithTask.id}`
    ]);
    expect(getPlan(`room-${customEmpty.id}`)?.deletedAtMs).toBeNull();
    expect(listPlansForRoom(customEmpty.id).map((p) => p.planId)).toEqual([
      `room-${customEmpty.id}`
    ]);
  });
});
