import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIdentityDbForTests } from './db';
import {
  createDiscussion,
  closeOrReCloseDiscussion,
  getDiscussion,
  getDiscussionByParent,
  listDiscussionsForRoom
} from './chatDiscussionStore';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-discussions-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
});

describe('createDiscussion + read roundtrip', () => {
  it('seeds an open discussion with opened_by/opened_at populated', () => {
    const row = createDiscussion({ roomId: 'r1', parentMessageId: 'msg_p', opened_by: '@a' });
    expect(row.room_id).toBe('r1');
    expect(row.parent_message_id).toBe('msg_p');
    expect(row.status).toBe('open');
    expect(row.opened_by).toBe('@a');
    expect(typeof row.opened_at).toBe('number');
    expect(row.summary).toBeNull();
    expect(row.closed_at).toBeNull();
  });

  it('title defaults to null when not provided', () => {
    const row = createDiscussion({ roomId: 'r1', parentMessageId: 'msg_p', opened_by: '@a' });
    expect(row.title).toBeNull();
  });

  it('UNIQUE(room_id, parent_message_id) prevents double-seeding the same message', () => {
    createDiscussion({ roomId: 'r1', parentMessageId: 'msg_dup', opened_by: '@a' });
    expect(() => createDiscussion({ roomId: 'r1', parentMessageId: 'msg_dup', opened_by: '@b' })).toThrow();
  });

  it('same parent_message_id in a different room is fine (room-scoped uniqueness)', () => {
    createDiscussion({ roomId: 'rA', parentMessageId: 'msg_p', opened_by: '@a' });
    expect(() => createDiscussion({ roomId: 'rB', parentMessageId: 'msg_p', opened_by: '@a' })).not.toThrow();
  });

  it('getDiscussionByParent finds the seeded discussion', () => {
    const created = createDiscussion({ roomId: 'r1', parentMessageId: 'msg_p', opened_by: '@a' });
    const found = getDiscussionByParent('r1', 'msg_p');
    expect(found?.id).toBe(created.id);
  });
});

describe('closeOrReCloseDiscussion (Q4-4b mutable re-close)', () => {
  it('first close transitions open→closed and stamps closed_by/closed_at/summary', () => {
    const seed = createDiscussion({ roomId: 'r1', parentMessageId: 'msg_p', opened_by: '@a' });
    const closed = closeOrReCloseDiscussion({ discussionId: seed.id, summary: 'wrap', closed_by: '@a' });
    expect(closed.status).toBe('closed');
    expect(closed.summary).toBe('wrap');
    expect(closed.closed_by).toBe('@a');
    expect(typeof closed.closed_at).toBe('number');
  });

  it('re-close updates summary in place (no history table per Q4-4b)', async () => {
    const seed = createDiscussion({ roomId: 'r1', parentMessageId: 'msg_p', opened_by: '@a' });
    closeOrReCloseDiscussion({ discussionId: seed.id, summary: 'first', closed_by: '@a' });
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const reClosed = closeOrReCloseDiscussion({ discussionId: seed.id, summary: 'better', closed_by: '@b' });
    expect(reClosed.summary).toBe('better');
    expect(reClosed.closed_by).toBe('@b');
  });
});

describe('listDiscussionsForRoom (status filter)', () => {
  it('default returns open discussions only', () => {
    const a = createDiscussion({ roomId: 'r1', parentMessageId: 'msg_a', opened_by: '@a' });
    const b = createDiscussion({ roomId: 'r1', parentMessageId: 'msg_b', opened_by: '@a' });
    closeOrReCloseDiscussion({ discussionId: b.id, summary: 'b done', closed_by: '@a' });
    const open = listDiscussionsForRoom('r1');
    expect(open.map((row) => row.id)).toEqual([a.id]);
  });

  it("status='closed' returns closed only", () => {
    const a = createDiscussion({ roomId: 'r1', parentMessageId: 'msg_a', opened_by: '@a' });
    closeOrReCloseDiscussion({ discussionId: a.id, summary: 'done', closed_by: '@a' });
    expect(listDiscussionsForRoom('r1', 'closed').length).toBe(1);
  });

  it("status='all' returns open + closed", () => {
    createDiscussion({ roomId: 'r1', parentMessageId: 'msg_a', opened_by: '@a' });
    const b = createDiscussion({ roomId: 'r1', parentMessageId: 'msg_b', opened_by: '@a' });
    closeOrReCloseDiscussion({ discussionId: b.id, summary: 'b done', closed_by: '@a' });
    expect(listDiscussionsForRoom('r1', 'all').length).toBe(2);
  });

  it('rooms are isolated', () => {
    createDiscussion({ roomId: 'rA', parentMessageId: 'msg_a', opened_by: '@a' });
    createDiscussion({ roomId: 'rB', parentMessageId: 'msg_b', opened_by: '@a' });
    expect(listDiscussionsForRoom('rA').length).toBe(1);
    expect(listDiscussionsForRoom('rB').length).toBe(1);
  });
});
