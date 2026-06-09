import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from './db';
import { enqueue, listQueue, pullNext, resetMessageQueueForTests } from './messageQueueStore';
import { isWorkerFree, maybePullForWorker } from './queueConsumer';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;

const ROOM = 'room_consumer';
const HANDLE = '@localchair';

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  resetIdentityDbForTests();
  resetMessageQueueForTests();
});

afterEach(() => {
  resetMessageQueueForTests();
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
});

// Model-free injected state readers. Each ignores the handle and returns a
// fixed label so the gate is tested in isolation from ~/.ant/state.
const stateFn = (label: string | null) => () => label;

describe('isWorkerFree', () => {
  it('treats Waiting and Available (any case) as free', () => {
    expect(isWorkerFree('Waiting')).toBe(true);
    expect(isWorkerFree('waiting')).toBe(true);
    expect(isWorkerFree('Available')).toBe(true);
    expect(isWorkerFree('AVAILABLE')).toBe(true);
    expect(isWorkerFree('  available  ')).toBe(true);
  });

  it('treats Working / anything else / null as NOT free (conservative hold)', () => {
    expect(isWorkerFree('Working')).toBe(false);
    expect(isWorkerFree('working')).toBe(false);
    expect(isWorkerFree('Thinking')).toBe(false);
    expect(isWorkerFree('response-required')).toBe(false);
    expect(isWorkerFree('')).toBe(false);
    expect(isWorkerFree(null)).toBe(false);
  });
});

describe('maybePullForWorker — capacity gate', () => {
  it('worker FREE + something pending → pulls and claims the item', () => {
    enqueue({ roomId: ROOM, targetHandle: HANDLE, text: 'first' }, 1000);
    enqueue({ roomId: ROOM, targetHandle: HANDLE, text: 'second' }, 2000);

    const claimed = maybePullForWorker(ROOM, HANDLE, {
      readWorkerState: stateFn('Waiting'),
      now: 3000
    });

    expect(claimed).not.toBeNull();
    expect(claimed?.curatedText).toBe('first'); // FIFO
    expect(claimed?.status).toBe('working');

    // The item is now in flight; the next pending one is untouched.
    const pending = listQueue(ROOM, HANDLE, { status: 'pending' });
    expect(pending.map((i) => i.curatedText)).toEqual(['second']);
    const working = listQueue(ROOM, HANDLE, { status: 'working' });
    expect(working).toHaveLength(1);
  });

  it('treats Available as free too', () => {
    enqueue({ roomId: ROOM, targetHandle: HANDLE, text: 'only' }, 1000);
    const claimed = maybePullForWorker(ROOM, HANDLE, {
      readWorkerState: stateFn('Available'),
      now: 2000
    });
    expect(claimed?.curatedText).toBe('only');
    expect(claimed?.status).toBe('working');
  });

  it('worker WORKING → returns null, leaves the queue untouched', () => {
    enqueue({ roomId: ROOM, targetHandle: HANDLE, text: 'first' }, 1000);

    const claimed = maybePullForWorker(ROOM, HANDLE, {
      readWorkerState: stateFn('Working'),
      now: 2000
    });

    expect(claimed).toBeNull();
    // nothing claimed: still pending, nothing working.
    expect(listQueue(ROOM, HANDLE, { status: 'pending' })).toHaveLength(1);
    expect(listQueue(ROOM, HANDLE, { status: 'working' })).toHaveLength(0);
  });

  it('worker FREE but NOTHING pending → returns null', () => {
    const claimed = maybePullForWorker(ROOM, HANDLE, {
      readWorkerState: stateFn('Waiting'),
      now: 2000
    });
    expect(claimed).toBeNull();
  });

  it('respects one-in-flight: worker FREE but an item already working → returns null', () => {
    enqueue({ roomId: ROOM, targetHandle: HANDLE, text: 'first' }, 1000);
    enqueue({ roomId: ROOM, targetHandle: HANDLE, text: 'second' }, 2000);

    // Put the first item in flight directly via the store.
    const inFlight = pullNext(ROOM, HANDLE, 1500);
    expect(inFlight?.curatedText).toBe('first');
    expect(inFlight?.status).toBe('working');

    // Even though the worker reports free, the gate must not double-release.
    const claimed = maybePullForWorker(ROOM, HANDLE, {
      readWorkerState: stateFn('Waiting'),
      now: 3000
    });
    expect(claimed).toBeNull();
    // 'second' is still pending; only the one in-flight is working.
    expect(listQueue(ROOM, HANDLE, { status: 'pending' }).map((i) => i.curatedText)).toEqual([
      'second'
    ]);
    expect(listQueue(ROOM, HANDLE, { status: 'working' })).toHaveLength(1);
  });

  it('unknown worker state (null) → conservative hold, returns null', () => {
    enqueue({ roomId: ROOM, targetHandle: HANDLE, text: 'first' }, 1000);
    const claimed = maybePullForWorker(ROOM, HANDLE, {
      readWorkerState: stateFn(null),
      now: 2000
    });
    expect(claimed).toBeNull();
    expect(listQueue(ROOM, HANDLE, { status: 'pending' })).toHaveLength(1);
  });
});
