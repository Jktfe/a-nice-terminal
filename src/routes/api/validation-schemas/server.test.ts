import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './+server';
import { createValidationSchema } from '$lib/server/validationLensStore';
import { getIdentityDb } from '$lib/server/db';

const ORIGINAL_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;

function eventFor(request: Request): Parameters<typeof GET>[0] {
  const url = new URL(request.url);
  return { request, url, params: {} } as Parameters<typeof GET>[0];
}

async function getSchemaIds(request: Request): Promise<string[]> {
  const response = await GET(eventFor(request)) as Response;
  const payload = await response.json() as { schemas: Array<{ id: string }> };
  return payload.schemas.map((schema) => schema.id).sort();
}

function createScopedSchema(input: {
  id: string;
  scope: 'org' | 'user' | 'public';
  scopeId: string;
}): void {
  createValidationSchema({
    id: input.id,
    name: input.id,
    description: input.id,
    lensKind: 'custom',
    rulesJson: '[]',
    createdBy: '@test',
    archivedAtMs: null,
    scope: input.scope,
    scopeId: input.scopeId,
  });
}

beforeEach(() => {
  process.env.ANT_ADMIN_TOKEN = 'admin-secret';
  const db = getIdentityDb();
  db.prepare('DELETE FROM validation_runs').run();
  db.prepare('DELETE FROM validation_schemas').run();
});

afterEach(() => {
  vi.restoreAllMocks();
  if (ORIGINAL_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = ORIGINAL_ADMIN_TOKEN;
});

describe('GET /api/validation-schemas', () => {
  it('returns only public schemas without authentication', async () => {
    createScopedSchema({ id: 'public-lens', scope: 'public', scopeId: 'global' });
    createScopedSchema({ id: 'user-lens', scope: 'user', scopeId: '@james' });
    createScopedSchema({ id: 'org-lens', scope: 'org', scopeId: 'org_newmodel_team' });

    await expect(getSchemaIds(new Request('http://test.local/api/validation-schemas')))
      .resolves.toEqual(['lens-fca', 'lens-investment', 'lens-poc', 'public-lens']);
  });

  it('returns user and org schemas for an accounts bearer identity', async () => {
    createScopedSchema({ id: 'public-lens', scope: 'public', scopeId: 'global' });
    createScopedSchema({ id: 'user-lens', scope: 'user', scopeId: '@jamesK' });
    createScopedSchema({ id: 'org-lens', scope: 'org', scopeId: 'org_newmodel_team' });
    createScopedSchema({ id: 'other-user-lens', scope: 'user', scopeId: '@someone' });
    createScopedSchema({ id: 'other-org-lens', scope: 'org', scopeId: 'org_other' });

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      user: { email: 'redacted@example.com', handle: '@jamesK' },
      orgId: 'org_newmodel_team',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })));

    await expect(getSchemaIds(new Request('http://test.local/api/validation-schemas', {
      headers: { authorization: 'Bearer accounts-token' },
    }))).resolves.toEqual([
      'lens-fca',
      'lens-investment',
      'lens-poc',
      'org-lens',
      'public-lens',
      'user-lens',
    ]);
  });

  it('returns every schema for the admin bearer', async () => {
    createScopedSchema({ id: 'public-lens', scope: 'public', scopeId: 'global' });
    createScopedSchema({ id: 'user-lens', scope: 'user', scopeId: '@james' });
    createScopedSchema({ id: 'org-lens', scope: 'org', scopeId: 'org_newmodel_team' });

    await expect(getSchemaIds(new Request('http://test.local/api/validation-schemas', {
      headers: { authorization: 'Bearer admin-secret' },
    }))).resolves.toEqual([
      'lens-fca',
      'lens-investment',
      'lens-poc',
      'org-lens',
      'public-lens',
      'user-lens',
    ]);
  });
});
