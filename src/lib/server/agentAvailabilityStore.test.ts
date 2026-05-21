import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getIdentityDb, resetIdentityDbForTests } from './db';
import { listAgentAvailability } from './agentAvailabilityStore';
import {
  createChatRoom,
  inviteAgentToRoom,
  resetChatRoomStoreForTests,
} from './chatRoomStore';
import { postMessage, resetChatMessageStoreForTests } from './chatMessageStore';
import { enterFocus, resetFocusModeStoreForTests } from './focusModeStore';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
  resetChatMessageStoreForTests();
  resetFocusModeStoreForTests();
});

afterEach(() => {
  resetFocusModeStoreForTests();
  resetChatMessageStoreForTests();
  resetChatRoomStoreForTests();
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
});

// Insert a tasks row directly — tests own the shape so the store join is
// exercised without going through the tasksStore write path.
function insertTask(opts: {
  id: string;
  subject: string;
  status: string;
  assignedTo?: string | null;
  assignedAgent?: string | null;
  planId?: string | null;
  title?: string | null;
  updatedAtMs?: number;
}) {
  const db = getIdentityDb();
  const now = opts.updatedAtMs ?? Date.now();
  db.prepare(
    `INSERT INTO tasks (id, subject, status, assigned_to, assigned_agent, plan_id, title, created_at_ms, updated_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    opts.id,
    opts.subject,
    opts.status,
    opts.assignedTo ?? null,
    opts.assignedAgent ?? null,
    opts.planId ?? null,
    opts.title ?? null,
    now,
    now
  );
}

describe('agentAvailabilityStore.listAgentAvailability', () => {
  it('returns the full roster with model + skill inference and a summary', () => {
    const room = createChatRoom({ name: 'users', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@evolveantclaude', agentDisplayName: 'Claude' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@codexollama4', agentDisplayName: 'Codex' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@uxant', agentDisplayName: 'UX' });

    const { agents, summary } = listAgentAvailability();
    expect(agents.map((a) => a.handle)).toEqual([
      '@codexollama4',
      '@evolveantclaude',
      '@uxant',
    ]);

    const claude = agents.find((a) => a.handle === '@evolveantclaude')!;
    expect(claude.model).toBe('claude');
    expect(claude.skills).toEqual(['general']);
    expect(claude.alive).toBe(true);
    expect(claude.currentRooms).toHaveLength(1);
    expect(claude.currentRooms[0].status).toBe('idle');
    expect(claude.currentTask).toBeNull();

    const codex = agents.find((a) => a.handle === '@codexollama4')!;
    expect(codex.model).toBe('codex');
    expect(codex.skills).toContain('code-gen');

    expect(summary).toEqual({ total: 3, alive: 3, inRoom: 3, idle: 3, focused: 0 });
  });

  it('marks rooms as active when a recent message exists and focused via focusModeStore', () => {
    const room = createChatRoom({ name: 'jfeboje2kj', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@usermgtclaude', agentDisplayName: 'UM' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@focusedclaude', agentDisplayName: 'F' });

    // Active = posted within the last hour.
    postMessage({ roomId: room.id, authorHandle: '@usermgtclaude', body: 'hi', kind: 'agent' });
    // Focused trumps recent-active.
    enterFocus({ roomId: room.id, memberHandle: '@focusedclaude' });
    postMessage({ roomId: room.id, authorHandle: '@focusedclaude', body: 'deep work', kind: 'agent' });

    const { agents, summary } = listAgentAvailability();
    const um = agents.find((a) => a.handle === '@usermgtclaude')!;
    expect(um.currentRooms[0].status).toBe('active');
    expect(um.currentRooms[0].lastActiveAt).not.toBeNull();

    const focused = agents.find((a) => a.handle === '@focusedclaude')!;
    expect(focused.currentRooms[0].status).toBe('focused');
    expect(summary.focused).toBe(1);
  });

  it('attaches a currentTask via assigned_to or assigned_agent and prefers most-recent in_progress', () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@evolveantclaude', agentDisplayName: 'C' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@codexlead1', agentDisplayName: 'X' });

    // assigned_to (newer) — most-recent in_progress wins.
    insertTask({
      id: 'task_acct_s3',
      subject: 'old assignment',
      status: 'in_progress',
      assignedTo: '@evolveantclaude',
      planId: 'plan_ant_accounts_phase_1',
      title: 'Old task',
      updatedAtMs: 1_000,
    });
    insertTask({
      id: 'task_acct_s9',
      subject: 'newest',
      status: 'in_progress',
      assignedTo: '@evolveantclaude',
      planId: 'plan_ant_accounts_phase_1',
      title: 'Newest task',
      updatedAtMs: 2_000,
    });
    // Completed tasks must NOT appear as currentTask.
    insertTask({
      id: 'task_done',
      subject: 'done',
      status: 'completed',
      assignedTo: '@evolveantclaude',
      updatedAtMs: 3_000,
    });
    // Legacy assigned_agent (no assigned_to) still resolves.
    insertTask({
      id: 'task_legacy',
      subject: 'legacy',
      status: 'in_progress',
      assignedAgent: '@codexlead1',
      title: 'Legacy column task',
    });

    const { agents } = listAgentAvailability();
    const claude = agents.find((a) => a.handle === '@evolveantclaude')!;
    expect(claude.currentTask).toEqual({
      id: 'task_acct_s9',
      planId: 'plan_ant_accounts_phase_1',
      title: 'Newest task',
    });

    const codex = agents.find((a) => a.handle === '@codexlead1')!;
    expect(codex.currentTask).toEqual({
      id: 'task_legacy',
      planId: null,
      title: 'Legacy column task',
    });
  });

  it('filters by model + skill + roomId + inRoom', () => {
    const r1 = createChatRoom({ name: 'r1', whoCreatedIt: '@you' });
    const r2 = createChatRoom({ name: 'r2', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: r1.id, agentHandle: '@evolveantclaude', agentDisplayName: 'C' });
    inviteAgentToRoom({ roomId: r2.id, agentHandle: '@codexlead1', agentDisplayName: 'X' });
    inviteAgentToRoom({ roomId: r1.id, agentHandle: '@uxant', agentDisplayName: 'U' });

    // ?model=claude
    const claudeOnly = listAgentAvailability({ model: 'claude' });
    expect(claudeOnly.agents.map((a) => a.handle)).toEqual(['@evolveantclaude']);

    // ?skill=code-gen (codex)
    const codeGen = listAgentAvailability({ skill: 'code-gen' });
    expect(codeGen.agents.map((a) => a.handle)).toEqual(['@codexlead1']);

    // ?skill=svelte5 not in fleet
    const svelte = listAgentAvailability({ skill: 'svelte5' });
    expect(svelte.agents).toEqual([]);

    // ?roomId=r1
    const inR1 = listAgentAvailability({ roomId: r1.id });
    expect(inR1.agents.map((a) => a.handle).sort()).toEqual([
      '@evolveantclaude',
      '@uxant',
    ]);

    // ?inRoom=false (none — every seeded agent has a room)
    const idle = listAgentAvailability({ inRoom: false });
    expect(idle.agents).toEqual([]);
  });

  it('hides agents whose only rooms are archived/deleted (alive=true default)', () => {
    const archivedRoom = createChatRoom({ name: 'gone', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: archivedRoom.id, agentHandle: '@ghostant', agentDisplayName: 'G' });
    // Manually archive without going through chatRoomStore so we don't have
    // to follow the archive/unarchive verb chain — schema is the same.
    getIdentityDb()
      .prepare(`UPDATE chat_rooms SET archived_at_ms = ? WHERE id = ?`)
      .run(Date.now(), archivedRoom.id);

    const liveRoom = createChatRoom({ name: 'live', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: liveRoom.id, agentHandle: '@aliveant', agentDisplayName: 'A' });

    // Match the route default — ?alive defaults to true at the API surface.
    const def = listAgentAvailability({ alive: true });
    expect(def.agents.map((a) => a.handle)).toEqual(['@aliveant']);

    // ?alive=false widens to include the archived-only roster as
    // not-currently-in-any-room (alive=false).
    const audit = listAgentAvailability({ alive: false });
    expect(audit.agents.map((a) => a.handle)).toEqual(['@ghostant']);
    expect(audit.agents[0].alive).toBe(false);
    expect(audit.agents[0].currentRooms).toEqual([]);
  });
});
