import { beforeEach, describe, expect, it, vi } from 'vitest';

const broadcast = vi.fn();

vi.mock('../src/lib/server/ws-broadcast.js', () => ({
  broadcast,
}));

const { POST } = await import('../src/routes/api/sessions/[id]/typing/+server.js');

function postEvent(body: unknown, id = 'sess-typing') {
  return {
    params: { id },
    request: new Request(`https://ant.test/api/sessions/${id}/typing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  } as any;
}

describe('/api/sessions/:id/typing', () => {
  beforeEach(() => {
    broadcast.mockReset();
  });

  it('broadcasts a trimmed handle and boolean typing flag', async () => {
    const response = await POST(postEvent({
      handle: '  @evolveantcodex  ',
      typing: true,
    }, 'room-a'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledWith('room-a', {
      type: 'typing',
      handle: '@evolveantcodex',
      typing: true,
    });
  });

  it('rejects malformed JSON, missing handles, and non-boolean typing flags', async () => {
    const invalidJson = await POST(postEvent('{'));
    expect(invalidJson.status).toBe(400);
    expect(await invalidJson.json()).toEqual({ error: 'Invalid JSON' });

    for (const body of [{ typing: true }, { handle: '   ', typing: true }]) {
      const response = await POST(postEvent(body));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'handle is required' });
    }

    for (const typing of ['true', 1, null]) {
      const response = await POST(postEvent({ handle: '@codex', typing }));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'typing must be boolean' });
    }
    expect(broadcast).not.toHaveBeenCalled();
  });
});
