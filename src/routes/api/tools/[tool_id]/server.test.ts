/**
 * Endpoint tests for /api/tools/[tool_id] — PR-D tools catalog single-tool ops.
 *
 * Covers GET (200 / 404), DELETE retire (200 / 404 / 401 / 503), and the
 * deprecate sub-route.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET, DELETE } from './+server';
import { POST as DEPRECATE_POST } from './deprecate/+server';
import {
  registerTool,
  resetToolsCatalogForTests,
  findToolById
} from '$lib/server/toolsCatalogStore';

const ADMIN_TOKEN = 'admin-single-tool-tok';
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
function makeGet(toolId: string): any {
  const url = `http://localhost/api/tools/${toolId}`;
  return {
    request: new Request(url),
    params: { tool_id: toolId },
    url: new URL(url)
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeDelete(toolId: string, token: string = ADMIN_TOKEN): any {
  const url = `http://localhost/api/tools/${toolId}`;
  return {
    request: new Request(url, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` }
    }),
    params: { tool_id: toolId },
    url: new URL(url)
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeDeprecate(toolId: string, token: string = ADMIN_TOKEN): any {
  const url = `http://localhost/api/tools/${toolId}/deprecate`;
  return {
    request: new Request(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` }
    }),
    params: { tool_id: toolId },
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

describe('GET /api/tools/[tool_id]', () => {
  it('200 returns the tool', async () => {
    const tool = registerTool({ toolSlug: 'x', kind: 'skill', name: 'X' });
    const res = await callOrUnwrap(() => GET(makeGet(tool.toolId)));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tool.toolId).toBe(tool.toolId);
  });

  it('404 when tool does not exist', async () => {
    const res = await callOrUnwrap(() => GET(makeGet('tool_nope')));
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/tools/[tool_id]', () => {
  it('200 retires the tool', async () => {
    const tool = registerTool({ toolSlug: 'x', kind: 'skill', name: 'X' });
    const res = await callOrUnwrap(() => DELETE(makeDelete(tool.toolId)));
    expect(res.status).toBe(200);
    expect(findToolById(tool.toolId)?.retiredAtMs).not.toBeNull();
  });

  it('404 when tool does not exist', async () => {
    const res = await callOrUnwrap(() => DELETE(makeDelete('tool_nope')));
    expect(res.status).toBe(404);
  });

  it('401 when bearer is wrong', async () => {
    const tool = registerTool({ toolSlug: 'x', kind: 'skill', name: 'X' });
    const res = await callOrUnwrap(() => DELETE(makeDelete(tool.toolId, 'wrong')));
    expect(res.status).toBe(401);
  });

  it('503 when admin token unset', async () => {
    const tool = registerTool({ toolSlug: 'x', kind: 'skill', name: 'X' });
    delete process.env.ANT_ADMIN_TOKEN;
    const res = await callOrUnwrap(() => DELETE(makeDelete(tool.toolId)));
    expect(res.status).toBe(503);
  });
});

describe('POST /api/tools/[tool_id]/deprecate', () => {
  it('200 deprecates the tool', async () => {
    const tool = registerTool({ toolSlug: 'x', kind: 'skill', name: 'X' });
    const res = await callOrUnwrap(() => DEPRECATE_POST(makeDeprecate(tool.toolId)));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tool.deprecatedAtMs).not.toBeNull();
    expect(body.tool.retiredAtMs).toBeNull();
  });

  it('404 when tool does not exist', async () => {
    const res = await callOrUnwrap(() => DEPRECATE_POST(makeDeprecate('tool_nope')));
    expect(res.status).toBe(404);
  });

  it('401 when bearer is wrong', async () => {
    const tool = registerTool({ toolSlug: 'x', kind: 'skill', name: 'X' });
    const res = await callOrUnwrap(() => DEPRECATE_POST(makeDeprecate(tool.toolId, 'wrong')));
    expect(res.status).toBe(401);
  });
});
