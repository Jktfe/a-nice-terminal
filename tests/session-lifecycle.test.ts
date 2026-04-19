import { describe, it, expect } from 'vitest';

const BASE = process.env.ANT_TEST_URL || 'https://localhost:6458';
const API_KEY = process.env.ANT_API_KEY || '';
const headers: Record<string, string> = {
  'Content-Type': 'application/json',
  ...(API_KEY ? { 'x-api-key': API_KEY } : {}),
};

// Skip integration tests in CI (no live server) unless ANT_TEST_URL is set
const hasServer = !!process.env.ANT_TEST_URL;
const describeIntegration = hasServer ? describe : describe.skip;

describeIntegration('session lifecycle', () => {
  it('creates a session and posts a message', async () => {
    // Create a chat session
    const res = await fetch(`${BASE}/api/sessions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: `test-${Date.now()}`, type: 'chat', ttl: '15m' }),
    });
    expect(res.ok).toBe(true);
    const session = await res.json();
    expect(session.id).toBeTruthy();
    expect(session.type).toBe('chat');

    // Post a message to the session
    const msgRes = await fetch(`${BASE}/api/sessions/${session.id}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ role: 'user', content: 'hello from vitest', format: 'text' }),
    });
    expect(msgRes.ok).toBe(true);
    const msg = await msgRes.json();
    expect(msg.id).toBeTruthy();
    expect(msg.content).toBe('hello from vitest');

    const replyRes = await fetch(`${BASE}/api/sessions/${session.id}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        role: 'user',
        content: 'threaded reply from vitest',
        format: 'text',
        reply_to: msg.id,
      }),
    });
    expect(replyRes.ok).toBe(true);
    const reply = await replyRes.json();
    expect(reply.reply_to).toBe(msg.id);

    // Verify the message appears in the session
    const readRes = await fetch(`${BASE}/api/sessions/${session.id}/messages`, { headers });
    expect(readRes.ok).toBe(true);
    const data = await readRes.json();
    const messages = data.messages || data;
    expect(messages.some((m: any) => m.content === 'hello from vitest')).toBe(true);
    expect(messages.some((m: any) => m.content === 'threaded reply from vitest' && m.reply_to === msg.id)).toBe(true);

    // Clean up
    await fetch(`${BASE}/api/sessions/${session.id}?hard=true`, { method: 'DELETE', headers });
  });
});
