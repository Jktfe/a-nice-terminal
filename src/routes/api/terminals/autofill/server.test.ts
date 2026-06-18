import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetIdentityDbForTests } from '$lib/server/db';
import { GET } from './+server';

vi.mock('$lib/server/liveAutofillSuggestions', () => ({
  readLiveAutofillSuggestionsForHandle: vi.fn((handle: string) => ({
    sourceHandle: handle.startsWith('@') ? handle : `@${handle}`,
    suggestions: [
      {
        id: 'autofill_test',
        sourceHandle: handle.startsWith('@') ? handle : `@${handle}`,
        text: 'write the room summary',
        copyOnly: true,
        detectedAtMs: 1_000,
        expiresAtMs: 6_000,
        source: 'tmux-dim-text'
      }
    ]
  }))
}));

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;
const PREV_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;
const TEST_ADMIN_TOKEN = 'test-admin-token-autofill';

type AnyHandler = (event: unknown) => unknown;

function eventFor(path: string, opts: { auth?: boolean } = {}) {
  const url = new URL(`http://localhost${path}`);
  const headers: Record<string, string> = {};
  if (opts.auth !== false) headers.authorization = `Bearer ${TEST_ADMIN_TOKEN}`;
  return { request: new Request(url, { headers }), url };
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

beforeAll(() => {
  process.env.ANT_ADMIN_TOKEN = TEST_ADMIN_TOKEN;
});

afterAll(() => {
  if (PREV_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = PREV_ADMIN_TOKEN;
});

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
});

describe('/api/terminals/autofill', () => {
  it('returns ephemeral copy-only chips for an authenticated caller', async () => {
    const response = await run(GET as unknown as AnyHandler, eventFor('/api/terminals/autofill?handle=@claude'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      sourceHandle: '@claude',
      copyOnly: true,
      ephemeral: true,
      suggestions: [
        {
          text: 'write the room summary',
          copyOnly: true,
          source: 'tmux-dim-text'
        }
      ]
    });
  });

  it('requires a handle query param', async () => {
    const response = await run(GET as unknown as AnyHandler, eventFor('/api/terminals/autofill'));
    expect(response.status).toBe(400);
  });

  it('requires auth', async () => {
    const response = await run(
      GET as unknown as AnyHandler,
      eventFor('/api/terminals/autofill?handle=@claude', { auth: false })
    );
    expect(response.status).toBe(401);
  });
});
