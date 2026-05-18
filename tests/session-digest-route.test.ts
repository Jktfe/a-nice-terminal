import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import getDb, { _resetForTest, queries } from '../src/lib/server/db.js';

const { GET } = await import('../src/routes/api/sessions/[id]/digest/+server.js');

let dataDir = '';
let originalDataDir: string | undefined;

function digestEvent(id: string, locals = {}) {
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

describe('/api/sessions/:id/digest', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-session-digest-'));
    process.env.ANT_DATA_DIR = dataDir;
    _resetForTest();
    getDb();
    queries.createSession('room-a', 'Room A', 'chat', 'forever', null, null, '{}');
    queries.createSession('empty-room', 'Empty Room', 'chat', 'forever', null, null, '{}');
    queries.createSession('terminal-a', 'Terminal A', 'terminal', 'forever', null, null, '{}');
    queries.createSession('archived-a', 'Archived A', 'chat', 'forever', null, null, '{}');
    queries.createSession('deleted-a', 'Deleted A', 'chat', 'forever', null, null, '{}');
    queries.archiveSession('archived-a');
    queries.softDeleteSession('deleted-a');
    queries.createMessage('msg-a1', 'room-a', 'user', 'Telemetry telemetry dashboard activity', 'text', 'complete', '@you', null, null, 'message', '{}');
    queries.createMessage('msg-a2', 'room-a', 'assistant', 'Dashboard activity read receipts telemetry', 'text', 'complete', '@codex', null, null, 'message', '{}');
    queries.createMessage('msg-a3', 'room-a', 'assistant', 'Plans overview dashboard evidence', 'text', 'complete', '@codex', null, null, 'message', '{}');
    getDb().prepare(`UPDATE messages SET created_at = ? WHERE id = ?`).run('2026-05-18 10:00:00', 'msg-a1');
    getDb().prepare(`UPDATE messages SET created_at = ? WHERE id = ?`).run('2026-05-18 10:30:00', 'msg-a2');
    getDb().prepare(`UPDATE messages SET created_at = ? WHERE id = ?`).run('2026-05-18 11:00:00', 'msg-a3');
  });

  afterEach(() => {
    _resetForTest();
    if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
    else process.env.ANT_DATA_DIR = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('returns digest metrics, participants, key terms, and message span', async () => {
    const response = await GET(digestEvent('room-a'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      messageCount: 3,
      participantCount: 2,
      durationMinutes: 60,
      messagesPerHour: 3,
      participants: [
        { id: '@codex', count: 2 },
        { id: '@you', count: 1 },
      ],
      firstMessage: '2026-05-18 10:00:00',
      lastMessage: '2026-05-18 11:00:00',
    });
    expect(body.keyTerms).toEqual(expect.arrayContaining([
      { term: 'dashboard', count: 3 },
      { term: 'telemetry', count: 3 },
      { term: 'activity', count: 2 },
    ]));
  });

  it('returns zero metrics for an empty chat room', async () => {
    const response = await GET(digestEvent('empty-room'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      messageCount: 0,
      participantCount: 0,
      durationMinutes: 0,
      messagesPerHour: 0,
      participants: [],
      keyTerms: [],
      firstMessage: null,
      lastMessage: null,
    });
  });

  it('rejects missing, non-chat, and inactive sessions', async () => {
    await expectHttpError(() => GET(digestEvent('missing')), 404);
    await expectHttpError(() => GET(digestEvent('terminal-a')), 400);
    await expectHttpError(() => GET(digestEvent('archived-a')), 410);
    await expectHttpError(() => GET(digestEvent('deleted-a')), 410);
  });

  it('rejects cross-room scoped tokens before reading digest metrics', async () => {
    await expectHttpError(
      () =>
        GET(
          digestEvent('room-a', {
            roomScope: { roomId: 'empty-room', kind: 'web' },
          }),
        ),
      403,
    );
  });
});
