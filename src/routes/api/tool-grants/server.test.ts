/**
 * Endpoint tests for /api/tool-grants — PR-D per-agent grant surface.
 *
 * Covers POST (201 / 400 missing / 400 bad scope / 404 unknown tool /
 * 400 retired tool / 401 wrong bearer / 503 no admin token) and
 * DELETE (200 revoke / 200 zero count when not granted / 401 wrong bearer).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST, DELETE } from './+server';
import {
  registerTool,
  retireTool,
  lookupActiveGrant,
  resetToolsCatalogForTests
} from '$lib/server/toolsCatalogStore';

const ADMIN_TOKEN = 'admin-grants-tok';
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
function makeReq(method: 'POST' | 'DELETE', body: unknown, token: string = ADMIN_TOKEN): any {
  const url = 'http://localhost/api/tool-grants';
  return {
    request: new Request(url, {
      method,
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

describe('POST /api/tool-grants', () => {
  it('201 issues a grant', async () => {
    const tool = registerTool({ toolSlug: 'x', kind: 'skill', name: 'X' });
    const res = await callOrUnwrap(() =>
      POST(
        makeReq('POST', {
          granteeHandle: '@speedyc',
          toolId: tool.toolId,
          scopeKind: 'global'
        })
      )
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.grant.grantId).toMatch(/^tg_/);
    const found = lookupActiveGrant({
      granteeHandle: '@speedyc',
      toolId: tool.toolId,
      scopeKind: 'global'
    });
    expect(found).not.toBeNull();
  });

  it('201 honours room-scoped grant with scopeId', async () => {
    const tool = registerTool({ toolSlug: 'x', kind: 'skill', name: 'X' });
    const res = await callOrUnwrap(() =>
      POST(
        makeReq('POST', {
          granteeHandle: '@speedyc',
          toolId: tool.toolId,
          scopeKind: 'room',
          scopeId: 'orsz2321qb',
          reason: 'temporary debug access'
        })
      )
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.grant.scopeId).toBe('orsz2321qb');
    expect(body.grant.reason).toBe('temporary debug access');
  });

  it('400 when granteeHandle missing', async () => {
    const tool = registerTool({ toolSlug: 'x', kind: 'skill', name: 'X' });
    const res = await callOrUnwrap(() =>
      POST(makeReq('POST', { toolId: tool.toolId, scopeKind: 'global' }))
    );
    expect(res.status).toBe(400);
  });

  it('400 when toolId missing', async () => {
    const res = await callOrUnwrap(() =>
      POST(makeReq('POST', { granteeHandle: '@x', scopeKind: 'global' }))
    );
    expect(res.status).toBe(400);
  });

  it('400 when scopeKind invalid', async () => {
    const tool = registerTool({ toolSlug: 'x', kind: 'skill', name: 'X' });
    const res = await callOrUnwrap(() =>
      POST(
        makeReq('POST', {
          granteeHandle: '@x',
          toolId: tool.toolId,
          scopeKind: 'planet'
        })
      )
    );
    expect(res.status).toBe(400);
  });

  it('404 when tool does not exist', async () => {
    const res = await callOrUnwrap(() =>
      POST(
        makeReq('POST', {
          granteeHandle: '@x',
          toolId: 'tool_nope',
          scopeKind: 'global'
        })
      )
    );
    expect(res.status).toBe(404);
  });

  it('400 when granting a retired tool', async () => {
    const tool = registerTool({ toolSlug: 'x', kind: 'skill', name: 'X' });
    retireTool(tool.toolId);
    const res = await callOrUnwrap(() =>
      POST(
        makeReq('POST', {
          granteeHandle: '@x',
          toolId: tool.toolId,
          scopeKind: 'global'
        })
      )
    );
    expect(res.status).toBe(400);
  });

  it('401 when bearer wrong', async () => {
    const tool = registerTool({ toolSlug: 'x', kind: 'skill', name: 'X' });
    const res = await callOrUnwrap(() =>
      POST(
        makeReq(
          'POST',
          { granteeHandle: '@x', toolId: tool.toolId, scopeKind: 'global' },
          'wrong'
        )
      )
    );
    expect(res.status).toBe(401);
  });

  it('503 when admin token unset', async () => {
    delete process.env.ANT_ADMIN_TOKEN;
    const res = await callOrUnwrap(() =>
      POST(
        makeReq('POST', {
          granteeHandle: '@x',
          toolId: 'tool_x',
          scopeKind: 'global'
        })
      )
    );
    expect(res.status).toBe(503);
  });
});

describe('DELETE /api/tool-grants', () => {
  it('200 revokes an active grant', async () => {
    const tool = registerTool({ toolSlug: 'x', kind: 'skill', name: 'X' });
    await callOrUnwrap(() =>
      POST(
        makeReq('POST', {
          granteeHandle: '@x',
          toolId: tool.toolId,
          scopeKind: 'global'
        })
      )
    );
    const res = await callOrUnwrap(() =>
      DELETE(
        makeReq('DELETE', {
          granteeHandle: '@x',
          toolId: tool.toolId,
          scopeKind: 'global'
        })
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.revokedCount).toBe(1);
  });

  it('200 zero count when no active grant', async () => {
    const res = await callOrUnwrap(() =>
      DELETE(
        makeReq('DELETE', {
          granteeHandle: '@x',
          toolId: 'tool_x',
          scopeKind: 'global'
        })
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.revokedCount).toBe(0);
  });

  it('400 when scopeKind invalid', async () => {
    const res = await callOrUnwrap(() =>
      DELETE(
        makeReq('DELETE', {
          granteeHandle: '@x',
          toolId: 'tool_x',
          scopeKind: 'planet'
        })
      )
    );
    expect(res.status).toBe(400);
  });

  it('401 when bearer wrong', async () => {
    const res = await callOrUnwrap(() =>
      DELETE(
        makeReq(
          'DELETE',
          { granteeHandle: '@x', toolId: 'tool_x', scopeKind: 'global' },
          'wrong'
        )
      )
    );
    expect(res.status).toBe(401);
  });
});
