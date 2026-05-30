/**
 * POST /api/identity/attest-challenge tests — substrate v0.2 Part 4.
 */

import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST } from './+server';
import { resetIdentityDbForTests } from '$lib/server/db';
import {
  createIdentity,
  generateEd25519KeyPair,
  mintIdentityKey,
  resetChallengeStoreForTests,
  signCanonicalPayload
} from '$lib/server/identityKeysStore';

let tmpDir: string;
const previousDbPath = process.env.ANT_FRESH_DB_PATH;
const previousAdminToken = process.env.ANT_ADMIN_TOKEN;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-attest-challenge-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  process.env.ANT_ADMIN_TOKEN = 'test-admin-token';
  resetIdentityDbForTests();
  resetChallengeStoreForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  resetChallengeStoreForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousDbPath === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousDbPath;
  if (previousAdminToken === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = previousAdminToken;
});

function eventFor(body?: string, token = 'test-admin-token') {
  const url = new URL('http://localhost/api/identity/attest-challenge');
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token.length > 0) headers.authorization = `Bearer ${token}`;
  const request = new Request(url.toString(), { method: 'POST', headers, body });
  return { request, params: {}, url } as unknown as Parameters<typeof POST>[0];
}

async function call(body?: string, token = 'test-admin-token'): Promise<Response> {
  try {
    return (await POST(eventFor(body, token))) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const httpFailure = thrown as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
    }
    throw thrown;
  }
}

let bootstrapCounter = 0;
function bootstrapIdentityWithKey() {
  bootstrapCounter += 1;
  const ident = createIdentity({
    kind: 'human',
    displayName: `X${bootstrapCounter}`,
    canonicalHandle: `@x${bootstrapCounter}`
  });
  const kp = generateEd25519KeyPair();
  const canonical = `bootstrap|${ident.identityId}|laptop|${kp.publicKey}`;
  const sig = signCanonicalPayload(canonical, kp.privateKey, kp.publicKey);
  const { key } = mintIdentityKey({
    identityId: ident.identityId,
    deviceLabel: 'laptop',
    publicKey: kp.publicKey,
    keyKind: 'device',
    attesterKeyId: 'placeholder',
    attesterKind: 'self',
    signature: sig,
    canonicalPayload: canonical,
    selfAttestForBootstrap: true
  });
  return { ident, kp, key };
}

describe('POST /api/identity/attest-challenge', () => {
  it('rejects empty token with 401', async () => {
    const res = await call('{}', '');
    expect(res.status).toBe(401);
  });

  it('rejects empty body with 400', async () => {
    const res = await call('');
    expect(res.status).toBe(400);
  });

  it('rejects missing identity_id with 400', async () => {
    const res = await call(
      JSON.stringify({ new_public_key: 'pk', new_device_label: 'phone' })
    );
    expect(res.status).toBe(400);
  });

  it('rejects unknown identity with 404', async () => {
    const res = await call(
      JSON.stringify({
        identity_id: 'ident_does_not_exist',
        new_public_key: 'pk',
        new_device_label: 'phone'
      })
    );
    expect(res.status).toBe(404);
  });

  it('rejects attester_key bound to a different identity with 409', async () => {
    const { ident: identA } = bootstrapIdentityWithKey();
    const { key: keyB } = bootstrapIdentityWithKey();
    const res = await call(
      JSON.stringify({
        identity_id: identA.identityId,
        new_public_key: 'pk',
        new_device_label: 'phone',
        attester_key_id: keyB.keyId
      })
    );
    expect(res.status).toBe(409);
  });

  it('returns 201 + nonce when attester key is valid', async () => {
    const { ident, key } = bootstrapIdentityWithKey();
    const res = await call(
      JSON.stringify({
        identity_id: ident.identityId,
        new_public_key: 'NEW_PUBLIC_KEY_PLACEHOLDER',
        new_device_label: 'phone',
        attester_key_id: key.keyId
      })
    );
    expect(res.status).toBe(201);
    const payload = await res.json();
    expect(typeof payload.nonce).toBe('string');
    expect(Buffer.from(payload.nonce, 'base64').length).toBe(32);
    expect(payload.ttl_ms).toBe(5 * 60 * 1000);
  });
});
