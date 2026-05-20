import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getIdentityDb, resetIdentityDbForTests } from './db';
import { createChatRoom, resetChatRoomStoreForTests } from './chatRoomStore';
import { sweepAutoCreatedRoomPlansInDb } from './autoRoomPlanCleanup';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
});

afterEach(() => {
  resetChatRoomStoreForTests();
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
});

describe('autoRoomPlanCleanup', () => {
  it('returns zero when no candidates exist', () => {
    const db = getIdentityDb();
    const result = sweepAutoCreatedRoomPlansInDb(db);
    expect(result.softDeleted).toBe(0);
    expect(result.detached).toBe(0);
  });

  it('soft-deletes and detaches a matching auto plan', () => {
    const db = getIdentityDb();
    const room = createChatRoom({ name: 'TestRoom', whoCreatedIt: '@you' });
    const planId = `room-${room.id}`;

    db.prepare(`INSERT INTO plans (id, title, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?)`)
      .run(planId, 'TestRoom plan', 1, 1);
    db.prepare(`INSERT INTO plan_rooms (plan_id, room_id, attached_at_ms) VALUES (?, ?, ?)`)
      .run(planId, room.id, 1);

    const result = sweepAutoCreatedRoomPlansInDb(db, 999);
    expect(result.softDeleted).toBe(1);
    expect(result.detached).toBe(1);

    const plan = db.prepare(`SELECT deleted_at_ms FROM plans WHERE id = ?`).get(planId) as { deleted_at_ms: number };
    expect(plan.deleted_at_ms).toBe(999);

    const link = db.prepare(`SELECT 1 FROM plan_rooms WHERE plan_id = ?`).get(planId);
    expect(link).toBeUndefined();
  });

  it('skips plans with tasks', () => {
    const db = getIdentityDb();
    const room = createChatRoom({ name: 'TaskRoom', whoCreatedIt: '@you' });
    const planId = `room-${room.id}`;

    db.prepare(`INSERT INTO plans (id, title, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?)`)
      .run(planId, 'TaskRoom plan', 1, 1);
    db.prepare(`INSERT INTO plan_rooms (plan_id, room_id, attached_at_ms) VALUES (?, ?, ?)`)
      .run(planId, room.id, 1);
    db.prepare(`INSERT INTO tasks (id, plan_id, subject, status, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?)`)
      .run('task-1', planId, 'A task', 'pending', 1, 1);

    const result = sweepAutoCreatedRoomPlansInDb(db);
    expect(result.softDeleted).toBe(0);
    expect(result.detached).toBe(0);
  });

  it('skips plans with a description', () => {
    const db = getIdentityDb();
    const room = createChatRoom({ name: 'DescRoom', whoCreatedIt: '@you' });
    const planId = `room-${room.id}`;

    db.prepare(`INSERT INTO plans (id, title, description, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?)`)
      .run(planId, 'DescRoom plan', 'has desc', 1, 1);
    db.prepare(`INSERT INTO plan_rooms (plan_id, room_id, attached_at_ms) VALUES (?, ?, ?)`)
      .run(planId, room.id, 1);

    const result = sweepAutoCreatedRoomPlansInDb(db);
    expect(result.softDeleted).toBe(0);
    expect(result.detached).toBe(0);
  });

  it('skips plans with created_by set', () => {
    const db = getIdentityDb();
    const room = createChatRoom({ name: 'CreatorRoom', whoCreatedIt: '@you' });
    const planId = `room-${room.id}`;

    db.prepare(`INSERT INTO plans (id, title, created_by, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?)`)
      .run(planId, 'CreatorRoom plan', '@you', 1, 1);
    db.prepare(`INSERT INTO plan_rooms (plan_id, room_id, attached_at_ms) VALUES (?, ?, ?)`)
      .run(planId, room.id, 1);

    const result = sweepAutoCreatedRoomPlansInDb(db);
    expect(result.softDeleted).toBe(0);
    expect(result.detached).toBe(0);
  });

  it('matches legacy --name title pattern', () => {
    const db = getIdentityDb();
    const room = createChatRoom({ name: 'LegacyRoom', whoCreatedIt: '@you' });
    const planId = `room-${room.id}`;

    db.prepare(`INSERT INTO plans (id, title, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?)`)
      .run(planId, '--name LegacyRoom plan', 1, 1);
    db.prepare(`INSERT INTO plan_rooms (plan_id, room_id, attached_at_ms) VALUES (?, ?, ?)`)
      .run(planId, room.id, 1);

    const result = sweepAutoCreatedRoomPlansInDb(db, 777);
    expect(result.softDeleted).toBe(1);
    expect(result.detached).toBe(1);
  });

  it('skips already-deleted plans', () => {
    const db = getIdentityDb();
    const room = createChatRoom({ name: 'DeletedRoom', whoCreatedIt: '@you' });
    const planId = `room-${room.id}`;

    db.prepare(`INSERT INTO plans (id, title, deleted_at_ms, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?)`)
      .run(planId, 'DeletedRoom plan', 500, 1, 1);
    db.prepare(`INSERT INTO plan_rooms (plan_id, room_id, attached_at_ms) VALUES (?, ?, ?)`)
      .run(planId, room.id, 1);

    const result = sweepAutoCreatedRoomPlansInDb(db);
    expect(result.softDeleted).toBe(0);
    expect(result.detached).toBe(0);
  });
});
