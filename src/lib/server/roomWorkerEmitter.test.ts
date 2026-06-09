/**
 * Tests for the SAFE HALF of the ANT→Claude mention bridge
 * (roomWorkerLease + roomWorkerEmitter). No exposure surface is exercised —
 * the launcher is faked. Runs against the vitest temp DB (db.ts scopes
 * ~/.ant → /tmp/ant-vitest-fresh-*.db when VITEST is set).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  tryAcquireLease,
  releaseLease,
  getLease,
  logFire,
  recentLaunchCount,
  breakerOpen,
  _resetRoomWorkerStateForTests
} from './roomWorkerLease';
import {
  maybeLaunchRoomWorker,
  setRoomWorkerLauncher,
  resetRoomWorkerLauncher,
  WORKER_HANDLE,
  type WorkerLauncher,
  type EmitterMessage
} from './roomWorkerEmitter';

const ROOM = 'gubd4qqvmf';
let msgSeq = 0;
function mention(): EmitterMessage {
  return { id: `msg_${++msgSeq}`, authorHandle: '@speedy', body: `hey ${WORKER_HANDLE} take a look` };
}

const launchOk: WorkerLauncher = async (ctx) => ({
  launched: true,
  sessionId: `session_${ctx.messageId}`,
  sessionUrl: 'https://claude.ai/code/session_x',
  fireTokenId: 'grant_x'
});

beforeEach(() => {
  _resetRoomWorkerStateForTests();
  resetRoomWorkerLauncher();
  msgSeq = 0;
});

describe('roomWorkerLease', () => {
  it('grants one live lease and blocks a second while live', () => {
    const t = 1_000_000;
    expect(tryAcquireLease(ROOM, 1000, t)).toBe(true);
    expect(tryAcquireLease(ROOM, 1000, t + 500)).toBe(false); // still live
    expect(getLease(ROOM)?.status).toBe('live');
  });

  it('reclaims an expired lease (crash safety)', () => {
    const t = 2_000_000;
    expect(tryAcquireLease(ROOM, 1000, t)).toBe(true);
    expect(tryAcquireLease(ROOM, 1000, t + 2000)).toBe(true); // expired → reclaimed
  });

  it('a released lease can be re-acquired immediately', () => {
    const t = 3_000_000;
    expect(tryAcquireLease(ROOM, 60_000, t)).toBe(true);
    releaseLease(ROOM, t + 10);
    expect(tryAcquireLease(ROOM, 60_000, t + 20)).toBe(true);
  });

  it('rate-limit counter only counts launched fires in window', () => {
    const t = 4_000_000;
    for (let i = 0; i < 6; i++) logFire(ROOM, 'launched', `s${i}`, t + i);
    logFire(ROOM, 'suppressed', 'x', t + 7);
    expect(recentLaunchCount(ROOM, 60_000, t + 10)).toBe(6);
    expect(recentLaunchCount(ROOM, 60_000, t + 10 + 60_001)).toBe(0); // window slid past
  });

  it('breaker opens after 3 consecutive failures, closes after cooldown', () => {
    const t = 5_000_000;
    logFire(ROOM, 'failed', 'a', t);
    logFire(ROOM, 'failed', 'b', t + 1);
    logFire(ROOM, 'failed', 'c', t + 2);
    expect(breakerOpen(ROOM, 3, 5 * 60_000, t + 3)).toBe(true);
    expect(breakerOpen(ROOM, 3, 5 * 60_000, t + 2 + 5 * 60_000 + 1)).toBe(false); // cooled down
  });

  it('breaker stays closed if the failures are not consecutive', () => {
    const t = 6_000_000;
    logFire(ROOM, 'failed', 'a', t);
    logFire(ROOM, 'launched', 'b', t + 1);
    logFire(ROOM, 'failed', 'c', t + 2);
    logFire(ROOM, 'failed', 'd', t + 3);
    expect(breakerOpen(ROOM, 3, 5 * 60_000, t + 4)).toBe(false);
  });
});

describe('maybeLaunchRoomWorker', () => {
  it('cold-starts exactly one worker on a direct mention', async () => {
    setRoomWorkerLauncher(launchOk);
    expect(await maybeLaunchRoomWorker(ROOM, mention())).toBe('launched');
    expect(getLease(ROOM)?.status).toBe('live');
    expect(getLease(ROOM)?.sessionId).toMatch(/^session_/);
  });

  it('does NOT start a second worker while the lease is live (drain, not re-fire)', async () => {
    const spy = vi.fn(launchOk);
    setRoomWorkerLauncher(spy);
    expect(await maybeLaunchRoomWorker(ROOM, mention())).toBe('launched');
    expect(await maybeLaunchRoomWorker(ROOM, mention())).toBe('skip:lease-held');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('ignores the worker’s own posts (loop guard)', async () => {
    setRoomWorkerLauncher(launchOk);
    const selfMsg: EmitterMessage = { id: 'msg_self', authorHandle: WORKER_HANDLE, body: `replying ${WORKER_HANDLE}` };
    expect(await maybeLaunchRoomWorker(ROOM, selfMsg)).toBe('skip:self');
  });

  it('ignores messages with no direct mention', async () => {
    setRoomWorkerLauncher(launchOk);
    const noMention: EmitterMessage = { id: 'msg_nm', authorHandle: '@speedy', body: 'just chatting, no ping' };
    expect(await maybeLaunchRoomWorker(ROOM, noMention)).toBe('skip:no-mention');
  });

  it('does not fire while @everyone-only (protects daily cap)', async () => {
    setRoomWorkerLauncher(launchOk);
    const everyone: EmitterMessage = { id: 'msg_e', authorHandle: '@speedy', body: 'heads up @everyone' };
    expect(await maybeLaunchRoomWorker(ROOM, everyone)).toBe('skip:no-mention');
  });

  it('suppresses when the breaker is open', async () => {
    const t = Date.now();
    logFire(ROOM, 'failed', 'a', t - 2);
    logFire(ROOM, 'failed', 'b', t - 1);
    logFire(ROOM, 'failed', 'c', t);
    setRoomWorkerLauncher(launchOk);
    expect(await maybeLaunchRoomWorker(ROOM, mention())).toBe('suppress:breaker');
  });

  it('suppresses when the rate limit is hit', async () => {
    const t = Date.now();
    for (let i = 0; i < 6; i++) logFire(ROOM, 'launched', `s${i}`, t - i);
    setRoomWorkerLauncher(launchOk);
    expect(await maybeLaunchRoomWorker(ROOM, mention())).toBe('suppress:rate-limit');
  });

  it('gated stub declines AND frees the lease so a future mention can retry', async () => {
    // default launcher is the gated stub (resetRoomWorkerLauncher in beforeEach)
    expect(await maybeLaunchRoomWorker(ROOM, mention())).toBe('suppress:declined');
    expect(getLease(ROOM)?.status).toBe('released');
    // once the real launcher is wired, the next mention can acquire + launch
    setRoomWorkerLauncher(launchOk);
    expect(await maybeLaunchRoomWorker(ROOM, mention())).toBe('launched');
  });

  it('releases the lease if the launcher throws', async () => {
    setRoomWorkerLauncher(async () => {
      throw new Error('cloud unreachable');
    });
    expect(await maybeLaunchRoomWorker(ROOM, mention())).toBe('fail:launcher-threw');
    expect(getLease(ROOM)?.status).toBe('released');
  });
});
