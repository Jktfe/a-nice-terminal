import { describe, test, expect, beforeEach } from 'vitest';
import { getIdentityDb } from './db';
import { buildVisibilityForAccess } from './agentVisibilityStore';
import type { ChatRoomReadAccess } from './chatRoomReadGate';
import { upsertTerminal } from './terminalsStore';

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
