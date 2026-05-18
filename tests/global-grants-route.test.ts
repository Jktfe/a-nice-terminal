import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import getDb, { _resetForTest, queries } from '../src/lib/server/db.js';

const list = await import('../src/routes/api/grants/+server.js');
const detail = await import('../src/routes/api/grants/[id]/+server.js');
const revoke = await import('../src/routes/api/grants/[id]/revoke/+server.js');

let dataDir = '';
let originalDataDir: string | undefined;

function listEvent(query = '', locals: Record<string, unknown> = {}) {
  return {
    url: new URL(`https://ant.test/api/grants${query}`),
    locals,
  } as any;
}

function idEvent(id: string, locals: Record<string, unknown> = {}) {
  return {
    params: { id },
    url: new URL(`https://ant.test/api/grants/${id}`),
    request: new Request(`https://ant.test/api/grants/${id}`, { method: 'POST' }),
    locals,
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

function createGrant(id: string, grantedTo: string, topic: string, status = 'active') {
  queries.createConsentGrant(
    id,
    'room-a',
    grantedTo,
    topic,
    JSON.stringify(['docs/a.md']),
    '1h',
    0,
    null,
    status,
    1_700_000_000_000,
    1_700_003_600_000,
    '{}',
  );
}

describe('/api/grants global routes', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-global-grants-'));
    process.env.ANT_DATA_DIR = dataDir;
    _resetForTest();
    getDb();
    queries.createSession('room-a', 'Room A', 'chat', 'forever', null, null, '{}');
    createGrant('grant-a', '@codex', 'file-read');
    createGrant('grant-b', '@codex', 'web-fetch');
    createGrant('grant-revoked', '@codex', 'file-read', 'revoked');
    createGrant('grant-other', '@svelte', 'file-read');
  });

  afterEach(() => {
    _resetForTest();
    if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
    else process.env.ANT_DATA_DIR = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('lists active grants by normalized grantee and applies topic/status filters', async () => {
    const active = await list.GET(listEvent('?granted_to=codex'));
    expect(active.status).toBe(200);
    expect((await active.json()).grants.map((grant: any) => grant.id).sort()).toEqual(['grant-a', 'grant-b']);

    const filtered = await list.GET(listEvent('?granted_to=@codex&topic=file-read&status=active'));
    expect(filtered.status).toBe(200);
    expect(await filtered.json()).toMatchObject({
      grants: [
        expect.objectContaining({
          id: 'grant-a',
          granted_to: '@codex',
          topic: 'file-read',
          source_set: ['docs/a.md'],
        }),
      ],
    });
  });

  it('returns grant detail and revokes active grants with conflict on repeat', async () => {
    const detailResponse = await detail.GET(idEvent('grant-a'));
    expect(detailResponse.status).toBe(200);
    expect(await detailResponse.json()).toMatchObject({
      grant: { id: 'grant-a', source_set: ['docs/a.md'] },
    });

    const revoked = await revoke.POST(idEvent('grant-a'));
    expect(revoked.status).toBe(200);
    expect((await revoked.json()).grant).toMatchObject({ id: 'grant-a', status: 'revoked' });

    const repeated = await revoke.POST(idEvent('grant-a'));
    expect(repeated.status).toBe(409);
    expect(await repeated.json()).toEqual({ error: 'grant is revoked, not active' });
  });

  it('rejects room-scoped tokens and missing grants', async () => {
    await expectHttpError(
      () => list.GET(listEvent('?granted_to=@codex', { roomScope: { roomId: 'room-a', kind: 'cli' } })),
      403,
    );
    await expectHttpError(
      () => detail.GET(idEvent('grant-a', { roomScope: { roomId: 'room-a', kind: 'cli' } })),
      403,
    );
    await expectHttpError(
      () => revoke.POST(idEvent('grant-a', { roomScope: { roomId: 'room-a', kind: 'cli' } })),
      403,
    );

    const missingDetail = await detail.GET(idEvent('missing-grant'));
    expect(missingDetail.status).toBe(404);
    expect(await missingDetail.json()).toEqual({ error: 'not found' });

    const missingRevoke = await revoke.POST(idEvent('missing-grant'));
    expect(missingRevoke.status).toBe(404);
    expect(await missingRevoke.json()).toEqual({ error: 'not found' });
  });
});
