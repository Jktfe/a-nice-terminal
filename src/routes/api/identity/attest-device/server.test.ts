/**
 * POST /api/identity/attest-device tests — substrate v0.2 Part 4.
 *
 * Round-trip: issue a challenge in-process, sign the canonical payload,
 * post the signed payload; assert a new key + attestation row land.
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
  issueAttestChallenge,
  listActiveKeys,
  listAttestationsForIdentity,
  mintIdentityKey,
  resetChallengeStoreForTests,
  signCanonicalPayload
} from '$lib/server/identityKeysStore';

let tmpDir: string;
const previousDbPath = process.env.ANT_FRESH_DB_PATH;
const previousAdminToken = process.env.ANT_ADMIN_TOKEN;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-attest-device-'));
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
  const url = new URL('http://localhost/api/identity/attest-device');
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

function canonicalFor(nonce: string, publicKey: string, deviceLabel: string): string {
  return `attest-device|${nonce}|${publicKey}|${deviceLabel}`;
}

function bootstrap() {
  const ident = createIdentity({ kind: 'human', displayName: 'Y', canonicalHandle: '@y' });
  const attester = generateEd25519KeyPair();
  const bootstrapCanonical = `bootstrap|${ident.identityId}|laptop|${attester.publicKey}`;
  const sig = signCanonicalPayload(bootstrapCanonical, attester.privateKey, attester.publicKey);
  const { key } = mintIdentityKey({
    identityId: ident.identityId,
    deviceLabel: 'laptop',
    publicKey: attester.publicKey,
    keyKind: 'device',
    attesterKeyId: 'placeholder',
    attesterKind: 'self',
    signature: sig,
    canonicalPayload: bootstrapCanonical,
    selfAttestForBootstrap: true
  });
  return { ident, attester, key };
}

describe('POST /api/identity/attest-device', () => {
  it('rejects empty token with 401', async () => {
    const res = await call('{}', '');
    expect(res.status).toBe(401);
  });

  it('rejects unknown nonce with 401', async () => {
    const res = await call(
      JSON.stringify({ nonce: 'bogus-nonce', signature: 'bogus-sig' })
    );
    expect(res.status).toBe(401);
  });

  it('rejects mismatched signature with 401', async () => {
    const { ident, attester, key } = bootstrap();
    const newKp = generateEd25519KeyPair();
    const { nonce } = issueAttestChallenge({
      identityId: ident.identityId,
      newPublicKey: newKp.publicKey,
      newDeviceLabel: 'phone',
      attesterKeyId: key.keyId
    });
    // Sign something OTHER than the canonical payload the server expects.
    const wrongCanonical = `attest-device|${nonce}|WRONG|phone`;
    const sig = signCanonicalPayload(wrongCanonical, attester.privateKey, attester.publicKey);
    const res = await call(JSON.stringify({ nonce, signature: sig }));
    expect(res.status).toBe(401);
  });

  it('happy path: returns 201 + mints a new key with attestation', async () => {
    const { ident, attester, key } = bootstrap();
    const newKp = generateEd25519KeyPair();
    const { nonce } = issueAttestChallenge({
      identityId: ident.identityId,
      newPublicKey: newKp.publicKey,
      newDeviceLabel: 'phone',
      attesterKeyId: key.keyId
    });
    const canonical = canonicalFor(nonce, newKp.publicKey, 'phone');
    const sig = signCanonicalPayload(canonical, attester.privateKey, attester.publicKey);
    const res = await call(JSON.stringify({ nonce, signature: sig, reason: 'second device' }));
    expect(res.status).toBe(201);
    const payload = await res.json();
    expect(payload.identity_id).toBe(ident.identityId);
    expect(payload.device_label).toBe('phone');
    expect(typeof payload.key_id).toBe('string');
    expect(typeof payload.attestation_id).toBe('string');

    // Side effects: identity now has 2 active keys + 2 attestations.
    expect(listActiveKeys(ident.identityId)).toHaveLength(2);
    expect(listAttestationsForIdentity(ident.identityId)).toHaveLength(2);
  });

  it('rejects re-use of a consumed nonce', async () => {
    const { ident, attester, key } = bootstrap();
    const newKp = generateEd25519KeyPair();
    const { nonce } = issueAttestChallenge({
      identityId: ident.identityId,
      newPublicKey: newKp.publicKey,
      newDeviceLabel: 'phone',
      attesterKeyId: key.keyId
    });
    const canonical = canonicalFor(nonce, newKp.publicKey, 'phone');
    const sig = signCanonicalPayload(canonical, attester.privateKey, attester.publicKey);
    const first = await call(JSON.stringify({ nonce, signature: sig }));
    expect(first.status).toBe(201);
    const second = await call(JSON.stringify({ nonce, signature: sig }));
    expect(second.status).toBe(401);
  });
});
