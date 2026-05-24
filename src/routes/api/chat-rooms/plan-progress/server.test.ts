import { describe, it, expect } from 'vitest';

describe('/api/chat-rooms/plan-progress', () => {
  it('endpoint file exists and exports GET', async () => {
    const mod = await import('./+server');
    expect(typeof mod.GET).toBe('function');
  });
});
