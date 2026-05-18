import { describe, expect, it, vi } from 'vitest';

const getPresence = vi.fn();

vi.mock('$lib/server/ws-broadcast', () => ({
  getPresence,
}));

const { GET } = await import('../src/routes/api/presence/[sessionId]/+server.js');

function getEvent(sessionId: string) {
  return {
    params: { sessionId },
  } as any;
}

describe('/api/presence/:sessionId', () => {
  it('returns the presence map from the websocket registry', async () => {
    getPresence.mockReturnValueOnce({
      '@you': { lastSeen: 123, status: 'active' },
      '@evolveantcodex': { lastSeen: 100, status: 'idle' },
    });

    const response = await GET(getEvent('room-123'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      presence: {
        '@you': { lastSeen: 123, status: 'active' },
        '@evolveantcodex': { lastSeen: 100, status: 'idle' },
      },
    });
    expect(getPresence).toHaveBeenCalledWith('room-123');
  });

  it('returns an empty presence object for sessions with no websocket clients', async () => {
    getPresence.mockReturnValueOnce({});

    const response = await GET(getEvent('missing-or-offline'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ presence: {} });
    expect(getPresence).toHaveBeenCalledWith('missing-or-offline');
  });
});
