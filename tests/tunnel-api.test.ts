import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import getDb, { _resetForTest, queries } from '../src/lib/server/db.js';
import { GET as listTunnels, POST as createTunnel } from '../src/routes/api/tunnels/+server.js';
import { DELETE as deleteTunnel, GET as getTunnel, PATCH as patchTunnel } from '../src/routes/api/tunnels/[slug]/+server.js';

const ROOM_ID = 'tunnel-room';
const OTHER_ROOM_ID = 'tunnel-other-room';
const THIRD_ROOM_ID = 'tunnel-third-room';

let dataDir = '';
let originalDataDir: string | undefined;

function locals(roomId: string, kind = 'cli') {
  return { roomScope: { roomId, kind } };
}

function listEvent(roomId: string) {
  return {
    url: new URL('https://ant.test/api/tunnels'),
    request: new Request('https://ant.test/api/tunnels'),
    locals: locals(roomId, 'web'),
  } as any;
}

function createEvent(roomId: string, body: Record<string, unknown>) {
  return {
    url: new URL('https://ant.test/api/tunnels'),
    request: new Request('https://ant.test/api/tunnels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    locals: locals(roomId),
  } as any;
}

function slugEvent(slug: string, roomId: string, method = 'GET', body: Record<string, unknown> | null = null) {
  return {
    params: { slug },
    url: new URL(`https://ant.test/api/tunnels/${slug}`),
    request: new Request(`https://ant.test/api/tunnels/${slug}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }),
    locals: locals(roomId, method === 'GET' ? 'web' : 'cli'),
  } as any;
}

async function expectForbidden(action: () => unknown | Promise<unknown>) {
  try {
    await action();
  } catch (err) {
    expect(err).toMatchObject({ status: 403 });
    return;
  }
  throw new Error('Expected tunnel request to be forbidden');
}

describe('site tunnel API', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-tunnel-api-'));
    process.env.ANT_DATA_DIR = dataDir;
    _resetForTest();
    getDb();
    queries.createSession(ROOM_ID, 'Tunnel Room', 'chat', '15m', null, dataDir, '{}');
    queries.createSession(OTHER_ROOM_ID, 'Other Tunnel Room', 'chat', '15m', null, dataDir, '{}');
    queries.createSession(THIRD_ROOM_ID, 'Third Tunnel Room', 'chat', '15m', null, dataDir, '{}');
  });

  afterEach(() => {
    _resetForTest();
    if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
    else process.env.ANT_DATA_DIR = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('registers a public local-dev site tunnel and scopes visibility by room', async () => {
    const created = await createTunnel(createEvent(ROOM_ID, {
      slug: 'prototype-site',
      title: 'Prototype Site',
      public_url: 'https://proto.trycloudflare.com',
      local_url: 'http://localhost:5173',
      allowed_room_ids: [OTHER_ROOM_ID],
      access_required: true,
    }));
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body.tunnel).toMatchObject({
      slug: 'prototype-site',
      title: 'Prototype Site',
      public_url: 'https://proto.trycloudflare.com/',
      local_url: 'http://localhost:5173/',
      owner_session_id: ROOM_ID,
      allowed_room_ids: [ROOM_ID, OTHER_ROOM_ID],
      access_required: true,
    });

    expect((await (await listTunnels(listEvent(ROOM_ID))).json()).tunnels.map((t: any) => t.slug)).toEqual(['prototype-site']);
    expect((await (await listTunnels(listEvent(OTHER_ROOM_ID))).json()).tunnels.map((t: any) => t.slug)).toEqual(['prototype-site']);
    expect((await (await listTunnels(listEvent(THIRD_ROOM_ID))).json()).tunnels).toEqual([]);
    await expectForbidden(() => getTunnel(slugEvent('prototype-site', THIRD_ROOM_ID)));
  });

  it('only lets the owner room mutate or remove a tunnel', async () => {
    await createTunnel(createEvent(ROOM_ID, {
      slug: 'owned-site',
      public_url: 'https://owned.trycloudflare.com',
      allowed_room_ids: [OTHER_ROOM_ID],
    }));

    await expectForbidden(() => patchTunnel(slugEvent('owned-site', OTHER_ROOM_ID, 'PATCH', { status: 'offline' })));

    const patched = await patchTunnel(slugEvent('owned-site', ROOM_ID, 'PATCH', {
      status: 'offline',
      access_required: false,
    }));
    expect((await patched.json()).tunnel).toMatchObject({ status: 'offline', access_required: false });

    await expectForbidden(() => deleteTunnel(slugEvent('owned-site', OTHER_ROOM_ID, 'DELETE')));
    const deleted = await deleteTunnel(slugEvent('owned-site', ROOM_ID, 'DELETE'));
    expect(await deleted.json()).toMatchObject({ ok: true, slug: 'owned-site' });
  });
});
