import { describe, expect, it } from 'vitest';
import { makeInjectQueue } from './pty-inject-queue';

describe('makeInjectQueue', () => {
  it('flushes a single message after flushDelay', () => {
    const flushes: { handle: string; batch: string[] }[] = [];
    const queue = makeInjectQueue<string>((handle, batch) => flushes.push({ handle, batch }), {
      flushDelayMs: 10,
      scheduler: (cb) => setTimeout(cb, 10) as any,
      cancelScheduler: (id) => clearTimeout(id as any)
    });
    queue.enqueue('@x', 'msg-1');
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(flushes.length).toBe(1);
        expect(flushes[0].batch).toEqual(['msg-1']);
        queue.resetForTests();
        resolve();
      }, 50);
    });
  });

  it('batches multiple messages within the flush window into one onFlush call', () => {
    const flushes: { handle: string; batch: string[] }[] = [];
    const queue = makeInjectQueue<string>((handle, batch) => flushes.push({ handle, batch }), {
      flushDelayMs: 30,
      scheduler: (cb, ms) => setTimeout(cb, ms) as any,
      cancelScheduler: (id) => clearTimeout(id as any)
    });
    queue.enqueue('@x', 'a');
    queue.enqueue('@x', 'b');
    queue.enqueue('@x', 'c');
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(flushes.length).toBe(1);
        expect(flushes[0].batch).toEqual(['a', 'b', 'c']);
        queue.resetForTests();
        resolve();
      }, 80);
    });
  });

  it('keeps per-handle queues independent', () => {
    const flushes: { handle: string; batch: string[] }[] = [];
    const queue = makeInjectQueue<string>((handle, batch) => flushes.push({ handle, batch }), {
      flushDelayMs: 20,
      scheduler: (cb, ms) => setTimeout(cb, ms) as any,
      cancelScheduler: (id) => clearTimeout(id as any)
    });
    queue.enqueue('@a', 'a-1');
    queue.enqueue('@b', 'b-1');
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const handles = new Set(flushes.map((f) => f.handle));
        expect(handles.has('@a')).toBe(true);
        expect(handles.has('@b')).toBe(true);
        expect(flushes.find((f) => f.handle === '@a')?.batch).toEqual(['a-1']);
        expect(flushes.find((f) => f.handle === '@b')?.batch).toEqual(['b-1']);
        queue.resetForTests();
        resolve();
      }, 60);
    });
  });

  it('immediateFlush clears the timer and emits now', () => {
    const flushes: { handle: string; batch: string[] }[] = [];
    let scheduledId: any = null;
    let cancelCalled = false;
    const queue = makeInjectQueue<string>((handle, batch) => flushes.push({ handle, batch }), {
      flushDelayMs: 1000,
      scheduler: (cb, ms) => {
        scheduledId = { fired: false, cb };
        return scheduledId as any;
      },
      cancelScheduler: (id) => { cancelCalled = true; }
    });
    queue.enqueue('@x', 'a');
    queue.enqueue('@x', 'b');
    expect(queue.pendingCountForTests('@x')).toBe(2);
    queue.immediateFlush('@x');
    expect(flushes.length).toBe(1);
    expect(flushes[0].batch).toEqual(['a', 'b']);
    expect(cancelCalled).toBe(true);
    queue.resetForTests();
  });

  it('keeps a batch pending when onFlush throws so it can be retried', () => {
    const flushes: { handle: string; batch: string[] }[] = [];
    const errors: { handle: string; batch: string[]; message: string }[] = [];
    let attempts = 0;
    const queue = makeInjectQueue<string>((handle, batch) => {
      attempts += 1;
      if (attempts === 1) throw new Error('tmux write failed');
      flushes.push({ handle, batch });
    }, {
      flushDelayMs: 1000,
      scheduler: (cb) => ({ cb }) as any,
      cancelScheduler: () => {},
      onFlushError: (handle, batch, cause) => {
        errors.push({
          handle,
          batch,
          message: cause instanceof Error ? cause.message : String(cause)
        });
      }
    });

    queue.enqueue('@x', 'a');
    queue.enqueue('@x', 'b');

    queue.immediateFlush('@x');
    expect(queue.pendingCountForTests('@x')).toBe(2);
    expect(errors).toEqual([{ handle: '@x', batch: ['a', 'b'], message: 'tmux write failed' }]);
    expect(flushes).toEqual([]);

    queue.immediateFlush('@x');
    expect(queue.pendingCountForTests('@x')).toBe(0);
    expect(flushes).toEqual([{ handle: '@x', batch: ['a', 'b'] }]);
    queue.resetForTests();
  });

  it('flush on empty queue is a no-op', () => {
    const flushes: any[] = [];
    const queue = makeInjectQueue<string>((handle, batch) => flushes.push({ handle, batch }));
    queue.immediateFlush('@nobody');
    expect(flushes.length).toBe(0);
    queue.resetForTests();
  });
});
