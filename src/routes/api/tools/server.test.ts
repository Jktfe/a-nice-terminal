/**
 * Endpoint tests for /api/tools — PR-D tools catalog (plan milestone
 * pr-d-tools-catalog of ant-substrate-v0.2-2026-05-29).
 *
 * Covers POST (201 create / 400 missing fields / 400 bad kind / 401 wrong
 * bearer / 503 no admin token) and GET (200 list / kind+owner_org filter /
 * includeRetired).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET, POST } from './+server';
import {
  registerTool,
  retireTool,
  resetToolsCatalogForTests
} from '$lib/server/toolsCatalogStore';

const ADMIN_TOKEN = 'admin-tools-tok';
const PREV = process.env.ANT_ADMIN_TOKEN;

beforeEach(() => {
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN;
  resetToolsCatalogForTests();
});

afterEach(() => {
  resetToolsCatalogForTests();
  if (PREV === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = PREV;
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makePost(body: unknown, token: string = ADMIN_TOKEN): any {
  const url = 'http://localhost/api/tools';
  return {
    request: new Request(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify(body)
    }),
    params: {},
    url: new URL(url)
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeGet(query: string = ''): any {
  const url = `http://localhost/api/tools${query}`;
  return {
    request: new Request(url),
    params: {},
    url: new URL(url)
  };
}

async function callOrUnwrap(invoke: () => unknown): Promise<Response> {
  try {
    return (await invoke()) as Response;
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

describe('POST /api/tools', () => {
  it('201 creates a tool row', async () => {
    const res = await callOrUnwrap(() =>
      POST(
        makePost({
          toolSlug: 'notify-me',
          kind: 'skill',
          name: 'Notify Me'
        })
      )
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.tool.toolId).toMatch(/^tool_/);
    expect(body.tool.toolSlug).toBe('notify-me');
  });

  it('201 accepts version, ownerOrg, minTier, metadata', async () => {
    const res = await callOrUnwrap(() =>
      POST(
        makePost({
          toolSlug: 'graphify',
          kind: 'skill',
          name: 'Graphify',
          version: '0.3.1',
          ownerOrg: 'newmodelvc',
          minTier: 'premium',
          metadata: { triggers: ['/graphify'] }
        })
      )
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.tool.minTier).toBe('premium');
    expect(body.tool.metadata).toEqual({ triggers: ['/graphify'] });
  });

  it('400 when toolSlug missing', async () => {
    const res = await callOrUnwrap(() =>
      POST(makePost({ kind: 'skill', name: 'X' }))
    );
    expect(res.status).toBe(400);
  });

  it('400 when kind invalid', async () => {
    const res = await callOrUnwrap(() =>
      POST(makePost({ toolSlug: 'x', kind: 'mystery', name: 'X' }))
    );
    expect(res.status).toBe(400);
  });

  it('400 when name missing', async () => {
    const res = await callOrUnwrap(() =>
      POST(makePost({ toolSlug: 'x', kind: 'skill' }))
    );
    expect(res.status).toBe(400);
  });

  it('400 when minTier invalid', async () => {
    const res = await callOrUnwrap(() =>
      POST(makePost({ toolSlug: 'x', kind: 'skill', name: 'X', minTier: 'gold' }))
    );
    expect(res.status).toBe(400);
  });

  it('400 when metadata is not an object', async () => {
    const res = await callOrUnwrap(() =>
      POST(makePost({ toolSlug: 'x', kind: 'skill', name: 'X', metadata: 'string' }))
    );
    expect(res.status).toBe(400);
  });

  it('401 when bearer is wrong', async () => {
    const res = await callOrUnwrap(() =>
      POST(makePost({ toolSlug: 'x', kind: 'skill', name: 'X' }, 'wrong-token'))
    );
    expect(res.status).toBe(401);
  });

  it('503 when admin token is not configured', async () => {
    delete process.env.ANT_ADMIN_TOKEN;
    const res = await callOrUnwrap(() =>
      POST(makePost({ toolSlug: 'x', kind: 'skill', name: 'X' }))
    );
    expect(res.status).toBe(503);
  });

  it('400 when body is not JSON', async () => {
    const url = 'http://localhost/api/tools';
    const req = new Request(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${ADMIN_TOKEN}`,
        'content-type': 'application/json'
      },
      body: 'not json'
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const event: any = { request: req, params: {}, url: new URL(url) };
    const res = await callOrUnwrap(() => POST(event));
    expect(res.status).toBe(400);
  });
});

describe('GET /api/tools', () => {
  it('200 lists active tools', async () => {
    registerTool({ toolSlug: 'a', kind: 'skill', name: 'A' });
    registerTool({ toolSlug: 'b', kind: 'mcp', name: 'B' });
    const res = await callOrUnwrap(() => GET(makeGet()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tools.map((t: { toolSlug: string }) => t.toolSlug).sort()).toEqual([
      'a',
      'b'
    ]);
  });

  it('filters by kind', async () => {
    registerTool({ toolSlug: 'a', kind: 'skill', name: 'A' });
    registerTool({ toolSlug: 'b', kind: 'mcp', name: 'B' });
    const res = await callOrUnwrap(() => GET(makeGet('?kind=mcp')));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tools.map((t: { toolSlug: string }) => t.toolSlug)).toEqual(['b']);
  });

  it('filters by owner_org', async () => {
    registerTool({ toolSlug: 'a', kind: 'skill', name: 'A', ownerOrg: 'orgA' });
    registerTool({ toolSlug: 'b', kind: 'skill', name: 'B', ownerOrg: 'orgB' });
    const res = await callOrUnwrap(() => GET(makeGet('?owner_org=orgA')));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tools.map((t: { toolSlug: string }) => t.toolSlug)).toEqual(['a']);
  });

  it('400 when kind filter is invalid', async () => {
    const res = await callOrUnwrap(() => GET(makeGet('?kind=mystery')));
    expect(res.status).toBe(400);
  });

  it('excludes retired tools by default', async () => {
    const a = registerTool({ toolSlug: 'a', kind: 'skill', name: 'A' });
    registerTool({ toolSlug: 'b', kind: 'skill', name: 'B' });
    retireTool(a.toolId);
    const res = await callOrUnwrap(() => GET(makeGet()));
    const body = await res.json();
    expect(body.tools.map((t: { toolSlug: string }) => t.toolSlug)).toEqual(['b']);
  });

  it('includes retired tools when includeRetired=1', async () => {
    const a = registerTool({ toolSlug: 'a', kind: 'skill', name: 'A' });
    retireTool(a.toolId);
    const res = await callOrUnwrap(() => GET(makeGet('?includeRetired=1')));
    const body = await res.json();
    expect(body.tools.map((t: { toolSlug: string }) => t.toolSlug)).toContain('a');
  });
});
