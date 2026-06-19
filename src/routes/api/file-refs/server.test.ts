/**
 * Endpoint tests for /api/file-refs and /api/file-refs/[id] —
 * JWPK file-refs / "flag" subsystem 2026-05-16.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET, POST } from './+server';
import { GET as GET_ONE, DELETE as DELETE_ONE } from './[id]/+server';
import { GET as GET_TERMINAL_FILES } from '../terminals/[id]/files/+server';
import {
  addFileRef,
  listFileRefsForScope,
  resetFileRefsStoreForTests
} from '$lib/server/fileRefsStore';

const TERMINAL_FILES_ADMIN_TOKEN = 'file-refs-terminal-files-test-token';
const PREV_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;

function getEvent(searchParams: Record<string, string> = {}, headers: HeadersInit = { authorization: `Bearer ${TERMINAL_FILES_ADMIN_TOKEN}` }) {
  const url = new URL('http://localhost/api/file-refs');
  for (const [k, v] of Object.entries(searchParams)) url.searchParams.set(k, v);
  return { url, params: {}, request: new Request(url, { headers }) } as unknown as Parameters<typeof GET>[0];
}

function postEvent(body?: unknown, headers: HeadersInit = { authorization: `Bearer ${TERMINAL_FILES_ADMIN_TOKEN}` }) {
  const url = new URL('http://localhost/api/file-refs');
  const request = new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { request, url, params: {} } as unknown as Parameters<typeof POST>[0];
}

function oneEvent(id: string, method: 'GET' | 'DELETE', headers: HeadersInit = { authorization: `Bearer ${TERMINAL_FILES_ADMIN_TOKEN}` }) {
  const url = new URL(`http://localhost/api/file-refs/${id}`);
  return {
    params: { id },
    request: new Request(url, { method, headers }),
    url
  };
}

async function callOrCaught<T extends (event: any) => any>(fn: T, event: Parameters<T>[0]): Promise<Response> {
  try {
    return (await fn(event)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const httpFailure = thrown as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
    }
    throw thrown;
  }
}

describe('/api/file-refs endpoints', () => {
  beforeEach(() => {
    process.env.ANT_ADMIN_TOKEN = TERMINAL_FILES_ADMIN_TOKEN;
    resetFileRefsStoreForTests();
  });

  afterEach(() => {
    if (PREV_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
    else process.env.ANT_ADMIN_TOKEN = PREV_ADMIN_TOKEN;
  });

  it('rejects anonymous list and create access', async () => {
    expect((await callOrCaught(GET, getEvent({ scope: 'global' }, {}))).status).toBe(401);
    expect((await callOrCaught(POST, postEvent({ file_path: './README.md', scope: 'global' }, {}))).status).toBe(401);
  });

  it('POST creates a global file_ref and returns 201 with the new row', async () => {
    const response = await callOrCaught(POST, postEvent({
      file_path: './README.md',
      scope: 'global',
      label: 'top-level',
      flagged_by: '@cli'
    }));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.fileRef.scope).toBe('global');
    expect(body.fileRef.filePath).toBe('./README.md');
    expect(body.fileRef.label).toBe('top-level');
    expect(listFileRefsForScope('global')).toHaveLength(1);
  });

  it('POST rejects missing scope_target on a terminal-scoped ref', async () => {
    const response = await callOrCaught(POST, postEvent({
      file_path: './x.ts',
      scope: 'terminal'
    }));
    expect(response.status).toBe(400);
    expect(listFileRefsForScope('global')).toHaveLength(0);
  });

  it('POST rejects an unknown scope value', async () => {
    const response = await callOrCaught(POST, postEvent({
      file_path: './x.ts',
      scope: 'whatever'
    }));
    expect(response.status).toBe(400);
  });

  it('GET requires either scope= or path= and 400s otherwise', async () => {
    const response = await callOrCaught(GET, getEvent({}));
    expect(response.status).toBe(400);
  });

  it('GET ?scope=terminal&target=... returns only that terminal\'s refs', async () => {
    addFileRef({ filePath: 'a.ts', scope: 'terminal', scopeTarget: 't_one', nowMs: 1 });
    addFileRef({ filePath: 'b.ts', scope: 'terminal', scopeTarget: 't_two', nowMs: 2 });
    const response = await callOrCaught(GET, getEvent({ scope: 'terminal', target: 't_one' }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.fileRefs).toHaveLength(1);
    expect(body.fileRefs[0].filePath).toBe('a.ts');
  });

  it('GET ?path=... returns every ref pointing at that path', async () => {
    addFileRef({ filePath: 'shared.ts', scope: 'terminal', scopeTarget: 't_one', nowMs: 1 });
    addFileRef({ filePath: 'shared.ts', scope: 'global', nowMs: 2 });
    const response = await callOrCaught(GET, getEvent({ path: 'shared.ts' }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.fileRefs).toHaveLength(2);
  });

  it('DELETE /api/file-refs/[id] returns 204 then 404 on second call', async () => {
    const ref = addFileRef({ filePath: 'z.ts', scope: 'global' });
    const firstDelete = await callOrCaught(
      DELETE_ONE,
      oneEvent(ref.id, 'DELETE') as unknown as Parameters<typeof DELETE_ONE>[0]
    );
    expect(firstDelete.status).toBe(204);
    const secondDelete = await callOrCaught(
      DELETE_ONE,
      oneEvent(ref.id, 'DELETE') as unknown as Parameters<typeof DELETE_ONE>[0]
    );
    expect(secondDelete.status).toBe(404);
  });

  it('GET/DELETE /api/file-refs/[id] reject anonymous access', async () => {
    const ref = addFileRef({ filePath: 'q.ts', scope: 'global' });
    const read = await callOrCaught(
      GET_ONE,
      oneEvent(ref.id, 'GET', {}) as unknown as Parameters<typeof GET_ONE>[0]
    );
    expect(read.status).toBe(401);
    const deleted = await callOrCaught(
      DELETE_ONE,
      oneEvent(ref.id, 'DELETE', {}) as unknown as Parameters<typeof DELETE_ONE>[0]
    );
    expect(deleted.status).toBe(401);
  });

  it('GET /api/file-refs/[id] returns the ref or 404', async () => {
    const ref = addFileRef({ filePath: 'q.ts', scope: 'global' });
    const found = await callOrCaught(
      GET_ONE,
      oneEvent(ref.id, 'GET') as unknown as Parameters<typeof GET_ONE>[0]
    );
    expect(found.status).toBe(200);
    const missing = await callOrCaught(
      GET_ONE,
      oneEvent('nope', 'GET') as unknown as Parameters<typeof GET_ONE>[0]
    );
    expect(missing.status).toBe(404);
  });

  it('GET /api/terminals/[id]/files returns only terminal-scoped refs for that id', async () => {
    addFileRef({ filePath: 'a.ts', scope: 'terminal', scopeTarget: 't_alpha', nowMs: 1 });
    addFileRef({ filePath: 'b.ts', scope: 'terminal', scopeTarget: 't_beta', nowMs: 2 });
    addFileRef({ filePath: 'c.ts', scope: 'global', nowMs: 3 });
    const response = await callOrCaught(
      GET_TERMINAL_FILES,
      {
        params: { id: 't_alpha' },
        request: new Request('http://localhost/api/terminals/t_alpha/files', {
          headers: { authorization: `Bearer ${TERMINAL_FILES_ADMIN_TOKEN}` }
        }),
        url: new URL('http://localhost/api/terminals/t_alpha/files')
      } as unknown as Parameters<typeof GET_TERMINAL_FILES>[0]
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.fileRefs).toHaveLength(1);
    expect(body.fileRefs[0].filePath).toBe('a.ts');
  });
});
