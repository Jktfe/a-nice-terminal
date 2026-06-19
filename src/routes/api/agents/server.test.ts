import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetIdentityDbForTests, getIdentityDb } from '$lib/server/db';

// The fleet route hits the v3 pty daemon to learn which tmux sessions are
// alive. Tests run without the daemon socket, so stub listTerminals to
// return whichever ids each test wants to mark "alive".
const liveSessionIds: string[] = [];
let listTerminalsCallCount = 0;
function setLiveSessions(ids: string[]) {
  liveSessionIds.length = 0;
  liveSessionIds.push(...ids);
}
vi.mock('$lib/server/ptyClient', () => ({
  listTerminals: async () => {
    listTerminalsCallCount += 1;
    return liveSessionIds.slice();
  },
}));

import { createChatRoom, inviteAgentToRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { postMessage, resetChatMessageStoreForTests } from '$lib/server/chatMessageStore';
import { addReactionToMessage, resetMessageReactionStoreForTests } from '$lib/server/messageReactionStore';
import { openAskInRoom, resetAskStoreForTests } from '$lib/server/askStore';
import { GET, _resetAgentsLiveSessionCacheForTests } from './+server';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;
const PREV_CACHE_MS = process.env.ANT_AGENTS_LIVE_SESSION_CACHE_MS;

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  process.env.ANT_AGENTS_LIVE_SESSION_CACHE_MS = '3000';
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
  resetChatMessageStoreForTests();
  resetMessageReactionStoreForTests();
  resetAskStoreForTests();
  setLiveSessions([]);
  listTerminalsCallCount = 0;
  _resetAgentsLiveSessionCacheForTests();
});

