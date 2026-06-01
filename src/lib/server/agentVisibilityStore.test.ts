import { describe, test, expect, beforeEach } from 'vitest';
import { getIdentityDb } from './db';
import { buildVisibilityForAccess, priorityScoreFor } from './agentVisibilityStore';
import type { ChatRoomReadAccess } from './chatRoomReadGate';
import { upsertTerminal } from './terminalsStore';
import {
  setRoomMemberPreferences,
  resetRoomMemberPreferencesStoreForTests
} from './roomMemberPreferencesStore';
import { createChatRoom, resetChatRoomStoreForTests, inviteAgentToRoom } from './chatRoomStore';

describe('buildVisibilityForAccess', () => {
  const adminAccess: ChatRoomReadAccess = {
    isAdminBearer: true,
    source: 'admin-bearer',
    handles: [],
    principalHandles: [],
  };

  beforeEach(() => {
    const db = getIdentityDb();
    // Clean agent terminals between tests
    db.prepare("DELETE FROM terminals").run();
  });

  test('returns rooms array + fleet counts for admin', () => {
    const result = buildVisibilityForAccess(adminAccess);
    expect(Array.isArray(result.rooms)).toBe(true);
    expect(typeof result.totalAgents).toBe('number');
    expect(typeof result.activeAgents).toBe('number');
    expect(typeof result.idleAgents).toBe('number');
    expect(result.idleAgents).toBe(result.totalAgents - result.activeAgents);
  });

  test('room entries have required shape', () => {
    const result = buildVisibilityForAccess(adminAccess);
    for (const room of result.rooms) {
      expect(room.id).toBeTruthy();
      expect(room.name).toBeTruthy();
      expect(typeof room.agentCount).toBe('number');
      expect(typeof room.humanCount).toBe('number');
      expect(typeof room.openAskCount).toBe('number');
      expect(typeof room.lastActivityAtMs).toBe('number');
    }
  });

  test('fleet counts reflect seeded terminals (nonzero, no silent zero-out)', () => {
    const db = getIdentityDb();
    const nowMs = Date.now();

    // Seed 3 agent terminals: 2 active (recent agent_status_at_ms), 1 idle
    for (let i = 0; i < 3; i++) {
      const terminal = upsertTerminal({
        name: `test-agent-${i}`,
        pid: 1000 + i,
        pid_start: 'test',
        ttlSeconds: 3600,
      });
      const isActive = i < 2;
      db.prepare(`UPDATE terminals SET
        agent_kind = ?, agent_status = ?, agent_status_source = ?, agent_status_at_ms = ?
        WHERE id = ?`).run(
        'codex',
        isActive ? 'working' : 'idle',
        'hook',
        isActive ? nowMs : nowMs - 10 * 60 * 1000,
        terminal.id
      );
    }

    const result = buildVisibilityForAccess(adminAccess);
    expect(result.totalAgents).toBe(3);
    expect(result.activeAgents).toBe(2);
    expect(result.idleAgents).toBe(1);
  });

  test('remote terminals are excluded from fleet counts', () => {
    const db = getIdentityDb();
    const nowMs = Date.now();

    const terminal = upsertTerminal({
      name: 'test-remote',
      pid: 2000,
      pid_start: 'test',
      ttlSeconds: 3600,
    });
    db.prepare(`UPDATE terminals SET
      agent_kind = ?, agent_status = ?, agent_status_source = ?, agent_status_at_ms = ?
      WHERE id = ?`).run(
      'remote', 'working', 'hook', nowMs, terminal.id
    );

    const result = buildVisibilityForAccess(adminAccess);
    expect(result.totalAgents).toBe(0);
    expect(result.activeAgents).toBe(0);
  });
});

describe('priorityScoreFor (formula unit tests)', () => {
  test('asks-for-viewer dominates the score (100x weight)', () => {
    const baseline = priorityScoreFor({
      openAsksForViewer: 0, populationCount: 100, msSinceLastActivity: 1000, muted: false
    });
    const withOneAsk = priorityScoreFor({
      openAsksForViewer: 1, populationCount: 100, msSinceLastActivity: 1000, muted: false
    });
    // One ask adds 100 points; population (100·0.1=10) is dwarfed
    expect(withOneAsk - baseline).toBeCloseTo(100, 0);
  });

  test('muted always returns 0 regardless of other signals', () => {
    expect(priorityScoreFor({
      openAsksForViewer: 99, populationCount: 999, msSinceLastActivity: 1, muted: true
    })).toBe(0);
  });

  test('recency decays smoothly (60M / ms-since-activity)', () => {
    const oneSecondAgo = priorityScoreFor({
      openAsksForViewer: 0, populationCount: 0, msSinceLastActivity: 1000, muted: false
    });
    const oneMinuteAgo = priorityScoreFor({
      openAsksForViewer: 0, populationCount: 0, msSinceLastActivity: 60_000, muted: false
    });
    // 60M/1k = 60_000; 60M/60k = 1000 — one second's recency is 60x stronger
    expect(oneSecondAgo).toBeCloseTo(60_000, 0);
    expect(oneMinuteAgo).toBeCloseTo(1000, 0);
    expect(oneSecondAgo).toBeGreaterThan(oneMinuteAgo);
  });

  test('handles edge cases without NaN/Infinity', () => {
    // msSinceLastActivity=0 must not divide by zero
    const result = priorityScoreFor({
      openAsksForViewer: 0, populationCount: 0, msSinceLastActivity: 0, muted: false
    });
    expect(Number.isFinite(result)).toBe(true);
  });

  test('negative inputs clamped to 0 (defensive)', () => {
    const result = priorityScoreFor({
      openAsksForViewer: -5, populationCount: -10, msSinceLastActivity: 1000, muted: false
    });
    expect(result).toBeGreaterThanOrEqual(60_000_000 / 1000); // just the recency term
  });
});

