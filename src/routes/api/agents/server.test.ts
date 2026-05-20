import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests, getIdentityDb } from '$lib/server/db';
import { createChatRoom, inviteAgentToRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { postMessage, resetChatMessageStoreForTests } from '$lib/server/chatMessageStore';
import { addReactionToMessage, resetMessageReactionStoreForTests } from '$lib/server/messageReactionStore';
import { openAskInRoom, resetAskStoreForTests } from '$lib/server/askStore';
import { GET } from './+server';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
  resetChatMessageStoreForTests();
  resetMessageReactionStoreForTests();
  resetAskStoreForTests();
});

afterEach(() => {
  resetAskStoreForTests();
  resetMessageReactionStoreForTests();
  resetChatMessageStoreForTests();
  resetChatRoomStoreForTests();
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
});

function req(url: string): Parameters<typeof GET>[0] {
  return {
    url: new URL(url)
  } as Parameters<typeof GET>[0];
}

describe('GET /api/agents', () => {
  it('lists global agents deduplicated by handle with room memberships', async () => {
    const first = createChatRoom({ name: 'room-one', whoCreatedIt: '@you' });
    const second = createChatRoom({ name: 'room-two', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: first.id, agentHandle: '@alpha', agentDisplayName: 'Alpha' });
    inviteAgentToRoom({ roomId: second.id, agentHandle: '@alpha', agentDisplayName: 'Alpha' });
    inviteAgentToRoom({ roomId: first.id, agentHandle: '@beta', agentDisplayName: 'Beta' });

    const res = await GET(req('http://x/api/agents'));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.agents.map((agent: { handle: string }) => agent.handle)).toEqual(['@alpha', '@beta']);
    const alpha = body.agents.find((agent: { handle: string }) => agent.handle === '@alpha');
    expect(alpha).toMatchObject({
      handle: '@alpha',
      displayName: 'Alpha',
      rooms: expect.arrayContaining([
        expect.objectContaining({ roomId: first.id, roomName: 'room-one' }),
        expect.objectContaining({ roomId: second.id, roomName: 'room-two' })
      ])
    });
  });

  it('filters agents by roomId and rejects missing rooms', async () => {
    const first = createChatRoom({ name: 'room-one', whoCreatedIt: '@you' });
    const second = createChatRoom({ name: 'room-two', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: first.id, agentHandle: '@alpha', agentDisplayName: 'Alpha' });
    inviteAgentToRoom({ roomId: second.id, agentHandle: '@beta', agentDisplayName: 'Beta' });

    const res = await GET(req(`http://x/api/agents?roomId=${first.id}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agents).toEqual([
      expect.objectContaining({
        handle: '@alpha',
        rooms: [expect.objectContaining({ roomId: first.id })]
      })
    ]);

    await expect(GET(req('http://x/api/agents?roomId=missing-room'))).rejects.toMatchObject({
      status: 404
    });
  });
});

// A live + attached terminal is required for an agent to appear in the
// fleet. Tests opt in by inserting a pane_status='verified' row and a
// matching room_memberships row joining the handle to the terminal.
function attachLiveTerminal(handle: string, roomId: string, sessionId: string) {
  const db = getIdentityDb();
  db.prepare(
    `INSERT INTO terminals (id, pid, pid_start, name, tmux_target_pane, pane_status, source, expires_at, meta, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'verified', 'test', NULL, '{}', ?, ?)`
  ).run(sessionId, 1, 'x', `term-${sessionId}`, `tmux:${sessionId}`, 1, 1);
  db.prepare(
    `INSERT INTO room_memberships (id, room_id, handle, terminal_id, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(`rm-${sessionId}`, roomId, handle, sessionId, 1);
}

function attachStaleTerminal(handle: string, roomId: string, sessionId: string) {
  const db = getIdentityDb();
  db.prepare(
    `INSERT INTO terminals (id, pid, pid_start, name, tmux_target_pane, pane_status, source, expires_at, meta, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'stale', 'test', NULL, '{}', ?, ?)`
  ).run(sessionId, 1, 'x', `term-${sessionId}`, `tmux:${sessionId}`, 1, 1);
  db.prepare(
    `INSERT INTO room_memberships (id, room_id, handle, terminal_id, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(`rm-${sessionId}`, roomId, handle, sessionId, 1);
}

describe('GET /api/agents?view=fleet', () => {
  it('returns the rich fleet shape with zero defaults for a fresh agent', async () => {
    const room = createChatRoom({ name: 'fleet-room', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@alpha', agentDisplayName: 'Alpha' });
    attachLiveTerminal('@alpha', room.id, 'sess-alpha');

    const res = await GET(req('http://x/api/agents?view=fleet'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agents).toHaveLength(1);

    const alpha = body.agents[0];
    expect(alpha).toMatchObject({
      handle: '@alpha',
      displayName: 'Alpha',
      rooms: [expect.objectContaining({ roomId: room.id })],
      pastRooms: [],
      collaborators: [],
      status: null,
      workspace: null,
      productivityScore: 0,
      deliveryRate: 0,
      streakDays: 0,
      stats: {
        messages24h: 0,
        runEvents24h: 0,
        plansCreated: 0,
        positiveReactions: 0,
        tasks: { completed: 0, inProgress: 0, pending: 0, blocked: 0 },
        asksPosed: { open: 0 }
      }
    });
    expect(alpha.sparkline).toHaveLength(24);
    expect(alpha.heatmap).toHaveLength(7);
  });

  it('aggregates messages, reactions, tasks, plans, and open asks per handle', async () => {
    const room = createChatRoom({ name: 'busy-room', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@alpha', agentDisplayName: 'Alpha' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@beta', agentDisplayName: 'Beta' });
    attachLiveTerminal('@alpha', room.id, 'sess-alpha');
    attachLiveTerminal('@beta', room.id, 'sess-beta');

    const m1 = postMessage({ roomId: room.id, authorHandle: '@alpha', body: 'hi', kind: 'agent' });
    const m2 = postMessage({ roomId: room.id, authorHandle: '@alpha', body: 'again', kind: 'agent' });
    postMessage({ roomId: room.id, authorHandle: '@beta', body: 'beta msg', kind: 'agent' });

    addReactionToMessage({ messageId: m1.id, reactorHandle: '@beta', emoji: '👍' });
    addReactionToMessage({ messageId: m2.id, reactorHandle: '@beta', emoji: '🙌' });
    // Negative emoji must not count.
    addReactionToMessage({ messageId: m1.id, reactorHandle: '@you', emoji: '👎' });

    openAskInRoom({ roomId: room.id, openedByHandle: '@alpha', title: 'Q', body: '?' });

    const db = getIdentityDb();
    const now = Date.now();
    db.prepare(
      `INSERT INTO tasks (id, subject, status, assigned_agent, created_at_ms, updated_at_ms)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run('t-done', 'done task', 'completed', '@alpha', now, now);
    db.prepare(
      `INSERT INTO tasks (id, subject, status, assigned_agent, created_at_ms, updated_at_ms)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run('t-prog', 'in flight', 'in_progress', '@alpha', now, now);
    db.prepare(
      `INSERT INTO plans (id, title, created_by, created_at_ms, updated_at_ms)
       VALUES (?, ?, ?, ?, ?)`
    ).run('p-1', 'plan one', '@alpha', now, now);

    const res = await GET(req('http://x/api/agents?view=fleet'));
    const body = await res.json();
    const alpha = body.agents.find((a: { handle: string }) => a.handle === '@alpha');
    const beta = body.agents.find((a: { handle: string }) => a.handle === '@beta');

    expect(alpha.stats.messages24h).toBe(2);
    expect(alpha.stats.positiveReactions).toBe(2); // 👍 + 🙌, 👎 excluded
    expect(alpha.stats.plansCreated).toBe(1);
    expect(alpha.stats.tasks).toEqual({ completed: 1, inProgress: 1, pending: 0, blocked: 0 });
    expect(alpha.stats.asksPosed.open).toBe(1);
    expect(alpha.collaborators).toEqual(['@beta']);
    expect(alpha.deliveryRate).toBe(50); // 1 completed / 2 total
    // Score = 2 msgs + 1*5 tasks.completed + 1*3 plans + 2*2 reactions = 14
    expect(alpha.productivityScore).toBe(14);

    expect(beta.stats.messages24h).toBe(1);
    expect(beta.stats.positiveReactions).toBe(0);
    expect(beta.collaborators).toEqual(['@alpha']);
  });

  it('excludes agents without a live + attached terminal (archived / killed / stale)', async () => {
    const room = createChatRoom({ name: 'mixed-room', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@live', agentDisplayName: 'Live' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@stale', agentDisplayName: 'Stale' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@detached', agentDisplayName: 'Detached' });

    attachLiveTerminal('@live', room.id, 'sess-live');
    attachStaleTerminal('@stale', room.id, 'sess-stale');
    // @detached has no terminal — represents an archived agent or one whose
    // terminal has been killed (terminal_records hard-deleted).

    const res = await GET(req('http://x/api/agents?view=fleet'));
    const body = await res.json();
    expect(body.agents.map((a: { handle: string }) => a.handle)).toEqual(['@live']);
  });

  it('excludes agents whose live terminal has expired (TTL past)', async () => {
    const room = createChatRoom({ name: 'expiry-room', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@expired', agentDisplayName: 'Expired' });

    const db = getIdentityDb();
    // expires_at is unix seconds; set to 1 (1970-01-01) so it's always in the
    // past relative to a real Date.now().
    db.prepare(
      `INSERT INTO terminals (id, pid, pid_start, name, tmux_target_pane, pane_status, source, expires_at, meta, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'verified', 'test', 1, '{}', ?, ?)`
    ).run('sess-exp', 1, 'x', 'term-exp', 'tmux:exp', 1, 1);
    db.prepare(
      `INSERT INTO room_memberships (id, room_id, handle, terminal_id, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run('rm-exp', room.id, '@expired', 'sess-exp', 1);

    const res = await GET(req('http://x/api/agents?view=fleet'));
    const body = await res.json();
    expect(body.agents).toEqual([]);
  });
});
