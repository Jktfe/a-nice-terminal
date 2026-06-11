import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIdentityDbForTests } from '$lib/server/db';
import { POST as MINT } from './+server';
import { POST as REDEEM } from './redeem/+server';
import { resolveLeaseBySecret } from '$lib/server/helperLeaseStore';

let tmpDir: string;
const prevDb = process.env.ANT_FRESH_DB_PATH;
const prevAdmin = process.env.ANT_ADMIN_TOKEN;
const ADMIN = 'test-admin-token';

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-helper-pairing-route-'));
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

// Route-agnostic event/handler types so both the mint and redeem POSTs (which
// carry different route-param literals) share these helpers without coupling.
type TestEvent = { request: Request; params: Record<string, string>; url: URL };
type AnyPost = (event: TestEvent) => Promise<Response> | Response;

function req(url: string, body: unknown, opts: { admin?: boolean } = {}): TestEvent {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.admin) headers['authorization'] = `Bearer ${ADMIN}`;
  const request = new Request(`http://localhost${url}`, { method: 'POST', headers, body: JSON.stringify(body) });
  return { request, params: {}, url: new URL(`http://localhost${url}`) };
}

async function call(handler: AnyPost, ev: TestEvent): Promise<Response> {
  try {
    return (await handler(ev)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const f = thrown as { status?: number };
    if (typeof f?.status === 'number') return new Response(null, { status: f.status });
    throw thrown;
  }
}

const mint = MINT as unknown as AnyPost;
const redeem = REDEEM as unknown as AnyPost;

describe('POST /api/helper/pairing (mint) — operator-gated', () => {
  it('rejects an unauthenticated mint with 401', async () => {
    const res = await call(mint, req('/api/helper/pairing', { handle: '@fClaude' }));
    expect(res.status).toBe(401);
  });

  it('mints a code with admin-bearer and returns it', async () => {
    const res = await call(mint, req('/api/helper/pairing', { handle: '@fClaude' }, { admin: true }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.handle).toBe('@fClaude');
    expect(body.code).toHaveLength(6);
    expect(body.expiresAtMs).toBeGreaterThan(0);
  });

  it('refuses minting a pairing for the reserved operator handle', async () => {
    const res = await call(mint, req('/api/helper/pairing', { handle: '@JWPK' }, { admin: true }));
    expect(res.status).toBe(400);
  });

  it('requires a handle', async () => {
    const res = await call(mint, req('/api/helper/pairing', {}, { admin: true }));
    expect(res.status).toBe(400);
  });

  it('defaults to a reader pairing and accepts an explicit agent pairing', async () => {
    const reader = await call(mint, req('/api/helper/pairing', { handle: '@helper' }, { admin: true }));
    expect((await reader.json()).role).toBe('reader');
    const agent = await call(mint, req('/api/helper/pairing', { handle: '@fClaude', role: 'agent' }, { admin: true }));
    expect((await agent.json()).role).toBe('agent');
  });

  it('rejects an invalid role', async () => {
    const res = await call(mint, req('/api/helper/pairing', { handle: '@fClaude', role: 'admin' }, { admin: true }));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/helper/pairing/redeem — open, single-use', () => {
  async function mintCode(handle = '@fClaude'): Promise<string> {
    const res = await call(mint, req('/api/helper/pairing', { handle }, { admin: true }));
    return (await res.json()).code as string;
  }

  it('redeems a live code for a lease and returns the secret + fixed scope', async () => {
    const code = await mintCode();
    const res = await call(redeem, req('/api/helper/pairing/redeem', { code, host: 'mac-mini' }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.handle).toBe('@fClaude');
    expect(body.leaseSecret).toMatch(/^lease_sk_/);
    expect(body.scope.subscribeFeed).toBe(true);
    expect(body.scope.authorMessages).toBe(false); // lease never authors
    // the lease is real and active
    expect(resolveLeaseBySecret(body.leaseSecret)?.handle).toBe('@fClaude');
  });

  it('is single-use: a second redeem of the same code 410s', async () => {
    const code = await mintCode();
    expect((await call(redeem, req('/api/helper/pairing/redeem', { code }))).status).toBe(201);
    expect((await call(redeem, req('/api/helper/pairing/redeem', { code }))).status).toBe(410);
  });

  it('410s an unknown code and 400s an empty one', async () => {
    expect((await call(redeem, req('/api/helper/pairing/redeem', { code: 'ZZZZZZ' }))).status).toBe(410);
    expect((await call(redeem, req('/api/helper/pairing/redeem', { code: '' }))).status).toBe(400);
  });

  it('an agent pairing redeems to an AUTHORING attachment (scope + role)', async () => {
    const minted = await call(mint, req('/api/helper/pairing', { handle: '@fClaude', role: 'agent' }, { admin: true }));
    const code = (await minted.json()).code as string;
    const res = await call(redeem, req('/api/helper/pairing/redeem', { code, host: 'mac-mini' }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.role).toBe('agent');
    expect(body.scope.authorMessages).toBe(true); // an agent attachment authors
    expect(body.leaseSecret).toMatch(/^lease_sk_/);
  });
});
