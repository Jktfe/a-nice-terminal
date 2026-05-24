import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '$lib/server/db';
import {
  createChatRoom,
  inviteAgentToRoom,
  resetChatRoomStoreForTests,
} from '$lib/server/chatRoomStore';
import { resetFocusModeStoreForTests } from '$lib/server/focusModeStore';
import { addMembership } from '$lib/server/roomMembershipsStore';
import {
  setAgentContextFill,
  upsertTerminal,
} from '$lib/server/terminalsStore';
import { GET } from './+server';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
  resetFocusModeStoreForTests();
});

afterEach(() => {
  resetFocusModeStoreForTests();
  resetChatRoomStoreForTests();
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
});

function req(url: string): Parameters<typeof GET>[0] {
  return { url: new URL(url) } as Parameters<typeof GET>[0];
}

describe('GET /api/agents/availability', () => {
  it('returns the fleet roster + summary in a single response', async () => {
    const room = createChatRoom({ name: 'users', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@evolveantclaude', agentDisplayName: 'C' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@codexlead1', agentDisplayName: 'X' });

    const res = await GET(req('http://x/api/agents/availability'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agents).toHaveLength(2);
    expect(body.summary.total).toBe(2);
    expect(body.summary.inRoom).toBe(2);
    // Default sort by handle.
    expect(body.agents[0].handle).toBe('@codexlead1');
    expect(body.agents[0].model).toBe('codex');
  });

  it('passes ?model through to the store filter', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@evolveantclaude', agentDisplayName: 'C' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@codexlead1', agentDisplayName: 'X' });

    const res = await GET(req('http://x/api/agents/availability?model=claude'));
    const body = await res.json();
    expect(body.agents.map((a: { handle: string }) => a.handle)).toEqual([
      '@evolveantclaude',
    ]);
  });

  it('passes ?skill through to the store filter', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@codexlead1', agentDisplayName: 'X' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@uxant', agentDisplayName: 'U' });

    const res = await GET(req('http://x/api/agents/availability?skill=ux'));
    const body = await res.json();
    expect(body.agents.map((a: { handle: string }) => a.handle)).toEqual(['@uxant']);
  });

  it('passes ?roomId through to the store filter', async () => {
    const r1 = createChatRoom({ name: 'r1', whoCreatedIt: '@you' });
    const r2 = createChatRoom({ name: 'r2', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: r1.id, agentHandle: '@evolveantclaude', agentDisplayName: 'C' });
    inviteAgentToRoom({ roomId: r2.id, agentHandle: '@codexlead1', agentDisplayName: 'X' });

    const res = await GET(req(`http://x/api/agents/availability?roomId=${r1.id}`));
    const body = await res.json();
    expect(body.agents.map((a: { handle: string }) => a.handle)).toEqual([
      '@evolveantclaude',
    ]);
  });

  it('defaults to alive=true (hides archived-only handles) and widens with ?alive=false', async () => {
    const room = createChatRoom({ name: 'live', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@evolveantclaude', agentDisplayName: 'C' });

    const def = await (await GET(req('http://x/api/agents/availability'))).json();
    expect(def.agents.map((a: { handle: string }) => a.handle)).toEqual([
      '@evolveantclaude',
    ]);

    // alive=false with no archived handles in the fixture = empty result.
    const audit = await (
      await GET(req('http://x/api/agents/availability?alive=false'))
    ).json();
    expect(audit.agents).toEqual([]);
  });

  it('returns fresh per-agent context-fill and hides stale readings', async () => {
    const nowMs = Date.now();
    const room = createChatRoom({ name: 'context-room', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@codexlead1', agentDisplayName: 'X' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@evolveantclaude', agentDisplayName: 'C' });

    const codexTerminal = upsertTerminal({
      pid: 44_001,
      pid_start: 'context-fill-fresh',
      name: 'context-fill-fresh',
      ttlSeconds: 60 * 60,
    });
    const claudeTerminal = upsertTerminal({
      pid: 44_002,
      pid_start: 'context-fill-stale',
      name: 'context-fill-stale',
      ttlSeconds: 60 * 60,
    });
    addMembership({ room_id: room.id, handle: '@codexlead1', terminal_id: codexTerminal.id });
    addMembership({ room_id: room.id, handle: '@evolveantclaude', terminal_id: claudeTerminal.id });
    setAgentContextFill(codexTerminal.id, 0.72, 'codex-test-probe', nowMs - 30_000);
    setAgentContextFill(claudeTerminal.id, 0.91, 'claude-test-probe', nowMs - 10 * 60 * 1000);

    const res = await GET(req('http://x/api/agents/availability'));
    const body = await res.json();
    const byHandle = Object.fromEntries(
      body.agents.map((agent: { handle: string; contextFill?: unknown }) => [agent.handle, agent])
    ) as Record<string, { contextFill?: unknown }>;

    expect(byHandle['@codexlead1'].contextFill).toBeCloseTo(0.72);
    expect(byHandle['@evolveantclaude'].contextFill).toBeNull();
  });
});
