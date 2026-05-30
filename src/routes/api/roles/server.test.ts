/**
 * /api/roles endpoint tests — M6.1 RBAC role registry of the antOS
 * Enterprise Control Plane plan.
 *
 * Routes covered:
 *   GET  /api/roles               — admin-bearer required
 *   POST /api/roles               — admin-bearer required, 400 on
 *                                   seeded/duplicate roleId
 *   GET  /api/roles/[roleId]
 *   PATCH /api/roles/[roleId]     — admin-bearer required, 403 on seeded
 *   DELETE /api/roles/[roleId]    — admin-bearer required, 403 on seeded
 *   POST /api/roles/[roleId]/assign — admin-bearer required, 404 on
 *                                     unknown role, 400 on bad scope
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET, POST } from './+server';
import {
  GET as GET_ONE,
  PATCH,
  DELETE
} from './[roleId]/+server';
import { POST as ASSIGN } from './[roleId]/assign/+server';
import { resetIdentityDbForTests } from '$lib/server/db';
import { resetRolesRegistryForTests } from '$lib/server/rolesRegistryStore';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;
const previousAdminToken = process.env.ANT_ADMIN_TOKEN;
const TEST_ADMIN = 'admin-token-for-roles-tests';

type AnyHandler = (event: unknown) => unknown;

function eventFor(
  path: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  init: RequestInit & { params?: Record<string, string> } = {}
): unknown {
  const url = new URL(`http://localhost${path}`);
  const { params = {}, ...rest } = init;
  const request = new Request(url.toString(), { method, ...rest });
  return { request, params, url };
}

async function runHandler(handler: AnyHandler, event: unknown): Promise<Response> {
  try {
    return (await handler(event)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const httpFailure = thrown as { status?: number; body?: unknown };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), {
        status: httpFailure.status
      });
    }
    throw thrown;
  }
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-roles-route-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  process.env.ANT_ADMIN_TOKEN = TEST_ADMIN;
  resetIdentityDbForTests();
  resetRolesRegistryForTests();
});

afterEach(() => {
  if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
  if (previousAdminToken === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = previousAdminToken;
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('GET /api/roles', () => {
  it('returns the four seeded roles for an admin-bearer caller', async () => {
    const event = eventFor('/api/roles', 'GET', {
      headers: { authorization: `Bearer ${TEST_ADMIN}` }
    });
    const response = await runHandler(GET as AnyHandler, event);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { roles: Array<{ roleId: string }> };
    const ids = body.roles.map((r) => r.roleId).sort();
    expect(ids).toEqual(['super-admin', 'org-admin', 'room-owner', 'member'].sort());
  });

  it('401 without admin-bearer', async () => {
    const event = eventFor('/api/roles', 'GET');
    const response = await runHandler(GET as AnyHandler, event);
    expect(response.status).toBe(401);
  });
});

describe('POST /api/roles', () => {
  it('201 creates a custom role', async () => {
    const event = eventFor('/api/roles', 'POST', {
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TEST_ADMIN}`
      },
      body: JSON.stringify({
        roleId: 'auditor',
        name: 'Auditor',
        description: 'Forensic read access',
        capabilities: [{ capability: 'audit.read', scope: 'org' }]
      })
    });
    const response = await runHandler(POST as AnyHandler, event);
    expect(response.status).toBe(201);
    const body = (await response.json()) as { role: { roleId: string } };
    expect(body.role.roleId).toBe('auditor');
  });

  it('400 when roleId is a reserved/seeded id', async () => {
    const event = eventFor('/api/roles', 'POST', {
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TEST_ADMIN}`
      },
      body: JSON.stringify({
        roleId: 'super-admin',
        name: 'Shadow',
        capabilities: []
      })
    });
    const response = await runHandler(POST as AnyHandler, event);
    expect(response.status).toBe(400);
  });

  it('400 when body is malformed (missing name)', async () => {
    const event = eventFor('/api/roles', 'POST', {
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TEST_ADMIN}`
      },
      body: JSON.stringify({ roleId: 'r1', capabilities: [] })
    });
    const response = await runHandler(POST as AnyHandler, event);
    expect(response.status).toBe(400);
  });

  it('401 without admin-bearer', async () => {
    const event = eventFor('/api/roles', 'POST', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ roleId: 'auditor', name: 'A', capabilities: [] })
    });
    const response = await runHandler(POST as AnyHandler, event);
    expect(response.status).toBe(401);
  });
});

describe('GET /api/roles/[roleId]', () => {
  it('200 returns a seeded role', async () => {
    const event = eventFor('/api/roles/super-admin', 'GET', {
      headers: { authorization: `Bearer ${TEST_ADMIN}` },
      params: { roleId: 'super-admin' }
    });
    const response = await runHandler(GET_ONE as AnyHandler, event);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { role: { roleId: string } };
    expect(body.role.roleId).toBe('super-admin');
  });

  it('404 when unknown', async () => {
    const event = eventFor('/api/roles/nope', 'GET', {
      headers: { authorization: `Bearer ${TEST_ADMIN}` },
      params: { roleId: 'nope' }
    });
    const response = await runHandler(GET_ONE as AnyHandler, event);
    expect(response.status).toBe(404);
  });

  it('401 without admin-bearer', async () => {
    const event = eventFor('/api/roles/super-admin', 'GET', {
      params: { roleId: 'super-admin' }
    });
    const response = await runHandler(GET_ONE as AnyHandler, event);
    expect(response.status).toBe(401);
  });
});

describe('PATCH /api/roles/[roleId]', () => {
  it('200 patches a custom role', async () => {
    // Seed a custom role first.
    await runHandler(
      POST as AnyHandler,
      eventFor('/api/roles', 'POST', {
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${TEST_ADMIN}`
        },
        body: JSON.stringify({
          roleId: 'r1',
          name: 'Original',
          capabilities: []
        })
      })
    );
    const event = eventFor('/api/roles/r1', 'PATCH', {
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TEST_ADMIN}`
      },
      params: { roleId: 'r1' },
      body: JSON.stringify({ name: 'Renamed' })
    });
    const response = await runHandler(PATCH as AnyHandler, event);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { role: { name: string } };
    expect(body.role.name).toBe('Renamed');
  });

  it('403 when targeting a seeded role', async () => {
    const event = eventFor('/api/roles/member', 'PATCH', {
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TEST_ADMIN}`
      },
      params: { roleId: 'member' },
      body: JSON.stringify({ name: 'Renamed' })
    });
    const response = await runHandler(PATCH as AnyHandler, event);
    expect(response.status).toBe(403);
  });

  it('404 when role unknown', async () => {
    const event = eventFor('/api/roles/nope', 'PATCH', {
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TEST_ADMIN}`
      },
      params: { roleId: 'nope' },
      body: JSON.stringify({ name: 'X' })
    });
    const response = await runHandler(PATCH as AnyHandler, event);
    expect(response.status).toBe(404);
  });

  it('401 without admin-bearer', async () => {
    const event = eventFor('/api/roles/member', 'PATCH', {
      headers: { 'content-type': 'application/json' },
      params: { roleId: 'member' },
      body: JSON.stringify({ name: 'X' })
    });
    const response = await runHandler(PATCH as AnyHandler, event);
    expect(response.status).toBe(401);
  });
});

describe('DELETE /api/roles/[roleId]', () => {
  it('204 deletes a custom role', async () => {
    await runHandler(
      POST as AnyHandler,
      eventFor('/api/roles', 'POST', {
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${TEST_ADMIN}`
        },
        body: JSON.stringify({ roleId: 'r1', name: 'X', capabilities: [] })
      })
    );
    const event = eventFor('/api/roles/r1', 'DELETE', {
      headers: { authorization: `Bearer ${TEST_ADMIN}` },
      params: { roleId: 'r1' }
    });
    const response = await runHandler(DELETE as AnyHandler, event);
    expect(response.status).toBe(204);
  });

  it('403 when targeting a seeded role', async () => {
    const event = eventFor('/api/roles/super-admin', 'DELETE', {
      headers: { authorization: `Bearer ${TEST_ADMIN}` },
      params: { roleId: 'super-admin' }
    });
    const response = await runHandler(DELETE as AnyHandler, event);
    expect(response.status).toBe(403);
  });

  it('401 without admin-bearer', async () => {
    const event = eventFor('/api/roles/r1', 'DELETE', { params: { roleId: 'r1' } });
    const response = await runHandler(DELETE as AnyHandler, event);
    expect(response.status).toBe(401);
  });
});

describe('POST /api/roles/[roleId]/assign', () => {
  it('201 assigns a role to an identity', async () => {
    const event = eventFor('/api/roles/member/assign', 'POST', {
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TEST_ADMIN}`
      },
      params: { roleId: 'member' },
      body: JSON.stringify({
        identityHandle: '@rox',
        scopeKind: 'room',
        scopeId: 'r1'
      })
    });
    const response = await runHandler(ASSIGN as AnyHandler, event);
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      assignment: { assignmentId: string; roleId: string };
    };
    expect(body.assignment.assignmentId).toMatch(/^ra_/);
    expect(body.assignment.roleId).toBe('member');
  });

  it('404 when role unknown', async () => {
    const event = eventFor('/api/roles/nope/assign', 'POST', {
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TEST_ADMIN}`
      },
      params: { roleId: 'nope' },
      body: JSON.stringify({
        identityHandle: '@a',
        scopeKind: 'org',
        scopeId: 'org_x'
      })
    });
    const response = await runHandler(ASSIGN as AnyHandler, event);
    expect(response.status).toBe(404);
  });

  it('400 when scopeKind is invalid', async () => {
    const event = eventFor('/api/roles/member/assign', 'POST', {
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TEST_ADMIN}`
      },
      params: { roleId: 'member' },
      body: JSON.stringify({
        identityHandle: '@a',
        scopeKind: 'mystery',
        scopeId: 'r1'
      })
    });
    const response = await runHandler(ASSIGN as AnyHandler, event);
    expect(response.status).toBe(400);
  });

  it('400 when identityHandle missing', async () => {
    const event = eventFor('/api/roles/member/assign', 'POST', {
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TEST_ADMIN}`
      },
      params: { roleId: 'member' },
      body: JSON.stringify({ scopeKind: 'room', scopeId: 'r1' })
    });
    const response = await runHandler(ASSIGN as AnyHandler, event);
    expect(response.status).toBe(400);
  });

  it('401 without admin-bearer', async () => {
    const event = eventFor('/api/roles/member/assign', 'POST', {
      headers: { 'content-type': 'application/json' },
      params: { roleId: 'member' },
      body: JSON.stringify({
        identityHandle: '@a',
        scopeKind: 'org',
        scopeId: 'org_x'
      })
    });
    const response = await runHandler(ASSIGN as AnyHandler, event);
    expect(response.status).toBe(401);
  });
});
