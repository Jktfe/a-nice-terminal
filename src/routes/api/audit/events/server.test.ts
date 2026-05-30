/**
 * GET /api/audit/events tests — admin-bearer gated reader over the
 * canonical v0.2 audit_events table, with JSON + NDJSON negotiation.
 */

import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GET } from './+server';
import { resetIdentityDbForTests } from '$lib/server/db';
import { appendAuditEvent } from '$lib/server/auditEventsStore';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;
const previousAdminToken = process.env.ANT_ADMIN_TOKEN;

const ADMIN_TOKEN = 'test-admin-token-for-audit-events';

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-audit-route-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN;
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
  if (previousAdminToken === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = previousAdminToken;
});

function eventForGet(path: string, headers: Record<string, string> = {}) {
  const url = new URL(`http://localhost${path}`);
  const request = new Request(url.toString(), {
    method: 'GET',
    headers: {
      authorization: `Bearer ${ADMIN_TOKEN}`,
      ...headers
    }
  });
  return { request, params: {}, url } as unknown as Parameters<typeof GET>[0];
}

async function callGet(path: string, headers: Record<string, string> = {}): Promise<Response> {
  try {
    return (await GET(eventForGet(path, headers))) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const httpFailure = thrown as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
    }
    throw thrown;
  }
}

describe('GET /api/audit/events — auth gate', () => {
  it('returns 401 without admin-bearer', async () => {
    const url = new URL('http://localhost/api/audit/events');
    const request = new Request(url.toString(), { method: 'GET' });
    const event = { request, params: {}, url } as unknown as Parameters<typeof GET>[0];
    let response: Response;
    try {
      response = (await GET(event)) as Response;
    } catch (thrown) {
      response = thrown as Response;
    }
    expect(response.status).toBe(401);
  });

  it('returns 401 with non-matching bearer token', async () => {
    const response = await callGet('/api/audit/events', { authorization: 'Bearer wrong-token' });
    expect(response.status).toBe(401);
  });
});

describe('GET /api/audit/events — JSON happy path', () => {
  it('returns events + null nextCursor when empty', async () => {
    const response = await callGet('/api/audit/events');
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.events).toEqual([]);
    expect(payload.nextCursor).toBeNull();
  });

  it('returns inserted events in JSON envelope', async () => {
    appendAuditEvent({ kind: 'r.1', entityKind: 'system', entityId: 'e1' });
    appendAuditEvent({ kind: 'r.2', entityKind: 'system', entityId: 'e2' });
    const response = await callGet('/api/audit/events');
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.events).toHaveLength(2);
    expect(payload.events[0]).toHaveProperty('auditId');
    expect(payload.events[0]).toHaveProperty('atMs');
    expect(payload.events[0]).toHaveProperty('kind');
  });

  it('advances cursor across pages', async () => {
    for (let i = 0; i < 5; i++) {
      appendAuditEvent({ kind: 'p.x', entityKind: 'system', entityId: `e${i}` });
    }
    const page1 = await callGet('/api/audit/events?limit=2');
    const body1 = await page1.json();
    expect(body1.events).toHaveLength(2);
    expect(body1.nextCursor).not.toBeNull();

    const page2 = await callGet(
      `/api/audit/events?limit=2&cursor=${encodeURIComponent(body1.nextCursor)}`
    );
    const body2 = await page2.json();
    expect(body2.events).toHaveLength(2);

    const page3 = await callGet(
      `/api/audit/events?limit=2&cursor=${encodeURIComponent(body2.nextCursor)}`
    );
    const body3 = await page3.json();
    expect(body3.events).toHaveLength(1);
    expect(body3.nextCursor).toBeNull();
  });

  it('applies query-string filters', async () => {
    appendAuditEvent({ kind: 'f.a', entityKind: 'system', entityId: 'a' });
    appendAuditEvent({ kind: 'f.b', entityKind: 'system', entityId: 'b' });
    const response = await callGet('/api/audit/events?kind=f.a');
    const body = await response.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0].kind).toBe('f.a');
  });
});

describe('GET /api/audit/events — NDJSON negotiation', () => {
  it('streams NDJSON when Accept: application/x-ndjson', async () => {
    appendAuditEvent({ kind: 'nd.1', entityKind: 'system', entityId: 'a' });
    appendAuditEvent({ kind: 'nd.2', entityKind: 'system', entityId: 'b' });
    const response = await callGet('/api/audit/events', {
      accept: 'application/x-ndjson'
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/x-ndjson');
    const text = await response.text();
    const lines = text.trim().split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(2);
    const kinds = lines.map((l) => (JSON.parse(l) as { kind: string }).kind).sort();
    expect(kinds).toEqual(['nd.1', 'nd.2']);
  });

  it('NDJSON for zero results yields an empty body', async () => {
    const response = await callGet('/api/audit/events?kind=never', {
      accept: 'application/x-ndjson'
    });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text.trim()).toBe('');
  });
});
