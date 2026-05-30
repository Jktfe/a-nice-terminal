import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIdentityDbForTests } from '\$lib/server/db';
import { GET } from './+server';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;
const PREV_DECK_ROOTS = process.env.ANT_BUILT_DECKS_ROOTS;
let tempRoot = '';

type AnyHandler = (event: unknown) => unknown;

function eventFor(slug: string, path: string) {
  return {
    request: new Request(`http://localhost/d/${slug}/${path}`),
    url: new URL(`http://localhost/d/${slug}/${path}`),
    params: { slug, path }
  };
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
  tempRoot = mkdtempSync(join(tmpdir(), 'ant-decks-'));
  process.env.ANT_BUILT_DECKS_ROOTS = tempRoot;
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
  if (PREV_DECK_ROOTS === undefined) delete process.env.ANT_BUILT_DECKS_ROOTS;
  else process.env.ANT_BUILT_DECKS_ROOTS = PREV_DECK_ROOTS;
});

describe('/d/:slug/:path', () => {
  it('GET 400 on invalid slug', async () => {
    const res = await run(GET as unknown as AnyHandler, eventFor('../etc', 'file.js'));
    expect(res.status).toBe(400);
  });

  it('GET 400 on path traversal', async () => {
    const res = await run(GET as unknown as AnyHandler, eventFor('test-deck', '../../etc/passwd'));
    expect(res.status).toBe(400);
  });

  it('GET 404 when asset missing', async () => {
    const res = await run(GET as unknown as AnyHandler, eventFor('nonexistent', 'main.js'));
    expect(res.status).toBe(404);
  });

  it('GET serves assets from configured built deck roots', async () => {
    const assets = join(tempRoot, 'animotion-demo', 'dist', 'assets');
    mkdirSync(assets, { recursive: true });
    writeFileSync(join(assets, 'app.js'), 'console.log("animotion");');

    const res = await run(GET as unknown as AnyHandler, eventFor('animotion-demo', 'assets/app.js'));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/javascript');
    expect(await res.text()).toBe('console.log("animotion");');
  });
});
