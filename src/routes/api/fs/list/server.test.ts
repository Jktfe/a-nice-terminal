import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '\$lib/server/db';
import { GET } from './+server';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;
const PREV_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;
const ADMIN_TOKEN = 'fs-list-admin-token';

type AnyHandler = (event: unknown) => unknown;

function eventFor(search: string, headers: HeadersInit = {}) {
  return {
    request: new Request(`http://localhost/api/fs/list${search}`, { headers }),
    url: new URL(`http://localhost/api/fs/list${search}`)
  };
}

function adminEventFor(search: string) {
  return eventFor(search, { authorization: `Bearer ${ADMIN_TOKEN}` });
}

async function run(handler: AnyHandler, event: unknown): Promise<Response> {
  try {
    return (await handler(event)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const httpFailure = thrown as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
    }
    throw thrown;
  }
}

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN;
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
  if (PREV_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = PREV_ADMIN_TOKEN;
});

describe('/api/fs/list', () => {
  it('GET rejects anonymous filesystem enumeration', async () => {
    const res = await run(GET as unknown as AnyHandler, eventFor('?path=/tmp'));
    expect(res.status).toBe(401);
  });

  it('GET lists directories under /tmp', async () => {
    const res = await run(GET as unknown as AnyHandler, adminEventFor('?path=/tmp'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.path).toBe('/tmp');
    expect(Array.isArray(body.entries)).toBe(true);
    expect(body.entries.every((e: { name: string }) => typeof e.name === 'string')).toBe(true);
  });

  it('GET 400 without path', async () => {
    const res = await run(GET as unknown as AnyHandler, adminEventFor(''));
    expect(res.status).toBe(400);
  });

  it('GET 400 on relative path', async () => {
    const res = await run(GET as unknown as AnyHandler, adminEventFor('?path=relative'));
    expect(res.status).toBe(400);
  });

  it('GET 404 for nonexistent path', async () => {
    const res = await run(GET as unknown as AnyHandler, adminEventFor('?path=/no/such/path'));
    expect(res.status).toBe(404);
  });

  it('GET respects showHidden', async () => {
    // Create a temp dir with a hidden subdir
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fslist-'));
    fs.mkdirSync(path.join(tmpDir, '.hidden'));
    fs.mkdirSync(path.join(tmpDir, 'visible'));

    const resHidden = await run(GET as unknown as AnyHandler, adminEventFor(`?path=${tmpDir}&showHidden=true`));
    expect(resHidden.status).toBe(200);
    const bodyHidden = await resHidden.json();
    expect(bodyHidden.entries.map((e: { name: string }) => e.name)).toContain('.hidden');

    const resNoHidden = await run(GET as unknown as AnyHandler, adminEventFor(`?path=${tmpDir}`));
    expect(resNoHidden.status).toBe(200);
    const bodyNoHidden = await resNoHidden.json();
    expect(bodyNoHidden.entries.map((e: { name: string }) => e.name)).not.toContain('.hidden');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
