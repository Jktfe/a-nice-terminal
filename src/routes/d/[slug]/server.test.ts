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

function eventFor(slug: string) {
  return {
    request: new Request(`http://localhost/d/${slug}`),
    url: new URL(`http://localhost/d/${slug}`),
    params: { slug }
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

describe('/d/:slug', () => {
  it('GET 400 on invalid slug', async () => {
    const res = await run(GET as unknown as AnyHandler, eventFor('../etc'));
    expect(res.status).toBe(400);
  });

  it('GET 404 when deck not built', async () => {
    const res = await run(GET as unknown as AnyHandler, eventFor('nonexistent-deck'));
    expect(res.status).toBe(404);
  });

  it('GET serves built Animotion or Open-Slide dist output from configured deck roots', async () => {
    const dist = join(tempRoot, 'animotion-demo', 'dist');
    mkdirSync(dist, { recursive: true });
    writeFileSync(
      join(dist, 'index.html'),
      '<link href="/_app/immutable/app.css" rel="stylesheet"><script src="/assets/app.js"></script><script>const kit = { base: "" }; import("/_app/immutable/start.js")</script><h1>Animotion demo</h1>'
    );

    const res = await run(GET as unknown as AnyHandler, eventFor('animotion-demo'));

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Animotion demo');
    expect(html).toContain('src="/d/animotion-demo/assets/app.js"');
    expect(html).toContain('href="/d/animotion-demo/_app/immutable/app.css"');
    expect(html).toContain('import("/d/animotion-demo/_app/immutable/start.js")');
    expect(html).toContain('base: "/d/animotion-demo"');
    expect(html).toContain('crypto.randomUUID');
  });
});