describe('buildVisibilityForAccess: priorityScore + prefs merge', () => {
  const viewerHandle = '@viewer-test';
  const adminAccessNoHandle: ChatRoomReadAccess = {
    isAdminBearer: true, source: 'admin-bearer', handles: [], principalHandles: []
  };
  const viewerAccess: ChatRoomReadAccess = {
    isAdminBearer: true, source: 'admin-bearer', handles: [viewerHandle], principalHandles: [viewerHandle]
  };

  beforeEach(() => {
    const db = getIdentityDb();
    db.prepare("DELETE FROM terminals").run();
    resetChatRoomStoreForTests();
    resetRoomMemberPreferencesStoreForTests();
  });

  test('each room entry has priorityScore + pinned/muted/archived flags', () => {
    createChatRoom({ name: 'room-shape', whoCreatedIt: '@test' });
    const result = buildVisibilityForAccess(viewerAccess);
    for (const room of result.rooms) {
      expect(typeof room.priorityScore).toBe('number');
      expect(typeof room.pinned).toBe('boolean');
      expect(typeof room.muted).toBe('boolean');
      expect(typeof room.archived).toBe('boolean');
      expect(typeof room.openAsksForViewer).toBe('number');
    }
  });

  test('muted room sorts to the bottom (priorityScore zeroed)', () => {
    const roomA = createChatRoom({ name: 'room-a', whoCreatedIt: '@test' });
    const roomB = createChatRoom({ name: 'room-b', whoCreatedIt: '@test' });
    setRoomMemberPreferences({ roomId: roomA.id, handle: viewerHandle, muted: true });
    const result = buildVisibilityForAccess(viewerAccess);
    const a = result.rooms.find((r) => r.id === roomA.id);
    const b = result.rooms.find((r) => r.id === roomB.id);
    expect(a?.muted).toBe(true);
    expect(a?.priorityScore).toBe(0);
    expect(b?.priorityScore).toBeGreaterThan(0);
    // muted floats below unmuted in the default sort
    const positionA = result.rooms.findIndex((r) => r.id === roomA.id);
    const positionB = result.rooms.findIndex((r) => r.id === roomB.id);
    expect(positionA).toBeGreaterThan(positionB);
  });

  test('pinned room floats to the top regardless of score', () => {
    const roomBoring = createChatRoom({ name: 'boring', whoCreatedIt: '@test' });
    const roomActive = createChatRoom({ name: 'active', whoCreatedIt: '@test' });
    // Make roomActive newer so its priorityScore is higher
    const db = getIdentityDb();
    db.prepare("UPDATE chat_rooms SET last_update = ? WHERE id = ?").run(
      new Date(Date.now() - 60_000).toISOString(), roomBoring.id
    );
    setRoomMemberPreferences({ roomId: roomBoring.id, handle: viewerHandle, pinned: true });
    const result = buildVisibilityForAccess(viewerAccess);
    expect(result.rooms[0].id).toBe(roomBoring.id);
    expect(result.rooms[0].pinned).toBe(true);
  });

  test('archived room hidden by default, surfaced when includeArchived=true', () => {
    const roomArchived = createChatRoom({ name: 'archived', whoCreatedIt: '@test' });
    createChatRoom({ name: 'visible', whoCreatedIt: '@test' });
    setRoomMemberPreferences({ roomId: roomArchived.id, handle: viewerHandle, archived: true });
    const defaultResult = buildVisibilityForAccess(viewerAccess);
    expect(defaultResult.rooms.find((r) => r.id === roomArchived.id)).toBeUndefined();
    const withArchived = buildVisibilityForAccess(viewerAccess, { includeArchived: true });
    expect(withArchived.rooms.find((r) => r.id === roomArchived.id)).toBeDefined();
  });

  test('admin-bearer with empty handles array gets all rooms but no per-viewer prefs', () => {
    const room = createChatRoom({ name: 'admin-view', whoCreatedIt: '@test' });
    setRoomMemberPreferences({ roomId: room.id, handle: viewerHandle, pinned: true });
    // Admin without a handle won't see viewerHandle's prefs
    const result = buildVisibilityForAccess(adminAccessNoHandle);
    const found = result.rooms.find((r) => r.id === room.id);
    expect(found?.pinned).toBe(false);
  });

  test('openAsksForViewer filters by viewer handle (different viewers see different counts)', () => {
    // This is hard to assert without setting up asks too — keep a
    // shape-only smoke test for now; ask filtering depends on the
    // askStore having target_handle data which is exercised elsewhere.
    const room = createChatRoom({ name: 'ask-count', whoCreatedIt: '@test' });
    const result = buildVisibilityForAccess(viewerAccess);
    const found = result.rooms.find((r) => r.id === room.id);
    expect(found?.openAsksForViewer).toBe(0);
    expect(found?.openAskCount).toBeGreaterThanOrEqual(0);
  });
});
