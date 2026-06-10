/**
 * Tests for /api/assets/[...path] — the real two reviews called out:
 *   1. Multi-root file resolution (the BLOCKER): a file in root[1] must
 *      still resolve even when root[0] doesn't have it; configured folders
 *      must NOT shadow the static/ fallback.
 *   2. Symlink escape rejection (the SECURITY): a symlink inside an
 *      asset folder pointing OUTSIDE the root must NOT be served.
 *
 * Both tests use tmp dirs as the asset roots so the resolver's
 * `existsSync` filter in `assetRootsResolved` accepts them. The route's
 * test path goes through the same findAsset() + realpath() machinery the
 * production server uses.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, symlinkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET } from './+server';

function eventFor(path: string) {
  return {
    request: new Request(`http://localhost/api/assets/${path}`),
    params: { path },
    setHeaders: () => {}
  } as unknown as Parameters<typeof GET>[0];
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
let rootA: string;
let rootB: string;
let originalHome: string | undefined;
let originalEnvRoots: string | undefined;

beforeEach(() => {
  scratchDir = mkdtempSync(join(tmpdir(), 'ant-assets-route-'));
  rootA = join(scratchDir, 'rootA');
  rootB = join(scratchDir, 'rootB');
  mkdirSync(rootA, { recursive: true });
  mkdirSync(rootB, { recursive: true });

  // Point the store at this scratch HOME so ~/.ant/asset-folders.json
  // does NOT pollute the real one.
  originalHome = process.env.HOME;
  originalEnvRoots = process.env.ANT_ASSET_ROOTS;
  process.env.HOME = scratchDir;
  process.env.USERPROFILE = scratchDir;
  // Drive assetRootsResolved via the env-var path so we don't need to
  // write ~/.ant/asset-folders.json at all. Order: env (A,B), then
  // file (empty), then static/ fallback (the real repo's static/).
  process.env.ANT_ASSET_ROOTS = `${rootA}${require('node:path').delimiter}${rootB}`;
});

afterEach(() => {
  try { rmSync(scratchDir, { recursive: true, force: true }); } catch { /* ignore */ }
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalEnvRoots === undefined) delete process.env.ANT_ASSET_ROOTS;
  else process.env.ANT_ASSET_ROOTS = originalEnvRoots;
});

describe('GET /api/assets — multi-root file resolution (researchant #1)', () => {
  it('serves a file from rootA when present there', async () => {
    writeFileSync(join(rootA, 'a.png'), 'AAA');
    const res = await callOrCaught(GET, eventFor('a.png'));
    expect(res.status).toBe(200);
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.toString()).toBe('AAA');
  });

  it('falls through to rootB when rootA does not have the file', async () => {
    // The BLOCKER: with containment-only resolution, rootA would have
    // shadowed rootB. With existence-in-loop, rootB serves the file.
    writeFileSync(join(rootB, 'b.png'), 'BBB');
    const res = await callOrCaught(GET, eventFor('b.png'));
    expect(res.status).toBe(200);
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.toString()).toBe('BBB');
  });

  it('404s when no root has the file', async () => {
    const res = await callOrCaught(GET, eventFor('nope.png'));
    expect(res.status).toBe(404);
  });
});

describe('GET /api/assets — symlink escape rejection (researchant #2)', () => {
  it('rejects a symlink that points outside the asset root', async () => {
    // The SECURITY: a symlink inside rootA that points at /etc/passwd
    // (or any other file outside the root) must NOT be served. Without
    // the realpath() + recheck, the route would read /etc/passwd
    // unauthenticated.
    const outsideDir = join(scratchDir, 'outside');
    mkdirSync(outsideDir, { recursive: true });
    writeFileSync(join(outsideDir, 'secret.txt'), 'SUPER SECRET');
    // Make a symlink inside rootA pointing to the outside file
    symlinkSync(join(outsideDir, 'secret.txt'), join(rootA, 'leak.txt'));

    const res = await callOrCaught(GET, eventFor('leak.txt'));
    // We must NOT get a 200 with the secret contents. Either 404 (the
    // symlink target is outside the root, the realpath check fails) is
    // the right outcome.
    expect(res.status).not.toBe(200);
    if (res.status === 200) {
      const body = Buffer.from(await res.arrayBuffer()).toString();
      expect(body).not.toBe('SUPER SECRET');
    } else {
      expect(res.status).toBe(404);
    }
  });

  it('serves a symlink that points to another file INSIDE the same root', async () => {
    // Sanity: legitimate symlinks-within-root must still work. A
    // symlink that resolves back to a file under the same root is
    // the intended pattern (e.g. a synced folder exposing an alias).
    writeFileSync(join(rootA, 'real.png'), 'REAL');
    symlinkSync(join(rootA, 'real.png'), join(rootA, 'alias.png'));
    const res = await callOrCaught(GET, eventFor('alias.png'));
    expect(res.status).toBe(200);
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.toString()).toBe('REAL');
  });
});

describe('GET /api/assets — request-path safety', () => {
  it('rejects absolute paths in the request', async () => {
    const res = await callOrCaught(GET, eventFor('/etc/passwd'));
    expect(res.status).toBe(400);
  });

  it('rejects .. traversal segments', async () => {
    const res = await callOrCaught(GET, eventFor('../etc/passwd'));
    expect(res.status).toBe(400);
  });

  it('rejects . segment', async () => {
    const res = await callOrCaught(GET, eventFor('./passwd'));
    expect(res.status).toBe(400);
  });

  it('rejects hidden (dot-prefixed) segments — no unauth .env/.git/.ssh leak', async () => {
    // The dotfiles need not exist: the guard fires before stat().
    for (const p of ['.env', '.git/config', 'sub/.env', '.ssh/id_rsa']) {
      const res = await callOrCaught(GET, eventFor(p));
      expect(res.status).toBe(400);
    }
  });

  it('rejects blocked build/dependency segments', async () => {
    for (const p of ['node_modules/pkg/index.js', 'dist/app.js']) {
      const res = await callOrCaught(GET, eventFor(p));
      expect(res.status).toBe(400);
    }
  });

  it('rejects null bytes / control chars with 400 (not a swallowed 404)', async () => {
    const res = await callOrCaught(GET, eventFor('a' + String.fromCharCode(0) + 'b.png'));
    expect(res.status).toBe(400);
  });
});

describe('GET /api/assets — SVG is not served as an executable inline document', () => {
  function eventCapturingHeaders(path: string) {
    const captured: Record<string, string> = {};
    const event = {
      request: new Request(`http://localhost/api/assets/${path}`),
      params: { path },
      setHeaders: (h: Record<string, string>) => Object.assign(captured, h)
    } as unknown as Parameters<typeof GET>[0];
    return { event, captured };
  }

  it('serves .svg with nosniff + Content-Disposition: attachment', async () => {
    writeFileSync(join(rootA, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const { event, captured } = eventCapturingHeaders('logo.svg');
    const res = await callOrCaught(GET, event);
    expect(res.status).toBe(200);
    expect(captured['Content-Type']).toContain('image/svg+xml');
    expect(captured['X-Content-Type-Options']).toBe('nosniff');
    expect(captured['Content-Disposition']).toBe('attachment');
  });

  it('serves a normal image with nosniff but no forced attachment', async () => {
    writeFileSync(join(rootA, 'pic.png'), 'PNG');
    const { event, captured } = eventCapturingHeaders('pic.png');
    const res = await callOrCaught(GET, event);
    expect(res.status).toBe(200);
    expect(captured['X-Content-Type-Options']).toBe('nosniff');
    expect(captured['Content-Disposition']).toBeUndefined();
  });
});
