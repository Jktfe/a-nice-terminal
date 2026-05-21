import { describe, expect, it } from 'vitest';
import { activeAgents, preparedQuestion, roomsNeedingAttention, sessionTracker } from './antFixture';

describe('ANT vNext fixture data', () => {
  it('keeps the first prepared question readable', () => {
    expect(preparedQuestion.question).toContain('bind');
    expect(preparedQuestion.options).toHaveLength(3);
    expect(preparedQuestion.recommendedOption).toBe('B');
  });

  it('names rooms and agents in plain English', () => {
    expect(roomsNeedingAttention.every((room) => room.name.length > 0)).toBe(true);
    expect(activeAgents.every((agent) => agent.role.includes(' ') || agent.role === 'working')).toBe(true);
  });

  it('treats every agent as a model and cost profile', () => {
    expect(activeAgents.every((agent) => agent.agentModel.modelName.length > 0)).toBe(true);
    expect(activeAgents.every((agent) => agent.tokenCountForThisSession > 0)).toBe(true);
  });

  it('keeps the session tracker separate from normal participants', () => {
    expect(activeAgents.find((agent) => agent.id === sessionTracker.id)).toBeUndefined();
    expect(sessionTracker.agentModel.modelName.length).toBeGreaterThan(0);
  });
});
