import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIdentityDbForTests } from './db';
import { upsertTerminal, updatePaneTarget } from './terminalsStore';
import { addMembership } from './roomMembershipsStore';
import { resetChatRoomStoreForTests, createChatRoom } from './chatRoomStore';
import {
  runIdleMonitor,
  resetFanoutQueueForTests,
  getFanoutQueueForTests,
  resetIdleMonitorThrottleForTests
} from './pty-inject-fanout';
import { setAgentStatus } from './agentStatusStore';
import { resetEntityClaimStoreForTests } from './entityClaimStore';
import { resetIdleNudgeTrackerForTests } from './idleAgentTriggers';

let tmpDir: string;
const previousDbPath = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-idle-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
  resetFanoutQueueForTests();
  resetEntityClaimStoreForTests();
  resetIdleNudgeTrackerForTests();
  resetIdleMonitorThrottleForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
  resetFanoutQueueForTests();
  resetEntityClaimStoreForTests();
  resetIdleNudgeTrackerForTests();
  resetIdleMonitorThrottleForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousDbPath === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousDbPath;
});

describe('runIdleMonitor — idle-agent trigger adapter (live wiring)', () => {
  it('fires a directed nudge to an idle agent and leaves a working agent alone', () => {
    const room = createChatRoom({ name: 'idle-room', whoCreatedIt: '@you' });
    const tIdle = upsertTerminal({ pid: 1, pid_start: 'pi', name: 'idle-agent' });
    const tBusy = upsertTerminal({ pid: 2, pid_start: 'pb', name: 'busy-agent' });
    updatePaneTarget(tIdle.id, '%idle', 'claude_code');
    updatePaneTarget(tBusy.id, '%busy', 'claude_code');
    addMembership({ room_id: room.id, handle: '@idle', terminal_id: tIdle.id });
    addMembership({ room_id: room.id, handle: '@busy', terminal_id: tBusy.id });

    const T0 = Date.now();
    setAgentStatus({ terminalId: tIdle.id, newStatus: 'idle', source: 'hook', nowMs: T0 });
    setAgentStatus({ terminalId: tBusy.id, newStatus: 'working', source: 'hook', nowMs: T0 });

    const q = getFanoutQueueForTests();
    // Run with "now" past the idle threshold for @idle (status set at T0).
    const report = runIdleMonitor(room.id, T0 + 6 * 60_000);

    expect(q.pendingCountForTests(`${room.id}::${tIdle.id}`)).toBe(1); // idle → one directed nudge
    expect(q.pendingCountForTests(`${room.id}::${tBusy.id}`)).toBe(0); // working → none (no spam)
    expect(report.find((r) => r.handle === '@idle')?.engagement).toBe('idle');
    expect(report.find((r) => r.handle === '@busy')?.engagement).toBe('working');
  });

  it('one-shot: a second monitor pass on a still-idle agent does NOT double-nudge', () => {
    const room = createChatRoom({ name: 'idle-once', whoCreatedIt: '@you' });
    const tIdle = upsertTerminal({ pid: 3, pid_start: 'pi3', name: 'idle3' });
    updatePaneTarget(tIdle.id, '%idle3', 'claude_code');
    addMembership({ room_id: room.id, handle: '@idle', terminal_id: tIdle.id });
    const T0 = Date.now();
    setAgentStatus({ terminalId: tIdle.id, newStatus: 'idle', source: 'hook', nowMs: T0 });

    const q = getFanoutQueueForTests();
    runIdleMonitor(room.id, T0 + 6 * 60_000);
    runIdleMonitor(room.id, T0 + 7 * 60_000); // still idle
    expect(q.pendingCountForTests(`${room.id}::${tIdle.id}`)).toBe(1); // exactly one, not two
  });
});
