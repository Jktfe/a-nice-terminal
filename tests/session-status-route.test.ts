import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import getDb, { _resetForTest, queries } from '../src/lib/server/db.js';

const getPendingEvent = vi.fn();
const refreshStatusFromCapture = vi.fn();
const getPendingPrompt = vi.fn();
const promptNeedsInput = vi.fn();

vi.mock('$lib/server/agent-event-bus.js', () => ({
  getPendingEvent,
  refreshStatusFromCapture,
}));

vi.mock('$lib/server/prompt-bridge.js', () => ({
  getPendingPrompt,
  promptNeedsInput,
}));

const { GET } = await import('../src/routes/api/sessions/[id]/status/+server.js');

let dataDir = '';
let originalDataDir: string | undefined;

function statusEvent(id: string, locals: Record<string, unknown> = {}) {
  return { params: { id }, locals } as any;
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

describe('/api/sessions/:id/status', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-session-status-'));
    process.env.ANT_DATA_DIR = dataDir;
    _resetForTest();
    getDb();
    getPendingEvent.mockReset();
    getPendingEvent.mockReturnValue({ needs_input: false, agent_status: undefined });
    refreshStatusFromCapture.mockReset();
    getPendingPrompt.mockReset();
    getPendingPrompt.mockReturnValue(null);
    promptNeedsInput.mockReset();

    queries.createSession('terminal', 'Terminal', 'terminal', 'forever', null, null, '{}');
    queries.createSession('room-b', 'Room B', 'chat', 'forever', null, null, '{}');
    queries.createSession('archived', 'Archived', 'terminal', 'forever', null, null, '{}');
    queries.createSession('deleted', 'Deleted', 'terminal', 'forever', null, null, '{}');
    queries.archiveSession('archived');
    queries.softDeleteSession('deleted');
  });

  afterEach(() => {
    _resetForTest();
    if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
    else process.env.ANT_DATA_DIR = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('returns terminal status projection for active sessions', async () => {
    const response = await GET(statusEvent('terminal'));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      needs_input: false,
      session: { id: 'terminal', type: 'terminal' },
      terminal: { id: 'terminal', type: 'terminal' },
      route: {
        mode: 'terminal',
        terminal_id: 'terminal',
        linked_chat_id: null,
        executes_in_terminal: false,
      },
    });
  });

  it('rejects cross-room scoped tokens, missing sessions, and inactive sessions', async () => {
    await expectHttpError(() => GET(statusEvent('terminal', {
      roomScope: { roomId: 'room-b', kind: 'cli' },
    })), 403);
    await expectHttpError(() => GET(statusEvent('missing')), 404);
    await expectHttpError(() => GET(statusEvent('archived')), 410);
    await expectHttpError(() => GET(statusEvent('deleted')), 410);
  });
});
