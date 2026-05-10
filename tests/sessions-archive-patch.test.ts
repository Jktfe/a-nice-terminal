import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { _resetForTest, queries } from '../src/lib/server/db.js';
import { buildAutoLinkedChatMeta } from '../src/lib/server/linked-chat.js';

const TERMINAL_ID = 'archive-patch-terminal';
const CHAT_ID = 'archive-patch-chat';

const summaries: string[] = [];
const killed: string[] = [];
const disposed: string[] = [];
const broadcasts: Array<{ channel: string; message: any }> = [];

vi.mock('$lib/server/capture/obsidian-writer.js', () => ({
  maybeWriteSessionSummary: (id: string) => {
    summaries.push(id);
  },
}));

vi.mock('$lib/server/pty-client.js', () => ({
  ptyClient: {
    kill: (id: string) => {
      killed.push(id);
    },
  },
}));

vi.mock('$lib/server/session-lifecycle.js', () => ({
  disposeSessionState: async (id: string) => {
    disposed.push(id);
  },
}));

vi.mock('$lib/server/ws-broadcast.js', () => ({
  broadcast: (channel: string, message: any) => {
    broadcasts.push({ channel, message });
  },
}));

vi.mock('$lib/server/capture/registry-writer.js', () => ({
  scheduleRegistryUpdate: () => {},
}));

const { PATCH: patchSession } = await import('../src/routes/api/sessions/[id]/+server.js');

let dataDir = '';
let originalDataDir: string | undefined;

function patchEvent(sessionId: string, body: Record<string, unknown>) {
  return {
    params: { id: sessionId },
    request: new Request(`https://ant.test/api/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    locals: {},
  } as any;
}

describe('PATCH /api/sessions/:id - archive', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-session-archive-patch-'));
    process.env.ANT_DATA_DIR = dataDir;
    _resetForTest();
    summaries.length = 0;
    killed.length = 0;
    disposed.length = 0;
    broadcasts.length = 0;

    queries.createSession(TERMINAL_ID, 'Archive Patch Terminal', 'terminal', 'forever', null, null, '{}');
    queries.createSession(
      CHAT_ID,
      'Archive Patch Terminal Chat',
      'chat',
      'forever',
      null,
      null,
      JSON.stringify(buildAutoLinkedChatMeta(TERMINAL_ID)),
    );
    queries.setLinkedChat(TERMINAL_ID, CHAT_ID);
  });

  afterEach(() => {
    _resetForTest();
    if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
    else process.env.ANT_DATA_DIR = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('treats numeric iOS archive payloads like boolean archive payloads', async () => {
    const response = await patchSession(patchEvent(TERMINAL_ID, { archived: 1 }));

    expect(response.status).toBe(200);
    expect((queries.getSession(TERMINAL_ID) as any)?.archived).toBe(1);
    expect((queries.getSession(CHAT_ID) as any)?.archived).toBe(1);
    expect(summaries).toEqual(expect.arrayContaining([TERMINAL_ID, CHAT_ID]));
    expect(killed).toEqual([TERMINAL_ID]);
    expect(disposed.sort()).toEqual([CHAT_ID, TERMINAL_ID].sort());
    expect(broadcasts).toEqual([
      {
        channel: '__ant_sessions__',
        message: {
          type: 'sessions_changed',
          removedIds: expect.arrayContaining([TERMINAL_ID, CHAT_ID]),
        },
      },
    ]);
  });
});
