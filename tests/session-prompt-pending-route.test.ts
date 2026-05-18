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

const { GET } = await import('../src/routes/api/sessions/[id]/prompt-bridge/pending/+server.js');

let dataDir = '';
let originalDataDir: string | undefined;

function pendingEvent(id: string, locals = {}) {
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

describe('/api/sessions/:id/prompt-bridge/pending', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-prompt-pending-'));
    process.env.ANT_DATA_DIR = dataDir;
    _resetForTest();
    getDb();
    queries.createSession('terminal-a', 'Terminal A', 'terminal', 'forever', null, null, '{}');
    queries.createSession('terminal-empty', 'Terminal Empty', 'terminal', 'forever', null, null, '{}');
    queries.createSession('room-a', 'Room A', 'chat', 'forever', null, null, '{}');
    queries.createSession('archived-a', 'Archived A', 'terminal', 'forever', null, null, '{}');
    queries.createSession('deleted-a', 'Deleted A', 'terminal', 'forever', null, null, '{}');
    queries.setCliFlag('terminal-a', 'codex-cli');
    queries.setCliFlag('terminal-empty', 'codex-cli');
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
      writeToTerminal: () => {},
      broadcastGlobal: () => {},
      appendRunEvent: () => {},
    });
  });

  afterEach(() => {
    for (const id of ['terminal-a', 'terminal-empty', 'room-a', 'archived-a', 'deleted-a']) {
      disposePromptBridge(id);
    }
    setPromptBridgeConfig(DEFAULT_PROMPT_BRIDGE_CONFIG);
    _resetForTest();
    if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
    else process.env.ANT_DATA_DIR = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('returns the pending prompt for an active terminal session', async () => {
    await feedPromptBridge('terminal-a', 'Do you want to continue?');

    const response = await GET(pendingEvent('terminal-a'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.pending).toMatchObject({
      type: 'prompt_detected',
      terminal_id: 'terminal-a',
      session_id: 'terminal-a',
      raw_text: 'Do you want to continue?',
      status: 'pending',
    });
  });

  it('returns null pending state for an active terminal without a detected prompt', async () => {
    const response = await GET(pendingEvent('terminal-empty'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ pending: null });
  });

  it('rejects missing, non-terminal, and inactive sessions', async () => {
    await expectHttpError(() => GET(pendingEvent('missing')), 404);
    await expectHttpError(() => GET(pendingEvent('room-a')), 400);
    await expectHttpError(() => GET(pendingEvent('archived-a')), 410);
    await expectHttpError(() => GET(pendingEvent('deleted-a')), 410);
  });

  it('rejects cross-room scoped tokens before reading pending prompts', async () => {
    await feedPromptBridge('terminal-a', 'Do you want to continue?');

    await expectHttpError(
      () => GET(pendingEvent('terminal-a', { roomScope: { roomId: 'terminal-empty', kind: 'web' } })),
      403,
    );
  });
});
