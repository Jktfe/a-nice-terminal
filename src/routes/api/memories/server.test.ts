/**
 * Endpoint tests for /api/memories — MEMORY-CRUD (2026-05-16).
 *
 * Covers POST upsert path (insert vs update status code), GET list with
 * prefix and scope filters, key-by-path read/delete with literal-slash
 * and double-encoded shapes, audit read.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET as LIST, POST as PUT } from './+server';
import { GET as KEY_GET, DELETE as KEY_DELETE } from './key/[...key]/+server';
import { GET as AUDIT_GET } from './audit/+server';
import { resetMemoriesStoreForTests } from '$lib/server/memoriesStore';

const ADMIN_TOKEN = 'memories-admin-token';
const PREV_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;

beforeEach(() => {
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN;
  resetMemoriesStoreForTests();
});

afterEach(() => {
  resetMemoriesStoreForTests();
  if (PREV_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = PREV_ADMIN_TOKEN;
});

// SvelteKit's RouteParams narrowing differs per route; cast through `any`
// so a single test helper can drive every handler under /api/memories.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeGetEvent(rawPath: string, params: Record<string, string> = {}, headers: HeadersInit = {}): any {
  const url = new URL(`http://localhost${rawPath}`);
  return { request: new Request(url.toString(), { headers }), params, url };
}

function makeAdminGetEvent(rawPath: string, params: Record<string, string> = {}): any {
  return makeGetEvent(rawPath, params, { authorization: `Bearer ${ADMIN_TOKEN}` });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makePostEvent(body: unknown, headers: HeadersInit = { authorization: `Bearer ${ADMIN_TOKEN}` }): any {
  const url = new URL('http://localhost/api/memories');
  const request = new Request(url.toString(), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
  return { request, params: {}, url };
}

async function callOrUnwrap(invoke: () => unknown): Promise<Response> {
  try {
    const result = (await invoke()) as Response;
    return result;
  } catch (thrownByHandler) {
    if (thrownByHandler instanceof Response) return thrownByHandler;
    const httpFailure = thrownByHandler as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
    }
    throw thrownByHandler;
  }
}

describe('/api/memories', () => {
  it('GET rejects anonymous reads', async () => {
    const response = await callOrUnwrap(() => LIST(makeGetEvent('/api/memories')));
    expect(response.status).toBe(401);
  });

  it('POST rejects anonymous writes', async () => {
    const response = await callOrUnwrap(() => PUT(makePostEvent({ key: 'k1', value: 'v1' }, {})));
    expect(response.status).toBe(401);
  });

  it('POST inserts a new row and returns 201 with created=true', async () => {
    const response = await callOrUnwrap(() => PUT(makePostEvent({ key: 'k1', value: 'v1' })));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.created).toBe(true);
    expect(body.memory.key).toBe('k1');
  });

  it('POST a second time on the same key returns 200 with created=false', async () => {
    await PUT(makePostEvent({ key: 'k1', value: 'v1' }));
    const response = await callOrUnwrap(() => PUT(makePostEvent({ key: 'k1', value: 'v2' })));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.created).toBe(false);
    expect(body.memory.value).toBe('v2');
  });

  it('POST rejects missing key with 400', async () => {
    const response = await callOrUnwrap(() => PUT(makePostEvent({ value: 'orphan' })));
    expect(response.status).toBe(400);
  });

  it('POST rejects unknown scope with 400', async () => {
    const response = await callOrUnwrap(() =>
      PUT(makePostEvent({ key: 'k1', value: 'v', scope: 'galactic' }))
    );
    expect(response.status).toBe(400);
  });

  it('GET /api/memories returns all rows when no filter', async () => {
    await PUT(makePostEvent({ key: 'a', value: '1' }));
    await PUT(makePostEvent({ key: 'b', value: '2' }));
    const response = await callOrUnwrap(() => LIST(makeAdminGetEvent('/api/memories')));
    const body = await response.json();
    expect(body.memories.map((m: { key: string }) => m.key).sort()).toEqual(['a', 'b']);
  });

  it('GET /api/memories?prefix=X filters by prefix', async () => {
    await PUT(makePostEvent({ key: 'agents/a', value: '1' }));
    await PUT(makePostEvent({ key: 'tasks/1', value: '2' }));
    const response = await callOrUnwrap(() => LIST(makeAdminGetEvent('/api/memories?prefix=agents/')));
    const body = await response.json();
    expect(body.memories.map((m: { key: string }) => m.key)).toEqual(['agents/a']);
  });

  it('GET /api/memories?scope=terminal&target=T returns scoped rows', async () => {
    await PUT(makePostEvent({ key: 'a', value: '1', scope: 'terminal', scope_target: 't_1' }));
    await PUT(makePostEvent({ key: 'b', value: '2', scope: 'terminal', scope_target: 't_2' }));
    const response = await callOrUnwrap(() =>
      LIST(makeAdminGetEvent('/api/memories?scope=terminal&target=t_1'))
    );
    const body = await response.json();
    expect(body.memories.map((m: { key: string }) => m.key)).toEqual(['a']);
  });

  it('GET /api/memories/key/<slash-key> returns the row even with literal slashes', async () => {
    await PUT(makePostEvent({ key: 'agents/researchant/role', value: 'design' }));
    const response = await callOrUnwrap(() =>
      KEY_GET(
        makeAdminGetEvent('/api/memories/key/agents/researchant/role', {
          key: 'agents/researchant/role'
        })
      )
    );
    const body = await response.json();
    expect(body.memory.value).toBe('design');
  });

  it('GET /api/memories/key/<key> normalises a double-encoded slash', async () => {
    await PUT(makePostEvent({ key: 'agents/r/role', value: 'design' }));
    // SvelteKit hands the encoded segment back as literal "%2F" when the
    // caller double-encoded — resolveKey turns it into "/" before lookup.
    const response = await callOrUnwrap(() =>
      KEY_GET(
        makeAdminGetEvent('/api/memories/key/agents%2Fr%2Frole', {
          key: 'agents%2Fr%2Frole'
        })
      )
    );
    const body = await response.json();
    expect(body.memory.key).toBe('agents/r/role');
  });

  it('GET /api/memories/key/<missing> returns 404', async () => {
    const response = await callOrUnwrap(() =>
      KEY_GET(makeAdminGetEvent('/api/memories/key/nope', { key: 'nope' }))
    );
    expect(response.status).toBe(404);
  });

  it('DELETE /api/memories/key/<key> removes the row and returns 204', async () => {
    await PUT(makePostEvent({ key: 'k1', value: 'v1' }));
    const response = await callOrUnwrap(() =>
      KEY_DELETE(makeAdminGetEvent('/api/memories/key/k1', { key: 'k1' }))
    );
    expect(response.status).toBe(204);
    // Second DELETE is a 404.
    const second = await callOrUnwrap(() =>
      KEY_DELETE(makeAdminGetEvent('/api/memories/key/k1', { key: 'k1' }))
    );
    expect(second.status).toBe(404);
  });

  it('GET /api/memories/audit returns the audit trail newest-first', async () => {
    await PUT(makePostEvent({ key: 'k1', value: 'v1', byHandle: '@a' }));
    await PUT(makePostEvent({ key: 'k1', value: 'v2', byHandle: '@b' }));
    const response = await callOrUnwrap(() =>
      AUDIT_GET(makeAdminGetEvent('/api/memories/audit?key=k1'))
    );
    const body = await response.json();
    expect(body.audit).toHaveLength(2);
    expect(body.audit[0].action).toBe('update');
    expect(body.audit[0].byHandle).toBe('@admin');
    expect(body.audit[1].action).toBe('put');
  });
});
