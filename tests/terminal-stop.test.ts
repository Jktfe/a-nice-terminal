import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import getDb, { queries } from '../src/lib/server/db.js';

const TEST_TERMINAL = 'terminal-stop-test-terminal';
const TEST_CHAT = 'terminal-stop-test-chat';

const writes: Array<{ id: string; data: string }> = [];
const broadcasts: Array<{ id: string; message: any }> = [];

vi.mock('$lib/server/pty-client.js', () => ({
  ptyClient: {
    write: (id: string, data: string) => {
      writes.push({ id, data });
    },
  },
}));

vi.mock('$lib/server/ws-broadcast.js', () => ({
  broadcast: (id: string, message: any) => {
    broadcasts.push({ id, message });
  },
}));

const { POST } = await import('../src/routes/api/sessions/[id]/terminal/stop/+server.js');

function resetSessions() {
  const db = getDb();
  db.prepare('DELETE FROM run_events WHERE session_id IN (?, ?)').run(TEST_TERMINAL, TEST_CHAT);
  db.prepare('DELETE FROM sessions WHERE id IN (?, ?)').run(TEST_TERMINAL, TEST_CHAT);
  queries.createSession(TEST_TERMINAL, 'Stop Test Terminal', 'terminal', 'forever', null, '/tmp/ant-stop-test', '{}');
  queries.createSession(TEST_CHAT, 'Stop Test Chat', 'chat', 'forever', null, '/tmp/ant-stop-test', '{}');
}

describe('terminal stop endpoint', () => {
  beforeEach(() => {
    writes.length = 0;
    broadcasts.length = 0;
    resetSessions();
  });

  afterAll(() => {
    const db = getDb();
    db.prepare('DELETE FROM run_events WHERE session_id IN (?, ?)').run(TEST_TERMINAL, TEST_CHAT);
    db.prepare('DELETE FROM sessions WHERE id IN (?, ?)').run(TEST_TERMINAL, TEST_CHAT);
  });

  it('sends a soft Ctrl-C interrupt and records an auditable status event', async () => {
    const response = await POST({
      params: { id: TEST_TERMINAL },
      request: new Request('https://ant.example.test/api/sessions/terminal-stop-test-terminal/terminal/stop', {
        method: 'POST',
        body: JSON.stringify({ reason: 'mistyped command', requested_by: 'web' }),
      }),
      locals: {},
    } as Parameters<typeof POST>[0]);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, action: 'interrupt', key: 'ctrl-c' });
    expect(writes).toEqual([{ id: TEST_TERMINAL, data: '\x03' }]);
    expect(body.event).toMatchObject({
      session_id: TEST_TERMINAL,
      source: 'status',
      trust: 'high',
      kind: 'terminal_stop',
      payload: {
        action: 'interrupt',
        key: 'ctrl-c',
        requested_by: 'web',
        reason: 'mistyped command',
      },
    });
    expect(broadcasts[0]).toMatchObject({
      id: TEST_TERMINAL,
      message: {
        type: 'run_event_created',
        sessionId: TEST_TERMINAL,
        event: { kind: 'terminal_stop' },
      },
    });
  });

  it('does not send interrupts to non-terminal sessions', async () => {
    const response = await POST({
      params: { id: TEST_CHAT },
      request: new Request('https://ant.example.test/api/sessions/terminal-stop-test-chat/terminal/stop', {
        method: 'POST',
        body: JSON.stringify({ requested_by: 'web' }),
      }),
      locals: {},
    } as Parameters<typeof POST>[0]);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.ok).toBe(false);
    expect(writes).toEqual([]);
    expect(broadcasts).toEqual([]);
  });
});
