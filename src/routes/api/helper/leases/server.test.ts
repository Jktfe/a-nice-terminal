import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIdentityDbForTests } from '$lib/server/db';
import { GET as LIST } from './+server';
import { POST as REVOKE } from './[leaseId]/revoke/+server';
import { mintLease, resolveLeaseBySecret } from '$lib/server/helperLeaseStore';

let tmpDir: string;
const prevDb = process.env.ANT_FRESH_DB_PATH;
const prevAdmin = process.env.ANT_ADMIN_TOKEN;
const ADMIN = 'test-admin-token';

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-helper-leases-route-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  process.env.ANT_ADMIN_TOKEN = ADMIN;
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (prevDb === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = prevDb;
  if (prevAdmin === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = prevAdmin;
});

type TestEvent = { request: Request; params: Record<string, string>; url: URL };
type AnyHandler = (event: TestEvent) => Promise<Response> | Response;

function ev(url: string, opts: { method?: string; admin?: boolean; params?: Record<string, string> } = {}): TestEvent {
  const headers: Record<string, string> = {};
  if (opts.admin) headers['authorization'] = `Bearer ${ADMIN}`;
  const request = new Request(`http://localhost${url}`, { method: opts.method ?? 'GET', headers });
  return { request, params: opts.params ?? {}, url: new URL(`http://localhost${url}`) };
}

async function call(handler: AnyHandler, event: TestEvent): Promise<Response> {
  try {
    return (await handler(event)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const f = thrown as { status?: number };
    if (typeof f?.status === 'number') return new Response(null, { status: f.status });
    throw thrown;
  }
}

const list = LIST as unknown as AnyHandler;
const revoke = REVOKE as unknown as AnyHandler;

describe('GET /api/helper/leases — operator-gated list', () => {
  it('401s without operator auth', async () => {
    expect((await call(list, ev('/api/helper/leases'))).status).toBe(401);
  });

  it('lists active leases (no secrets), optionally filtered by handle', async () => {
    mintLease({ handle: '@fClaude', owners: ['@JWPK'], role: 'agent' });
    mintLease({ handle: '@helper', owners: ['@JWPK'], role: 'reader' });

    const all = await call(list, ev('/api/helper/leases', { admin: true }));
    expect(all.status).toBe(200);
    const allBody = await all.json();
    expect(allBody.leases).toHaveLength(2);
    expect(JSON.stringify(allBody)).not.toContain('lease_sk_'); // never leak secrets

    const filtered = await call(list, ev('/api/helper/leases?handle=@fClaude', { admin: true }));
    const filteredBody = await filtered.json();
    expect(filteredBody.leases).toHaveLength(1);
    expect(filteredBody.leases[0].handle).toBe('@fClaude');
    expect(filteredBody.leases[0].role).toBe('agent');
  });
});

describe('POST /api/helper/leases/[leaseId]/revoke — instant deafness', () => {
  it('401s without operator auth', async () => {
    const { leaseId } = mintLease({ handle: '@fClaude', owners: ['@JWPK'] });
    const res = await call(revoke, ev(`/api/helper/leases/${leaseId}/revoke`, { method: 'POST', params: { leaseId } }));
    expect(res.status).toBe(401);
  });

  it('revokes a live lease — the secret stops resolving immediately', async () => {
    const { leaseId, secret } = mintLease({ handle: '@fClaude', owners: ['@JWPK'], role: 'agent' });
    expect(resolveLeaseBySecret(secret)).not.toBeNull();
    const res = await call(revoke, ev(`/api/helper/leases/${leaseId}/revoke`, { method: 'POST', admin: true, params: { leaseId } }));
    expect(res.status).toBe(200);
    expect((await res.json()).revoked).toBe(true);
    expect(resolveLeaseBySecret(secret)).toBeNull(); // deaf
  });

  it('404s an unknown or already-revoked lease', async () => {
    const { leaseId } = mintLease({ handle: '@fClaude', owners: ['@JWPK'] });
    await call(revoke, ev(`/api/helper/leases/${leaseId}/revoke`, { method: 'POST', admin: true, params: { leaseId } }));
    const again = await call(revoke, ev(`/api/helper/leases/${leaseId}/revoke`, { method: 'POST', admin: true, params: { leaseId } }));
    expect(again.status).toBe(404);
    const unknown = await call(revoke, ev('/api/helper/leases/lease_nope/revoke', { method: 'POST', admin: true, params: { leaseId: 'lease_nope' } }));
    expect(unknown.status).toBe(404);
  });
});
