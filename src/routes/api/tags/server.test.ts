/**
 * /api/tags endpoint tests — A9 Slice 7b: tag CRUD.
 *
 * Covers POST (create), GET (list with filters), per-id deprecate + audit,
 * single-tag GET. Admin-bearer gate + body validation paths covered.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST as tagsPost, GET as tagsGet } from './+server';
import { GET as tagGet } from './[tagId]/+server';
import { POST as tagDeprecate } from './[tagId]/deprecate/+server';
import { GET as tagAudit } from './[tagId]/audit/+server';
import { resetVerificationTaxonomyStoreForTests, createTag } from '$lib/server/verificationTaxonomyStore';
import { resetIdentityDbForTests } from '$lib/server/db';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;
const previousAdminBearer = process.env.ANT_ADMIN_BEARER;
const TEST_ADMIN = 'rba_test_token_for_tags';

type AnyHandler = (event: unknown) => unknown;

function eventFor(method: string, path: string, init: RequestInit = {}, params: Record<string, string> = {}): unknown {
  const url = new URL(`http://localhost${path}`);
  const request = new Request(url.toString(), { method, ...init });
  return { request, params, url };
}

async function runHandler(handler: AnyHandler, event: unknown): Promise<Response> {
  try { return (await handler(event)) as Response; }
  catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const httpFailure = thrown as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
    }
    throw thrown;
  }
}

function authedPost(path: string, body: unknown, params: Record<string, string> = {}, token = TEST_ADMIN): unknown {
  return eventFor('POST', path, {
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  }, params);
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-tags-route-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  process.env.ANT_ADMIN_BEARER = TEST_ADMIN;
  resetIdentityDbForTests();
  resetVerificationTaxonomyStoreForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
  if (previousAdminBearer === undefined) delete process.env.ANT_ADMIN_BEARER;
  else process.env.ANT_ADMIN_BEARER = previousAdminBearer;
});

const SAMPLE_TAG = {
  id: 'org.acme.compliance-claim',
  name: 'Compliance claim',
  description: 'A claim subject to regulatory review',
  category: 'claim',
  provenance: 'org',
  scope_id: 'acme',
  protocol_resolver: { kind: 'static', protocol: 'consensus-required' },
  is_relational: false,
  is_human_editable: true,
  author_handle: '@compliance-team',
  author_kind: 'human'
};

describe('/api/tags POST', () => {
  it('T1: creates a tag with version 1 + lifecycle event, returns 201', async () => {
    const response = await runHandler(tagsPost as unknown as AnyHandler,
      authedPost('/api/tags', SAMPLE_TAG));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.tag.id).toBe(SAMPLE_TAG.id);
    expect(body.tag.version).toBe(1);
    expect(body.tag.category).toBe('claim');
  });

  it('T2: rejects missing admin bearer with 401', async () => {
    const event = eventFor('POST', '/api/tags', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(SAMPLE_TAG)
    });
    const response = await runHandler(tagsPost as unknown as AnyHandler, event);
    expect(response.status).toBe(401);
  });

  it('T3: rejects invalid provenance with 400', async () => {
    const response = await runHandler(tagsPost as unknown as AnyHandler,
      authedPost('/api/tags', { ...SAMPLE_TAG, provenance: 'bogus' }));
    expect(response.status).toBe(400);
  });

  it('T4: rejects duplicate id (createTag throws) with 400', async () => {
    await runHandler(tagsPost as unknown as AnyHandler, authedPost('/api/tags', SAMPLE_TAG));
    const second = await runHandler(tagsPost as unknown as AnyHandler,
      authedPost('/api/tags', SAMPLE_TAG));
    expect(second.status).toBe(400);
  });

  it('T5: rejects missing required field with 400', async () => {
    const { name, ...incomplete } = SAMPLE_TAG;
    const response = await runHandler(tagsPost as unknown as AnyHandler,
      authedPost('/api/tags', incomplete));
    expect(response.status).toBe(400);
  });
});

describe('/api/tags GET', () => {
  it('T6: lists all tags (no filter)', async () => {
    createTag({
      id: 'a', name: 'A', description: 'd', category: 'claim',
      provenance: 'system', scopeId: 'global',
      protocolResolver: { kind: 'static', protocol: 'deterministic' },
      isRelational: false, familyRoot: null, isHumanEditable: true,
      createdBy: '@sys'
    });
    createTag({
      id: 'b', name: 'B', description: 'd', category: 'source',
      provenance: 'org', scopeId: 'acme',
      protocolResolver: { kind: 'static', protocol: 'heuristic' },
      isRelational: false, familyRoot: null, isHumanEditable: true,
      createdBy: '@admin'
    });
    const response = await runHandler(tagsGet as unknown as AnyHandler,
      eventFor('GET', '/api/tags'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.tags.length).toBeGreaterThanOrEqual(2);
  });

  it('T7: filters by provenance', async () => {
    createTag({
      id: 'sys-1', name: 's', description: 'd', category: 'claim',
      provenance: 'system', scopeId: 'global',
      protocolResolver: { kind: 'static', protocol: 'deterministic' },
      isRelational: false, familyRoot: null, isHumanEditable: true,
      createdBy: '@sys'
    });
    createTag({
      id: 'org-1', name: 'o', description: 'd', category: 'claim',
      provenance: 'org', scopeId: 'acme',
      protocolResolver: { kind: 'static', protocol: 'heuristic' },
      isRelational: false, familyRoot: null, isHumanEditable: true,
      createdBy: '@admin'
    });
    const response = await runHandler(tagsGet as unknown as AnyHandler,
      eventFor('GET', '/api/tags?provenance=org'));
    const body = await response.json();
    expect(body.tags).toHaveLength(1);
    expect(body.tags[0].provenance).toBe('org');
  });
});

describe('/api/tags/[tagId] GET', () => {
  it('T8: returns latest tag version', async () => {
    createTag({
      id: 'org.x', name: 'X', description: 'd', category: 'claim',
      provenance: 'org', scopeId: 'acme',
      protocolResolver: { kind: 'static', protocol: 'heuristic' },
      isRelational: false, familyRoot: null, isHumanEditable: true,
      createdBy: '@admin'
    });
    const response = await runHandler(tagGet as unknown as AnyHandler,
      eventFor('GET', '/api/tags/org.x', {}, { tagId: 'org.x' }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.tag.id).toBe('org.x');
  });

  it('T9: returns 404 for non-existent tag', async () => {
    const response = await runHandler(tagGet as unknown as AnyHandler,
      eventFor('GET', '/api/tags/no-such', {}, { tagId: 'no-such' }));
    expect(response.status).toBe(404);
  });
});

describe('/api/tags/[tagId]/deprecate POST', () => {
  it('T10: deprecates a tag, returns updated tag with state=deprecated', async () => {
    createTag({
      id: 'org.dep', name: 'D', description: 'd', category: 'claim',
      provenance: 'org', scopeId: 'acme',
      protocolResolver: { kind: 'static', protocol: 'heuristic' },
      isRelational: false, familyRoot: null, isHumanEditable: true,
      createdBy: '@admin'
    });
    const response = await runHandler(tagDeprecate as unknown as AnyHandler,
      authedPost('/api/tags/org.dep/deprecate',
        { actor_handle: '@admin', actor_kind: 'human', reason: 'no longer used' },
        { tagId: 'org.dep' }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.tag.lifecycleState).toBe('deprecated');
  });

  it('T11: returns 404 for non-existent tag', async () => {
    const response = await runHandler(tagDeprecate as unknown as AnyHandler,
      authedPost('/api/tags/no-such/deprecate',
        { actor_handle: '@admin', actor_kind: 'human' },
        { tagId: 'no-such' }));
    expect(response.status).toBe(404);
  });

  it('T12: supersedes when replacement_tag_id provided', async () => {
    createTag({
      id: 'org.old', name: 'O', description: 'd', category: 'claim',
      provenance: 'org', scopeId: 'acme',
      protocolResolver: { kind: 'static', protocol: 'heuristic' },
      isRelational: false, familyRoot: null, isHumanEditable: true,
      createdBy: '@admin'
    });
    createTag({
      id: 'org.new', name: 'N', description: 'd', category: 'claim',
      provenance: 'org', scopeId: 'acme',
      protocolResolver: { kind: 'static', protocol: 'heuristic' },
      isRelational: false, familyRoot: null, isHumanEditable: true,
      createdBy: '@admin'
    });
    const response = await runHandler(tagDeprecate as unknown as AnyHandler,
      authedPost('/api/tags/org.old/deprecate',
        { actor_handle: '@admin', actor_kind: 'human', replacement_tag_id: 'org.new' },
        { tagId: 'org.old' }));
    const body = await response.json();
    expect(body.tag.lifecycleState).toBe('superseded');
    expect(body.tag.supersededById).toBe('org.new');
  });
});

describe('/api/tags/[tagId]/audit GET', () => {
  it('T13: returns lifecycle event chain for a tag', async () => {
    createTag({
      id: 'org.audit', name: 'A', description: 'd', category: 'claim',
      provenance: 'org', scopeId: 'acme',
      protocolResolver: { kind: 'static', protocol: 'heuristic' },
      isRelational: false, familyRoot: null, isHumanEditable: true,
      createdBy: '@admin'
    });
    const response = await runHandler(tagAudit as unknown as AnyHandler,
      eventFor('GET', '/api/tags/org.audit/audit', {}, { tagId: 'org.audit' }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.events.length).toBeGreaterThanOrEqual(1);
    expect(body.events[0].eventKind).toBe('create');
  });
});
