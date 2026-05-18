import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import getDb, { _resetForTest, queries } from '../src/lib/server/db.js';

const TEST_TERMINAL = 'terminal-stop-test-terminal';
const TEST_CHAT = 'terminal-stop-test-chat';
const TEST_ARCHIVED = 'terminal-stop-test-archived';

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

let dataDir = '';
let originalDataDir: string | undefined;

function stopEvent(id: string, body: unknown, locals: Record<string, unknown> = {}) {
  return {
    params: { id },
    request: new Request(`https://ant.example.test/api/sessions/${id}/terminal/stop`, {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    locals,
  } as unknown as Parameters<typeof POST>[0];
}

function resetSessions() {
  queries.createSession(TEST_TERMINAL, 'Stop Test Terminal', 'terminal', 'forever', null, '/tmp/ant-stop-test', '{}');
  queries.createSession(TEST_CHAT, 'Stop Test Chat', 'chat', 'forever', null, '/tmp/ant-stop-test', '{}');
  queries.createSession(TEST_ARCHIVED, 'Archived Stop Test Terminal', 'terminal', 'forever', null, '/tmp/ant-stop-test', '{}');
  queries.updateSession(null, null, 1, null, TEST_ARCHIVED);
}

async function expectHttpError(action: () => unknown | Promise<unknown>, status: number) {
  try {
    await action();
  } catch (err) {
    expect(err).toMatchObject({ status });
    return;
  }
  throw new Error(`Expected HTTP ${status}`);
}

describe('terminal stop endpoint', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-terminal-stop-'));
    process.env.ANT_DATA_DIR = dataDir;
    _resetForTest();
    getDb();
    writes.length = 0;
    broadcasts.length = 0;
    resetSessions();
  });

  afterEach(() => {
    _resetForTest();
    if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
    else process.env.ANT_DATA_DIR = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('sends a soft Ctrl-C interrupt and records an auditable status event', async () => {
    const response = await POST(stopEvent(TEST_TERMINAL, { reason: 'mistyped command', requested_by: 'web' }));
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
    const response = await POST(stopEvent(TEST_CHAT, { requested_by: 'web' }));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.ok).toBe(false);
    expect(writes).toEqual([]);
    expect(broadcasts).toEqual([]);
  });

  it('rejects missing and inactive terminal sessions without side effects', async () => {
    const missing = await POST(stopEvent('missing-terminal', { requested_by: 'web' }));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ ok: false, error: 'terminal session not found' });

    const archived = await POST(stopEvent(TEST_ARCHIVED, { requested_by: 'web' }));
    expect(archived.status).toBe(410);
    expect(await archived.json()).toEqual({ ok: false, error: 'terminal session is inactive' });

    expect(writes).toEqual([]);
    expect(broadcasts).toEqual([]);
  });

  it('defaults malformed JSON and blank requester safely while trimming reason text', async () => {
    const response = await POST(stopEvent(TEST_TERMINAL, '{'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.event.payload).toMatchObject({
      requested_by: 'web',
      reason: null,
    });

    writes.length = 0;
    broadcasts.length = 0;
    const blankRequester = await POST(stopEvent(TEST_TERMINAL, {
      reason: '  operator check  ',
      requested_by: '   ',
    }));
    const blankBody = await blankRequester.json();

    expect(blankRequester.status).toBe(200);
    expect(blankBody.event.payload).toMatchObject({
      requested_by: 'web',
      reason: 'operator check',
    });
  });

  it('rejects room-scoped callers before sending PTY input', async () => {
    await expectHttpError(
      () => POST(stopEvent(TEST_TERMINAL, { requested_by: 'web' }, { roomScope: { roomId: TEST_TERMINAL, kind: 'cli' } })),
      403,
    );

    expect(writes).toEqual([]);
    expect(broadcasts).toEqual([]);
  });
});