afterEach(() => {
  _resetAgentsLiveSessionCacheForTests();
  resetAskStoreForTests();
  resetMessageReactionStoreForTests();
  resetChatMessageStoreForTests();
  resetChatRoomStoreForTests();
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
  if (PREV_CACHE_MS === undefined) delete process.env.ANT_AGENTS_LIVE_SESSION_CACHE_MS;
  else process.env.ANT_AGENTS_LIVE_SESSION_CACHE_MS = PREV_CACHE_MS;
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

// Bind a handle to a terminal_id via room_memberships + terminals. The
// terminal counts as "live and attached" only when the caller also adds the
// session id to setLiveSessions() — that mirrors the production check that
// asks the pty daemon which tmux sessions still exist.
function attachTerminal(
  handle: string,
  roomId: string,
  sessionId: string,
  opts?: { expiresAt?: number | null; agentStatus?: string; agentStatusAtMs?: number }
) {
  const db = getIdentityDb();
  const expiresAt = opts?.expiresAt === undefined ? null : opts.expiresAt;
  const agentStatus = opts?.agentStatus ?? 'idle';
  const agentStatusAtMs = opts?.agentStatusAtMs ?? 0;
  db.prepare(
    `INSERT INTO terminals (id, pid, pid_start, name, tmux_target_pane, pane_status, source, expires_at, meta, created_at, updated_at, agent_status, agent_status_at_ms)
     VALUES (?, ?, ?, ?, ?, 'verified', 'test', ?, '{}', ?, ?, ?, ?)`
  ).run(sessionId, 1, 'x', `term-${sessionId}`, `tmux:${sessionId}`, expiresAt, 1, 1, agentStatus, agentStatusAtMs);
  // The fleet view is TERMINAL-centric: it sources attached, non-superseded
  // terminal_records (not the agent registry). Seed the matching record so the
  // bound terminal appears in the fleet. name = handle so displayName asserts
  // stay stable.
  db.prepare(
    `INSERT INTO terminal_records (session_id, name, agent_kind, tmux_target_pane, handle, created_at_ms, updated_at_ms)
     VALUES (?, ?, 'claude', ?, ?, ?, ?)`
  ).run(sessionId, handle, `tmux:${sessionId}`, handle, 1, 1);
  db.prepare(
    `INSERT INTO room_memberships (id, room_id, handle, terminal_id, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(`rm-${sessionId}`, roomId, handle, sessionId, 1);
}

describe('GET /api/agents?view=fleet', () => {
  it('returns the rich fleet shape with zero defaults for a fresh agent', async () => {
    const room = createChatRoom({ name: 'fleet-room', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@alpha', agentDisplayName: 'Alpha' });
    attachTerminal('@alpha', room.id, 'sess-alpha');
    setLiveSessions(['sess-alpha']);

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
      // attachTerminal defaults agent_status='idle' / agent_status_at_ms=0
      // so a freshly-bound terminal surfaces as idle, never null.
      status: { state: 'idle', atMs: 0 },
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

  it('reuses the live tmux session lookup briefly across fleet reads', async () => {
    const room = createChatRoom({ name: 'cache-room', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@alpha', agentDisplayName: 'Alpha' });
    attachTerminal('@alpha', room.id, 'sess-alpha');
    setLiveSessions(['sess-alpha']);

    const first = await (await GET(req('http://x/api/agents?view=fleet'))).json();
    setLiveSessions([]);
    const second = await (await GET(req('http://x/api/agents?view=fleet'))).json();

    expect(listTerminalsCallCount).toBe(1);
    expect(first.agents[0]).toMatchObject({
      handle: '@alpha',
      sessionId: 'sess-alpha',
      status: { state: 'idle', atMs: 0 }
    });
    expect(second.agents[0]).toMatchObject({
      handle: '@alpha',
      sessionId: 'sess-alpha',
      status: { state: 'idle', atMs: 0 }
    });
  });

  it('aggregates messages, reactions, tasks, plans, and open asks per handle', async () => {
    const room = createChatRoom({ name: 'busy-room', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@alpha', agentDisplayName: 'Alpha' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@beta', agentDisplayName: 'Beta' });
    attachTerminal('@alpha', room.id, 'sess-alpha');
    attachTerminal('@beta', room.id, 'sess-beta');
    setLiveSessions(['sess-alpha', 'sess-beta']);

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

  it('falls back to terminal-less offline cards when a room agent has no live tmux session', async () => {
    const room = createChatRoom({ name: 'mixed-room', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@live', agentDisplayName: 'Live' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@archived', agentDisplayName: 'Archived' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@detached', agentDisplayName: 'Detached' });

    attachTerminal('@live', room.id, 'sess-live');
    attachTerminal('@archived', room.id, 'sess-archived');
    // @detached has no terminal row at all.
    // Only sess-live is in the live tmux set — @archived's tmux pane has
    // been killed, so its terminal_records row is offline / archived.
    setLiveSessions(['sess-live']);

    const res = await GET(req('http://x/api/agents?view=fleet'));
    const body = await res.json();
    expect(body.agents.map((a: { handle: string }) => a.handle)).toEqual(['@live', '@archived', '@detached']);
    expect(body.agents.find((a: { handle: string }) => a.handle === '@live')).toMatchObject({
      sessionId: 'sess-live',
      status: { state: 'idle', atMs: 0 }
    });
    expect(body.agents.find((a: { handle: string }) => a.handle === '@archived')).toMatchObject({
      sessionId: '',
      status: { state: 'offline' }
    });
    expect(body.agents.find((a: { handle: string }) => a.handle === '@detached')).toMatchObject({
      sessionId: '',
      status: { state: 'offline' }
    });
  });

  it("surfaces the live terminal's agent_status as the agent's current state", async () => {
    const room = createChatRoom({ name: 'status-room', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@worker', agentDisplayName: 'Worker' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@thinker', agentDisplayName: 'Thinker' });
    attachTerminal('@worker', room.id, 'sess-worker', { agentStatus: 'working', agentStatusAtMs: 5000 });
    attachTerminal('@thinker', room.id, 'sess-thinker', { agentStatus: 'thinking', agentStatusAtMs: 6000 });
    setLiveSessions(['sess-worker', 'sess-thinker']);

    const res = await GET(req('http://x/api/agents?view=fleet'));
    const body = await res.json();
    const worker = body.agents.find((a: { handle: string }) => a.handle === '@worker');
    const thinker = body.agents.find((a: { handle: string }) => a.handle === '@thinker');
    expect(worker.status).toEqual({ state: 'working', atMs: 5000 });
    expect(thinker.status).toEqual({ state: 'thinking', atMs: 6000 });
  });

  it('drops an expired terminal card even when tmux still claims it, then shows the room agent offline', async () => {
    const room = createChatRoom({ name: 'expiry-room', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@expired', agentDisplayName: 'Expired' });
    attachTerminal('@expired', room.id, 'sess-exp', { expiresAt: 1 });
    setLiveSessions(['sess-exp']);

    const res = await GET(req('http://x/api/agents?view=fleet'));
    const body = await res.json();
    expect(body.agents).toEqual([
      expect.objectContaining({
        handle: '@expired',
        sessionId: '',
        status: expect.objectContaining({ state: 'offline' })
      })
    ]);
  });
});
