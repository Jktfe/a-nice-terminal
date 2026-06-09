import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from './db';
import { enqueue, pullNext, listQueue, reclaimStaleWorking, resetMessageQueueForTests } from './messageQueueStore';

const ROOM = 'r';
const H = '@chair';

beforeEach(() => { process.env.ANT_FRESH_DB_PATH = ':memory:'; resetIdentityDbForTests(); resetMessageQueueForTests(); });
afterEach(() => { resetIdentityDbForTests(); delete process.env.ANT_FRESH_DB_PATH; });

describe('reclaimStaleWorking — stuck-worker backstop', () => {
  it('reclaims a working item older than ttl back to pending', () => {
    const t0 = 1_000_000;
    enqueue({ roomId: ROOM, targetHandle: H, text: 'a' }, t0);
    const claimed = pullNext(ROOM, H, t0);
    expect(claimed?.status).toBe('working');
    // now is well past t0 + ttl → the working item is stale
    const reclaimed = reclaimStaleWorking(ROOM, H, 60_000, t0 + 120_000);
    expect(reclaimed).toBe(1);
    expect(listQueue(ROOM, H, { status: 'pending' }).length).toBe(1);
    expect(listQueue(ROOM, H, { status: 'working' }).length).toBe(0);
  });

  it('does NOT reclaim a fresh working item (within ttl)', () => {
    const t0 = 1_000_000;
    enqueue({ roomId: ROOM, targetHandle: H, text: 'a' }, t0);
    pullNext(ROOM, H, t0);
    const reclaimed = reclaimStaleWorking(ROOM, H, 60_000, t0 + 5_000); // only 5s elapsed
    expect(reclaimed).toBe(0);
    expect(listQueue(ROOM, H, { status: 'working' }).length).toBe(1);
  });

  it('after reclaim, pullNext can claim the recovered item again (queue un-stalls)', () => {
    const t0 = 1_000_000;
    enqueue({ roomId: ROOM, targetHandle: H, text: 'a' }, t0);
    pullNext(ROOM, H, t0);
    // stuck: a second pull is blocked (one-in-flight)
    expect(pullNext(ROOM, H, t0 + 1000)).toBeNull();
    // reclaim → then a pull succeeds again
    reclaimStaleWorking(ROOM, H, 60_000, t0 + 120_000);
    const reclaimedPull = pullNext(ROOM, H, t0 + 121_000);
    expect(reclaimedPull?.status).toBe('working');
  });
});
