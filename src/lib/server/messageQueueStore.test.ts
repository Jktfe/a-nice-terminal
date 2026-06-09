import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getIdentityDb, resetIdentityDbForTests } from './db';
import {
  coalesce,
  countPending,
  enqueue,
  getItem,
  listQueue,
  markDone,
  markDropped,
  pullNext,
  reorder,
  resetMessageQueueForTests,
  updateItem
} from './messageQueueStore';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;

const ROOM = 'room_abc';
const HANDLE = '@localchair';

// NOTE (store bug — see report): messageQueueStore.ensureSchema() memoises a
// module-level `schemaReady` flag that is NOT cleared when the identity DB is
// swapped. The standard per-test `resetIdentityDbForTests()` (which closes the
// old connection and opens a fresh `:memory:` DB) therefore leaves the new DB
// without the `room_message_queue` table, and the next call throws
// "no such table". To exercise the store on an in-memory DB we open the
// connection ONCE (so the schema is created once and stays valid) and clear
// only the queue rows between tests via resetMessageQueueForTests().
beforeAll(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  resetIdentityDbForTests();
  getIdentityDb(); // open the single in-memory connection up front
});

beforeEach(() => {
  resetMessageQueueForTests();
});

afterAll(() => {
  resetMessageQueueForTests();
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
});

describe('messageQueueStore — enqueue', () => {
  it('applies defaults: pending status, mention kind, empty source ids, priority=createdAt', () => {
    const item = enqueue({ roomId: ROOM, targetHandle: HANDLE, text: 'hello' }, 1000);
    expect(item.id).toMatch(/^q_/);
    expect(item.roomId).toBe(ROOM);
    expect(item.targetHandle).toBe(HANDLE);
    expect(item.curatedText).toBe('hello');
    expect(item.kind).toBe('mention');
    expect(item.status).toBe('pending');
    expect(item.sourceMessageIds).toEqual([]);
    expect(item.priority).toBe(1000); // default = createdAt clock
    expect(item.createdAtMs).toBe(1000);
    expect(item.updatedAtMs).toBe(1000);
  });

  it('normalises a bare target handle to @-prefixed', () => {
    const item = enqueue({ roomId: ROOM, targetHandle: 'localchair', text: 'x' }, 1);
    expect(item.targetHandle).toBe('@localchair');
  });

  it('captures a single sourceMessageId as a one-element array', () => {
    const item = enqueue(
      { roomId: ROOM, targetHandle: HANDLE, text: 'x', sourceMessageId: 'msg_1' },
      1
    );
    expect(item.sourceMessageIds).toEqual(['msg_1']);
  });

  it('honours an explicit priority and kind', () => {
    const item = enqueue(
      { roomId: ROOM, targetHandle: HANDLE, text: 'x', priority: 5, kind: 'cron' },
      9999
    );
    expect(item.priority).toBe(5);
    expect(item.kind).toBe('cron');
    expect(item.createdAtMs).toBe(9999);
  });

  it('persists the row so getItem returns it', () => {
    const item = enqueue({ roomId: ROOM, targetHandle: HANDLE, text: 'persisted' }, 1);
    const fetched = getItem(item.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.curatedText).toBe('persisted');
  });
});

describe('messageQueueStore — getItem', () => {
  it('returns null for a missing id', () => {
    expect(getItem('q_nope')).toBeNull();
  });
});

describe('messageQueueStore — listQueue ordering & filtering', () => {
  it('orders by priority ascending, then created_at ascending (FIFO tie-break)', () => {
    // Same priority, different created → FIFO by created.
    const a = enqueue({ roomId: ROOM, targetHandle: HANDLE, text: 'a', priority: 10 }, 100);
    const b = enqueue({ roomId: ROOM, targetHandle: HANDLE, text: 'b', priority: 10 }, 200);
    // Lower priority should sort first regardless of later created.
    const c = enqueue({ roomId: ROOM, targetHandle: HANDLE, text: 'c', priority: 1 }, 300);
    const ids = listQueue(ROOM, HANDLE).map((i) => i.id);
    expect(ids).toEqual([c.id, a.id, b.id]);
  });

  it('default priority=createdAt yields natural FIFO order', () => {
    const a = enqueue({ roomId: ROOM, targetHandle: HANDLE, text: 'a' }, 100);
    const b = enqueue({ roomId: ROOM, targetHandle: HANDLE, text: 'b' }, 200);
    const c = enqueue({ roomId: ROOM, targetHandle: HANDLE, text: 'c' }, 300);
    expect(listQueue(ROOM, HANDLE).map((i) => i.id)).toEqual([a.id, b.id, c.id]);
  });

  it('filters by status', () => {
    const a = enqueue({ roomId: ROOM, targetHandle: HANDLE, text: 'a' }, 100);
    const b = enqueue({ roomId: ROOM, targetHandle: HANDLE, text: 'b' }, 200);
    markDone(a.id);
    expect(listQueue(ROOM, HANDLE, { status: 'pending' }).map((i) => i.id)).toEqual([b.id]);
    expect(listQueue(ROOM, HANDLE, { status: 'done' }).map((i) => i.id)).toEqual([a.id]);
  });

  it('scopes to room + handle', () => {
    enqueue({ roomId: ROOM, targetHandle: HANDLE, text: 'a' }, 1);
    enqueue({ roomId: 'other_room', targetHandle: HANDLE, text: 'b' }, 2);
    enqueue({ roomId: ROOM, targetHandle: '@other', text: 'c' }, 3);
    const ids = listQueue(ROOM, HANDLE).map((i) => i.curatedText);
    expect(ids).toEqual(['a']);
  });

  it('matches a bare handle against the normalised stored handle', () => {
    enqueue({ roomId: ROOM, targetHandle: HANDLE, text: 'a' }, 1);
    expect(listQueue(ROOM, 'localchair').length).toBe(1);
  });
});

