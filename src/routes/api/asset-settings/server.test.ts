/**
 * Endpoint tests for /api/asset-settings — admin-bearer-gated file-layer
 * editor for ~/.ant/asset-folders.json.
 *
 * Test pattern mirrors src/routes/api/file-refs/server.test.ts (the
 * callOrCaught() wrapper handles the throw-error() contract from
 * SvelteKit by converting a thrown HttpError-like object into a Response).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GET, PUT } from './+server';

function adminRequest(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${process.env.ANT_ADMIN_TOKEN ?? 'test-admin'}`);
  return new Request(`http://localhost${path}`, { ...init, headers });
}

function getEvent() {
  return { request: adminRequest('/api/asset-settings') } as unknown as Parameters<typeof GET>[0];
}

function putEvent(body: unknown) {
  const request = adminRequest('/api/asset-settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { request } as unknown as Parameters<typeof PUT>[0];
}

async function callOrCaught<T extends (event: any) => any>(
  fn: T,
  event: Parameters<T>[0]
): Promise<Response> {
  try {
    return (await fn(event)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const httpFailure = thrown as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), {
        status: httpFailure.status
      });
    }
    throw thrown;
  }
}

let scratchDir: string;
// A media sub-folder used as a registerable asset root. Distinct from
// scratchDir, which doubles as $HOME below — registering the home dir
// itself is (correctly) rejected by assertSafeAssetRoot.
let mediaDir: string;
let originalHome: string | undefined;
let originalAdminToken: string | undefined;

beforeEach(() => {
  scratchDir = mkdtempSync(join(tmpdir(), 'ant-asset-settings-route-'));
  mediaDir = join(scratchDir, 'media');
  mkdirSync(mediaDir, { recursive: true });
  // point the store at the scratch HOME so it writes asset-folders.json
  // into a temp location (keeps the real ~/.ant untouched).
  originalHome = process.env.HOME;
  originalAdminToken = process.env.ANT_ADMIN_TOKEN;
  process.env.HOME = scratchDir;
  process.env.USERPROFILE = scratchDir;
  process.env.ANT_ADMIN_TOKEN = 'test-admin';
});

afterEach(() => {
  try { rmSync(scratchDir, { recursive: true, force: true }); } catch { /* ignore */ }
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalAdminToken === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = originalAdminToken;
});

describe('GET /api/asset-settings', () => {
  it('rejects without admin bearer', async () => {
    const noAuthEvent = { request: new Request('http://localhost/api/asset-settings') } as unknown as Parameters<typeof GET>[0];
    const res = await callOrCaught(GET, noAuthEvent);
    expect(res.status).toBe(401);
  });

  it('returns envRoots + fileRoots + resolved for an admin caller', async () => {
    const res = await callOrCaught(GET, getEvent());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      envRoots: string[];
      fileRoots: string[];
      resolved: string[];
    };
    expect(Array.isArray(body.envRoots)).toBe(true);
    expect(Array.isArray(body.fileRoots)).toBe(true);
    expect(Array.isArray(body.resolved)).toBe(true);
  });
});

describe('PUT /api/asset-settings', () => {
  it('rejects without admin bearer', async () => {
    const noAuthEvent = { request: new Request('http://localhost/api/asset-settings', { method: 'PUT' }) } as unknown as Parameters<typeof PUT>[0];
    const res = await callOrCaught(PUT, noAuthEvent);
    expect(res.status).toBe(401);
  });

  it('rejects non-array body', async () => {
    const res = await callOrCaught(PUT, putEvent({ assetRoots: 'not-array' }));
    expect(res.status).toBe(400);
  });

  it('writes valid input + returns the new payload', async () => {
    const res = await callOrCaught(PUT, putEvent({ assetRoots: [mediaDir, '/env-a'] }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { fileRoots: string[]; resolved: string[] };
    // mediaDir is on disk + is now in the file layer; env-a is not, so it's filtered.
    expect(body.fileRoots).toEqual([mediaDir, '/env-a']);
    expect(body.resolved).toContain(mediaDir);
  });

  it('strips empty + trims entries before persisting', async () => {
    const res = await callOrCaught(PUT, putEvent({ assetRoots: ['  ' + mediaDir + '  ', '', '   '] }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { fileRoots: string[] };
    expect(body.fileRoots).toEqual([mediaDir]);
  });

  it('rejects a sensitive root (the home directory) with 400', async () => {
    const res = await callOrCaught(PUT, putEvent({ assetRoots: [scratchDir] }));
    expect(res.status).toBe(400);
  });
});
