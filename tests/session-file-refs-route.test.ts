import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import getDb, { _resetForTest, queries } from '../src/lib/server/db.js';

const broadcast = vi.fn();
const nanoid = vi.fn(() => 'ref-new');

vi.mock('$lib/server/ws-broadcast.js', () => ({
  broadcast,
}));

vi.mock('nanoid', () => ({
  nanoid,
}));

const route = await import('../src/routes/api/sessions/[id]/file-refs/+server.js');

let dataDir = '';
let originalDataDir: string | undefined;

function requestEvent(id: string, body: unknown) {
  return {
    params: { id },
    request: new Request(`https://ant.test/api/sessions/${id}/file-refs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  } as any;
}

function deleteEvent(id: string, refId: string | null) {
  const url = new URL(`https://ant.test/api/sessions/${id}/file-refs`);
  if (refId !== null) url.searchParams.set('refId', refId);
  return { params: { id }, url } as any;
}

describe('/api/sessions/:id/file-refs', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-file-refs-'));
    process.env.ANT_DATA_DIR = dataDir;
    _resetForTest();
    getDb();
    broadcast.mockReset();
    nanoid.mockReturnValue('ref-new');
    queries.createSession('session-a', 'Session A', 'terminal', 'forever', null, null, '{}');
    queries.createSession('session-b', 'Session B', 'terminal', 'forever', null, null, '{}');
    queries.createFileRef('ref-existing', 'session-a', '@you', '/tmp/a.ts', 'existing');
    queries.createFileRef('ref-other', 'session-b', '@other', '/tmp/b.ts', null);
  });

  afterEach(() => {
    _resetForTest();
    if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
    else process.env.ANT_DATA_DIR = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('lists refs scoped to the requested session', async () => {
    const response = await route.GET({ params: { id: 'session-a' } } as any);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      refs: [
        {
          id: 'ref-existing',
          session_id: 'session-a',
          flagged_by: '@you',
          file_path: '/tmp/a.ts',
          note: 'existing',
        },
      ],
    });
  });

  it('creates trimmed refs and broadcasts the normalized payload', async () => {
    const response = await route.POST(requestEvent('session-a', {
      file_path: '  /tmp/new.ts  ',
      note: '  inspect this  ',
      flagged_by: '  @you  ',
    }));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      ref: {
        id: 'ref-new',
        session_id: 'session-a',
        flagged_by: '@you',
        file_path: '/tmp/new.ts',
        note: 'inspect this',
      },
    });
    expect(queries.listFileRefs('session-a')).toEqual([
      expect.objectContaining({ id: 'ref-existing' }),
      expect.objectContaining({
        id: 'ref-new',
        flagged_by: '@you',
        file_path: '/tmp/new.ts',
        note: 'inspect this',
      }),
    ]);
    expect(broadcast).toHaveBeenCalledWith('session-a', {
      type: 'file_ref_created',
      sessionId: 'session-a',
      ref: {
        id: 'ref-new',
        session_id: 'session-a',
        flagged_by: '@you',
        file_path: '/tmp/new.ts',
        note: 'inspect this',
      },
    });
  });

  it('rejects malformed JSON and blank or non-string file paths', async () => {
    const malformed = await route.POST(requestEvent('session-a', '{'));
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: 'Invalid JSON' });

    const blank = await route.POST(requestEvent('session-a', { file_path: '   ' }));
    expect(blank.status).toBe(400);
    expect(await blank.json()).toEqual({ error: 'file_path required' });

    const wrongType = await route.POST(requestEvent('session-a', { file_path: 123 }));
    expect(wrongType.status).toBe(400);
    expect(await wrongType.json()).toEqual({ error: 'file_path required' });
  });

  it('deletes only refs owned by the requested session', async () => {
    const missingParam = await route.DELETE(deleteEvent('session-a', null));
    expect(missingParam.status).toBe(400);
    expect(await missingParam.json()).toEqual({ error: 'refId required' });

    const crossSession = await route.DELETE(deleteEvent('session-a', 'ref-other'));
    expect(crossSession.status).toBe(404);
    expect(await crossSession.json()).toEqual({ error: 'file ref not found' });
    expect(queries.listFileRefs('session-b')).toEqual([
      expect.objectContaining({ id: 'ref-other' }),
    ]);
    expect(broadcast).not.toHaveBeenCalled();

    const response = await route.DELETE(deleteEvent('session-a', 'ref-existing'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(queries.listFileRefs('session-a')).toEqual([]);
    expect(broadcast).toHaveBeenCalledWith('session-a', {
      type: 'file_ref_deleted',
      sessionId: 'session-a',
      refId: 'ref-existing',
    });
  });
});