describe('messageQueueStore — pullNext (one-in-flight)', () => {
  it('returns null when the queue is empty', () => {
    expect(pullNext(ROOM, HANDLE)).toBeNull();
  });

  it('returns the next pending item and flips it to working', () => {
    const a = enqueue({ roomId: ROOM, targetHandle: HANDLE, text: 'a' }, 100);
    const pulled = pullNext(ROOM, HANDLE, 500);
    expect(pulled?.id).toBe(a.id);
    expect(pulled?.status).toBe('working');
    expect(pulled?.updatedAtMs).toBe(500);
    // persisted as working
    expect(getItem(a.id)?.status).toBe('working');
  });

  it('respects priority then FIFO when choosing the next item', () => {
    const a = enqueue({ roomId: ROOM, targetHandle: HANDLE, text: 'a', priority: 10 }, 100);
    enqueue({ roomId: ROOM, targetHandle: HANDLE, text: 'b', priority: 10 }, 200);
    const c = enqueue({ roomId: ROOM, targetHandle: HANDLE, text: 'c', priority: 1 }, 300);
    // c has lowest priority → pulled first
    expect(pullNext(ROOM, HANDLE)?.id).toBe(c.id);
    // c is now working; one-in-flight returns null
    expect(pullNext(ROOM, HANDLE)).toBeNull();
    // finish c, next is a (priority 10, created 100) before b (priority 10, created 200)
    markDone(c.id);
    expect(pullNext(ROOM, HANDLE)?.id).toBe(a.id);
  });

  it('returns null when something is already working (one-in-flight)', () => {
    enqueue({ roomId: ROOM, targetHandle: HANDLE, text: 'a' }, 100);
    enqueue({ roomId: ROOM, targetHandle: HANDLE, text: 'b' }, 200);
    expect(pullNext(ROOM, HANDLE)).not.toBeNull();
    expect(pullNext(ROOM, HANDLE)).toBeNull(); // worker busy
  });

  it('releases the next item once the working one is done', () => {
    const a = enqueue({ roomId: ROOM, targetHandle: HANDLE, text: 'a' }, 100);
    const b = enqueue({ roomId: ROOM, targetHandle: HANDLE, text: 'b' }, 200);
    expect(pullNext(ROOM, HANDLE)?.id).toBe(a.id);
    markDone(a.id);
    expect(pullNext(ROOM, HANDLE)?.id).toBe(b.id);
  });

  it('one-in-flight is scoped per room+handle (a busy worker elsewhere does not block)', () => {
    enqueue({ roomId: ROOM, targetHandle: HANDLE, text: 'a' }, 100);
    enqueue({ roomId: 'other_room', targetHandle: HANDLE, text: 'b' }, 200);
    expect(pullNext(ROOM, HANDLE)?.curatedText).toBe('a');
    // different room — not blocked by ROOM's working item
    expect(pullNext('other_room', HANDLE)?.curatedText).toBe('b');
  });
});

describe('messageQueueStore — markDone / markDropped', () => {
  it('markDone flips status and returns true', () => {
    const a = enqueue({ roomId: ROOM, targetHandle: HANDLE, text: 'a' }, 1);
    expect(markDone(a.id, 555)).toBe(true);
    const fetched = getItem(a.id);
    expect(fetched?.status).toBe('done');
    expect(fetched?.updatedAtMs).toBe(555);
  });

  it('markDropped flips status and returns true', () => {
    const a = enqueue({ roomId: ROOM, targetHandle: HANDLE, text: 'a' }, 1);
    expect(markDropped(a.id)).toBe(true);
    expect(getItem(a.id)?.status).toBe('dropped');
  });

  it('returns false for a missing id', () => {
    expect(markDone('q_nope')).toBe(false);
    expect(markDropped('q_nope')).toBe(false);
  });
});

