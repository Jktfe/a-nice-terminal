import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  listAgents,
  getAgent,
  updateAgentMetadata,
  resetAgentRegistryStoreForTests,
} from './agentRegistryStore';
import {
  createChatRoom,
  inviteAgentToRoom,
  resetChatRoomStoreForTests,
} from './chatRoomStore';

describe('agentRegistryStore', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
    resetAgentRegistryStoreForTests();
  });
  afterEach(() => {
    resetChatRoomStoreForTests();
    resetAgentRegistryStoreForTests();
  });

  function seedRoom(name: string) {
    return createChatRoom({
      name,
      
      whoCreatedIt: '@seed',
      
    });
  }

  it('listAgents returns empty when no agents exist', () => {
    const agents = listAgents();
    expect(agents).toEqual([]);
  });

  it('listAgents returns agents across all rooms', () => {
    const r1 = seedRoom('room-one');
    const r2 = seedRoom('room-two');
    inviteAgentToRoom({ roomId: r1.id, agentHandle: '@alpha', agentDisplayName: 'Alpha' });
    inviteAgentToRoom({ roomId: r2.id, agentHandle: '@alpha', agentDisplayName: 'Alpha' });
    inviteAgentToRoom({ roomId: r1.id, agentHandle: '@beta', agentDisplayName: 'Beta' });

    const agents = listAgents();
    expect(agents).toHaveLength(2);
    expect(agents.map((a) => a.handle)).toContain('@alpha');
    expect(agents.map((a) => a.handle)).toContain('@beta');

    const alpha = agents.find((a) => a.handle === '@alpha')!;
    expect(alpha.rooms).toHaveLength(2);
    expect(alpha.displayName).toBe('Alpha');
  });

  it('listAgents filters by roomId', () => {
    const r1 = seedRoom('room-one');
    const r2 = seedRoom('room-two');
    inviteAgentToRoom({ roomId: r1.id, agentHandle: '@alpha', agentDisplayName: 'Alpha' });
    inviteAgentToRoom({ roomId: r2.id, agentHandle: '@beta', agentDisplayName: 'Beta' });

    const agentsR1 = listAgents(r1.id);
    expect(agentsR1).toHaveLength(1);
    expect(agentsR1[0].handle).toBe('@alpha');

    const agentsR2 = listAgents(r2.id);
    expect(agentsR2).toHaveLength(1);
    expect(agentsR2[0].handle).toBe('@beta');
  });

  it('getAgent returns null for unknown handle', () => {
    expect(getAgent('@ghost')).toBeNull();
  });

  it('getAgent returns agent with room memberships', () => {
    const r1 = seedRoom('room-one');
    inviteAgentToRoom({ roomId: r1.id, agentHandle: '@alpha', agentDisplayName: 'Alpha' });

    const agent = getAgent('@alpha');
    expect(agent).not.toBeNull();
    expect(agent!.handle).toBe('@alpha');
    expect(agent!.displayName).toBe('Alpha');
    expect(agent!.rooms).toHaveLength(1);
    expect(agent!.rooms[0].roomId).toBe(r1.id);
  });

  it('updateAgentMetadata patches display fields globally', () => {
    const r1 = seedRoom('room-one');
    const r2 = seedRoom('room-two');
    inviteAgentToRoom({ roomId: r1.id, agentHandle: '@alpha', agentDisplayName: 'Alpha' });
    inviteAgentToRoom({ roomId: r2.id, agentHandle: '@alpha', agentDisplayName: 'Alpha' });

    const ok = updateAgentMetadata('@alpha', {
      displayColor: '#ff0000',
      displayIcon: '🤖',
      displayBackgroundStyle: 'tint',
    });
    expect(ok).toBe(true);

    const agent = getAgent('@alpha');
    expect(agent!.displayColor).toBe('#ff0000');
    expect(agent!.displayIcon).toBe('🤖');
    expect(agent!.displayBackgroundStyle).toBe('tint');
  });
});
