/**
 * Endpoint tests for /api/tools/audit — PR-D tools catalog audit surface.
 *
 * Covers the four audit modes (tools / grants / revocations / orphans)
 * with the underlying store seeded directly so the test exercises both
 * the endpoint and the store joins.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { GET } from './+server';
import {
  registerTool,
  grantTool,
  revokeToolGrant,
  retireTool,
  resetToolsCatalogForTests
} from '$lib/server/toolsCatalogStore';

beforeEach(() => {
  resetToolsCatalogForTests();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeGet(query: string = ''): any {
  const url = `http://localhost/api/tools/audit${query}`;
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

describe('GET /api/tools/audit?audit=tools', () => {
  it('attaches grantCount per tool', async () => {
    const a = registerTool({ toolSlug: 'a', kind: 'skill', name: 'A' });
    const b = registerTool({ toolSlug: 'b', kind: 'skill', name: 'B' });
    grantTool({
      granteeHandle: '@x',
      toolId: a.toolId,
      scopeKind: 'global',
      grantedByHandle: '@y'
    });
    grantTool({
      granteeHandle: '@z',
      toolId: a.toolId,
      scopeKind: 'global',
      grantedByHandle: '@y'
    });
    const res = await callOrUnwrap(() => GET(makeGet('?audit=tools')));
    expect(res.status).toBe(200);
    const body = await res.json();
    const aRow = body.tools.find((t: { toolSlug: string }) => t.toolSlug === 'a');
    const bRow = body.tools.find((t: { toolSlug: string }) => t.toolSlug === 'b');
    expect(aRow.grantCount).toBe(2);
    expect(bRow.grantCount).toBe(0);
    void b;
  });

  it('filters by owner_org', async () => {
    registerTool({ toolSlug: 'a', kind: 'skill', name: 'A', ownerOrg: 'orgA' });
    registerTool({ toolSlug: 'b', kind: 'skill', name: 'B', ownerOrg: 'orgB' });
    const res = await callOrUnwrap(() =>
      GET(makeGet('?audit=tools&owner_org=orgA'))
    );
    const body = await res.json();
    expect(body.tools.map((t: { toolSlug: string }) => t.toolSlug)).toEqual(['a']);
  });
});

describe('GET /api/tools/audit?audit=grants', () => {
  it('returns only active grants and attaches toolSlug', async () => {
    const t = registerTool({ toolSlug: 'graphify', kind: 'skill', name: 'Graphify' });
    grantTool({
      granteeHandle: '@a',
      toolId: t.toolId,
      scopeKind: 'global',
      grantedByHandle: '@y'
    });
    grantTool({
      granteeHandle: '@b',
      toolId: t.toolId,
      scopeKind: 'global',
      grantedByHandle: '@y'
    });
    revokeToolGrant({ granteeHandle: '@b', toolId: t.toolId, scopeKind: 'global' });
    const res = await callOrUnwrap(() => GET(makeGet('?audit=grants')));
    const body = await res.json();
    expect(body.grants).toHaveLength(1);
    expect(body.grants[0].toolSlug).toBe('graphify');
    expect(body.grants[0].granteeHandle).toBe('@a');
  });

  it('filters by agent', async () => {
    const t = registerTool({ toolSlug: 'x', kind: 'skill', name: 'X' });
    grantTool({
      granteeHandle: '@a',
      toolId: t.toolId,
      scopeKind: 'global',
      grantedByHandle: '@y'
    });
    grantTool({
      granteeHandle: '@b',
      toolId: t.toolId,
      scopeKind: 'global',
      grantedByHandle: '@y'
    });
    const res = await callOrUnwrap(() => GET(makeGet('?audit=grants&agent=@a')));
    const body = await res.json();
    expect(body.grants).toHaveLength(1);
    expect(body.grants[0].granteeHandle).toBe('@a');
  });

  it('filters by scope_kind', async () => {
    const t = registerTool({ toolSlug: 'x', kind: 'skill', name: 'X' });
    grantTool({
      granteeHandle: '@a',
      toolId: t.toolId,
      scopeKind: 'global',
      grantedByHandle: '@y'
    });
    grantTool({
      granteeHandle: '@a',
      toolId: t.toolId,
      scopeKind: 'room',
      scopeId: 'r1',
      grantedByHandle: '@y'
    });
    const res = await callOrUnwrap(() =>
      GET(makeGet('?audit=grants&scope_kind=room'))
    );
    const body = await res.json();
    expect(body.grants).toHaveLength(1);
    expect(body.grants[0].scopeKind).toBe('room');
  });

  it('400 on invalid scope_kind', async () => {
    const res = await callOrUnwrap(() =>
      GET(makeGet('?audit=grants&scope_kind=planet'))
    );
    expect(res.status).toBe(400);
  });
});

describe('GET /api/tools/audit?audit=revocations', () => {
  it('returns revocations within the since_ms window', async () => {
    const t = registerTool({ toolSlug: 'x', kind: 'skill', name: 'X' });
    grantTool({
      granteeHandle: '@a',
      toolId: t.toolId,
      scopeKind: 'global',
      grantedByHandle: '@y'
    });
    revokeToolGrant({ granteeHandle: '@a', toolId: t.toolId, scopeKind: 'global' });
    const res = await callOrUnwrap(() =>
      GET(makeGet(`?audit=revocations&since_ms=${7 * 86_400_000}`))
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.revocations).toHaveLength(1);
    expect(body.revocations[0].toolSlug).toBe('x');
  });

  it('400 when since_ms is invalid', async () => {
    const res = await callOrUnwrap(() => GET(makeGet('?audit=revocations&since_ms=0')));
    expect(res.status).toBe(400);
  });
});

describe('GET /api/tools/audit?audit=orphans', () => {
  it('returns active grants pointing at retired tools (the nifty-leak case)', async () => {
    const tool = registerTool({ toolSlug: 'nifty', kind: 'skill', name: 'Nifty' });
    grantTool({
      granteeHandle: '@speedyc',
      toolId: tool.toolId,
      scopeKind: 'global',
      grantedByHandle: '@jwpk'
    });
    retireTool(tool.toolId);
    const res = await callOrUnwrap(() => GET(makeGet('?audit=orphans')));
    const body = await res.json();
    expect(body.orphanGrants).toHaveLength(1);
    expect(body.orphanGrants[0].toolSlug).toBe('nifty');
  });

  it('returns tools with no active grants in orphanTools', async () => {
    registerTool({ toolSlug: 'unused', kind: 'skill', name: 'U' });
    const used = registerTool({ toolSlug: 'used', kind: 'skill', name: 'U' });
    grantTool({
      granteeHandle: '@x',
      toolId: used.toolId,
      scopeKind: 'global',
      grantedByHandle: '@y'
    });
    const res = await callOrUnwrap(() => GET(makeGet('?audit=orphans')));
    const body = await res.json();
    expect(body.orphanTools.map((t: { toolSlug: string }) => t.toolSlug)).toEqual(['unused']);
  });
});

describe('GET /api/tools/audit invalid mode', () => {
  it('400 when audit param is unknown', async () => {
    const res = await callOrUnwrap(() => GET(makeGet('?audit=banana')));
    expect(res.status).toBe(400);
  });
});