describe('messageQueueStore — updateItem', () => {
  it('patches curatedText, priority and status together', () => {
    const a = enqueue({ roomId: ROOM, targetHandle: HANDLE, text: 'orig', priority: 10 }, 1);
    const updated = updateItem(
      a.id,
      { curatedText: 'condensed', priority: 2, status: 'dropped' },
      777
    );
    expect(updated?.curatedText).toBe('condensed');
    expect(updated?.priority).toBe(2);
    expect(updated?.status).toBe('dropped');
    expect(updated?.updatedAtMs).toBe(777);
  });

  it('leaves unspecified fields unchanged', () => {
    const a = enqueue({ roomId: ROOM, targetHandle: HANDLE, text: 'orig', priority: 10 }, 1);
    const updated = updateItem(a.id, { curatedText: 'new text' });
    expect(updated?.curatedText).toBe('new text');
    expect(updated?.priority).toBe(10);
    expect(updated?.status).toBe('pending');
  });

  it('returns null for a missing id', () => {
    expect(updateItem('q_nope', { curatedText: 'x' })).toBeNull();
  });
});

describe('messageQueueStore — reorder', () => {
  it('changes priority and re-sorts the queue', () => {
    const a = enqueue({ roomId: ROOM, targetHandle: HANDLE, text: 'a', priority: 1 }, 100);
    const b = enqueue({ roomId: ROOM, targetHandle: HANDLE, text: 'b', priority: 2 }, 200);
    expect(listQueue(ROOM, HANDLE).map((i) => i.id)).toEqual([a.id, b.id]);
    reorder(b.id, 0); // bump b to the front
    expect(listQueue(ROOM, HANDLE).map((i) => i.id)).toEqual([b.id, a.id]);
  });

  it('returns null for a missing id', () => {
    expect(reorder('q_nope', 1)).toBeNull();
  });
});

describe('messageQueueStore — coalesce', () => {
  it('merges source message ids into the target and drops the source', () => {
    const target = enqueue(
      { roomId: ROOM, targetHandle: HANDLE, text: 'target', sourceMessageId: 'm1' },
      100
    );
    const source = enqueue(
      { roomId: ROOM, targetHandle: HANDLE, text: 'source', sourceMessageId: 'm2' },
      200
    );
    const merged = coalesce(target.id, source.id, 999);
    expect(merged?.id).toBe(target.id);
    expect(merged?.sourceMessageIds.sort()).toEqual(['m1', 'm2']);
    // M3 (adversarial review): source text is NOT lost on a non-containment
    // merge — it is appended so no information is dropped silently.
    expect(merged?.curatedText).toBe('target\n— also: source');
    expect(merged?.updatedAtMs).toBe(999);
    // source ITEM is dropped (its content now lives on the target)
    expect(getItem(source.id)?.status).toBe('dropped');
  });

  it('does not duplicate source text already contained in the target', () => {
    const target = enqueue(
      { roomId: ROOM, targetHandle: HANDLE, text: 'deploy the build and verify', sourceMessageId: 'm1' },
      100
    );
    const source = enqueue(
      { roomId: ROOM, targetHandle: HANDLE, text: 'verify', sourceMessageId: 'm2' },
      200
    );
    const merged = coalesce(target.id, source.id, 999);
    // 'verify' is already in the target → no redundant append.
    expect(merged?.curatedText).toBe('deploy the build and verify');
  });

  it('de-duplicates overlapping source ids', () => {
    const target = enqueue(
      { roomId: ROOM, targetHandle: HANDLE, text: 'target', sourceMessageId: 'shared' },
      100
    );
    const source = enqueue(
      { roomId: ROOM, targetHandle: HANDLE, text: 'source', sourceMessageId: 'shared' },
      200
    );
    const merged = coalesce(target.id, source.id);
    expect(merged?.sourceMessageIds).toEqual(['shared']);
  });

  it('returns null and changes nothing if the target is missing', () => {
    const source = enqueue({ roomId: ROOM, targetHandle: HANDLE, text: 'source' }, 100);
    expect(coalesce('q_nope', source.id)).toBeNull();
    expect(getItem(source.id)?.status).toBe('pending'); // not dropped
  });

  it('returns null and changes nothing if the source is missing', () => {
    const target = enqueue({ roomId: ROOM, targetHandle: HANDLE, text: 'target' }, 100);
    expect(coalesce(target.id, 'q_nope')).toBeNull();
    expect(getItem(target.id)?.status).toBe('pending');
  });
});

describe('messageQueueStore — countPending', () => {
  it('counts only pending items for the room+handle', () => {
    const a = enqueue({ roomId: ROOM, targetHandle: HANDLE, text: 'a' }, 100);
    enqueue({ roomId: ROOM, targetHandle: HANDLE, text: 'b' }, 200);
    enqueue({ roomId: 'other_room', targetHandle: HANDLE, text: 'c' }, 300);
    expect(countPending(ROOM, HANDLE)).toBe(2);
    markDone(a.id);
    expect(countPending(ROOM, HANDLE)).toBe(1);
  });

  it('a working item is not counted as pending', () => {
    enqueue({ roomId: ROOM, targetHandle: HANDLE, text: 'a' }, 100);
    expect(countPending(ROOM, HANDLE)).toBe(1);
    pullNext(ROOM, HANDLE);
    expect(countPending(ROOM, HANDLE)).toBe(0);
  });

  it('matches a bare handle', () => {
    enqueue({ roomId: ROOM, targetHandle: HANDLE, text: 'a' }, 100);
    expect(countPending(ROOM, 'localchair')).toBe(1);
  });
});
