import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import getDb, { _resetForTest, queries } from '../src/lib/server/db.js';

const { GET } = await import('../src/routes/api/sessions/[id]/attachments/+server.js');

let dataDir = '';
let originalDataDir: string | undefined;

function attachmentsEvent(id: string, locals = {}) {
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

describe('/api/sessions/:id/attachments', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-session-attachments-'));
    process.env.ANT_DATA_DIR = dataDir;
    _resetForTest();
    getDb();
    queries.createSession('room-a', 'Room A', 'chat', 'forever', null, null, '{}');
    queries.createSession('room-b', 'Room B', 'chat', 'forever', null, null, '{}');
    queries.createSession('archived-a', 'Archived A', 'chat', 'forever', null, null, '{}');
    queries.createSession('deleted-a', 'Deleted A', 'chat', 'forever', null, null, '{}');
    queries.archiveSession('archived-a');
    queries.softDeleteSession('deleted-a');
    queries.recordUpload('upload-old', 'room-a', '@you', 'old.txt', 'text/plain', 'hash-old', 12, '/store/old.txt', '/uploads/old.txt');
    queries.recordUpload('upload-other', 'room-b', '@you', 'other.txt', 'text/plain', 'hash-other', 18, '/store/other.txt', '/uploads/other.txt');
    getDb().prepare(`UPDATE uploads SET created_at = datetime('now', '-1 hour') WHERE id = ?`).run('upload-old');
    queries.recordUpload('upload-new', 'room-a', '@codex', 'new.png', 'image/png', 'hash-new', 34, '/store/new.png', '/uploads/new.png');
  });

  afterEach(() => {
    _resetForTest();
    if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
    else process.env.ANT_DATA_DIR = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('lists uploads scoped to the requested session newest first', async () => {
    const response = await GET(attachmentsEvent('room-a'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.uploads.map((upload: any) => upload.id)).toEqual(['upload-new', 'upload-old']);
    expect(body.uploads).toEqual([
      expect.objectContaining({
        id: 'upload-new',
        session_id: 'room-a',
        uploader_handle: '@codex',
        original_name: 'new.png',
        mime_type: 'image/png',
        size_bytes: 34,
        public_url: '/uploads/new.png',
      }),
      expect.objectContaining({
        id: 'upload-old',
        session_id: 'room-a',
        original_name: 'old.txt',
      }),
    ]);
  });

  it('rejects missing and inactive sessions', async () => {
    await expectHttpError(() => GET(attachmentsEvent('missing')), 404);
    await expectHttpError(() => GET(attachmentsEvent('archived-a')), 410);
    await expectHttpError(() => GET(attachmentsEvent('deleted-a')), 410);
  });

  it('rejects cross-room scoped tokens before listing uploads', async () => {
    await expectHttpError(
      () =>
        GET(
          attachmentsEvent('room-a', {
            roomScope: { roomId: 'room-b', kind: 'cli' },
          }),
        ),
      403,
    );
  });
});
