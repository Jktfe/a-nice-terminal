import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '$lib/server/db';
import {
  createChatRoom,
  inviteAgentToRoom,
  resetChatRoomStoreForTests,
} from '$lib/server/chatRoomStore';
import { resetFocusModeStoreForTests } from '$lib/server/focusModeStore';
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
});
