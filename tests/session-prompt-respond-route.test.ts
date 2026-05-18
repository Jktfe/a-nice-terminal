import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import getDb, { _resetForTest, queries } from '../src/lib/server/db.js';
import {
  DEFAULT_PROMPT_BRIDGE_CONFIG,
  disposePromptBridge,
  feedPromptBridge,
  initPromptBridge,
  setPromptBridgeConfig,
} from '../src/lib/server/prompt-bridge.js';

const { POST } = await import('../src/routes/api/sessions/[id]/prompt-bridge/respond/+server.js');

let dataDir = '';
let originalDataDir: string | undefined;
const writes: Array<{ sessionId: string; data: string }> = [];

function respondEvent(id: string, body: unknown) {
  return {
    params: { id },
    request: new Request(`https://ant.test/api/sessions/${id}/prompt-bridge/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  } as any;
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

describe('/api/sessions/:id/prompt-bridge/respond', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-prompt-respond-'));
    process.env.ANT_DATA_DIR = dataDir;
    _resetForTest();
    getDb();
    writes.length = 0;
    queries.createSession('terminal-a', 'Terminal A', 'terminal', 'forever', null, null, '{}');
    queries.createSession('room-a', 'Room A', 'chat', 'forever', null, null, '{}');
    queries.createSession('archived-a', 'Archived A', 'terminal', 'forever', null, null, '{}');
    queries.createSession('deleted-a', 'Deleted A', 'terminal', 'forever', null, null, '{}');
    queries.setCliFlag('terminal-a', 'codex-cli');
    queries.setCliFlag('archived-a', 'codex-cli');
    queries.setCliFlag('deleted-a', 'codex-cli');
    queries.archiveSession('archived-a');
    queries.softDeleteSession('deleted-a');
    setPromptBridgeConfig({
      ...DEFAULT_PROMPT_BRIDGE_CONFIG,
      enabled: true,
      detect: {
        ...DEFAULT_PROMPT_BRIDGE_CONFIG.detect,
        min_interval_ms: 1,
      },
    });
    initPromptBridge({
      getSession: (id: string) => queries.getSession(id),
      postToChat: () => {},
      writeToTerminal: (sessionId, data) => { writes.push({ sessionId, data }); },
      broadcastGlobal: () => {},
      appendRunEvent: () => {},
    });
  });

  afterEach(() => {
    for (const id of ['terminal-a', 'room-a', 'archived-a', 'deleted-a']) {
      disposePromptBridge(id);
    }
    setPromptBridgeConfig(DEFAULT_PROMPT_BRIDGE_CONFIG);
    _resetForTest();
    if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
    else process.env.ANT_DATA_DIR = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('writes response text to an active terminal and returns resolved prompt payload', async () => {
    await feedPromptBridge('terminal-a', 'Do you want to continue?');

    const response = await POST(respondEvent('terminal-a', { response: 'yes', enter: false }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(writes).toEqual([{ sessionId: 'terminal-a', data: 'yes' }]);
    expect(body).toMatchObject({
      ok: true,
      prompt: {
        terminal_id: 'terminal-a',
        raw_text: 'Do you want to continue?',
        status: 'responded',
      },
    });
  });

  it('accepts text fallback and rejects invalid JSON or empty text', async () => {
    const malformed = await POST(respondEvent('terminal-a', '{'));
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ ok: false, error: 'Invalid JSON' });

    const empty = await POST(respondEvent('terminal-a', { text: '   ' }));
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({ ok: false, error: 'text must be a non-empty string' });

    const validText = await POST(respondEvent('terminal-a', { text: 'fallback', enter: false }));
    expect(validText.status).toBe(200);
    expect(writes.at(-1)).toEqual({ sessionId: 'terminal-a', data: 'fallback' });
  });

  it('rejects missing, non-terminal, and inactive sessions before writing', async () => {
    await expectHttpError(() => POST(respondEvent('missing', { text: 'yes' })), 404);
    await expectHttpError(() => POST(respondEvent('room-a', { text: 'yes' })), 400);
    await expectHttpError(() => POST(respondEvent('archived-a', { text: 'yes' })), 410);
    await expectHttpError(() => POST(respondEvent('deleted-a', { text: 'yes' })), 410);
    expect(writes).toEqual([]);
  });
});
