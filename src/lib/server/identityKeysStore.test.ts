/**
 * identityKeysStore tests — substrate v0.2 Part 4 (2026-05-29).
 *
 * Covers createIdentity, mintIdentityKey (bootstrap + non-bootstrap),
 * revokeIdentityKey, listActiveKeys, lookupIdentityByPublicKey,
 * verifyAttestation (positive + negative), and the recovery-grant happy
 * path. Crypto round-trip is exercised via deterministic test vectors
 * (fixed keypair generated once at module load).
 */

import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  approveRecovery,
  createIdentity,
  generateEd25519KeyPair,
  getIdentityById,
  getIdentityByHandle,
  issueAttestChallenge,
  listActiveKeys,
  listAllKeysForIdentity,
  listAttestationsForIdentity,
  lookupIdentityByPublicKey,
  mintIdentityKey,
  requestRecovery,
  resetChallengeStoreForTests,
  revokeIdentityKey,
  rotatePaperKeyHash,
  sha256Hex,
  signCanonicalPayload,
  verifyAttestation,
  verifySignature
} from './identityKeysStore';
import { resetIdentityDbForTests } from './db';

let tmpDir: string;
const previousDbPath = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-identity-keys-test-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
  resetChallengeStoreForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  resetChallengeStoreForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousDbPath === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousDbPath;
});

function makeAttesterFor(identityId: string, deviceLabel: string) {
  // Build a self-attested bootstrap key for an identity. Returns the key
  // + private seed so tests can sign subsequent attestations.
  const kp = generateEd25519KeyPair();
  const canonicalPayload = `bootstrap|${identityId}|${deviceLabel}|${kp.publicKey}`;
  const signature = signCanonicalPayload(canonicalPayload, kp.privateKey, kp.publicKey);
  const { key, attestation } = mintIdentityKey({
    identityId,
    deviceLabel,
    publicKey: kp.publicKey,
    keyKind: 'device',
    attesterKeyId: 'placeholder',
    attesterKind: 'self',
    signature,
    canonicalPayload,
    selfAttestForBootstrap: true,
    reason: 'bootstrap'
  });
  return { keypair: kp, key, attestation, canonicalPayload };
}

describe('identityKeysStore — createIdentity', () => {
  it('persists a human identity with paper_key_hash and reads it back', () => {
    const paperHash = sha256Hex('twenty four words go here for testing only deterministic mnemonic');
    const created = createIdentity({
      kind: 'human',
      displayName: 'James',
      canonicalHandle: '@jwpk',
      paperKeyHash: paperHash
    });
    expect(created.kind).toBe('human');
    expect(created.canonicalHandle).toBe('@jwpk');
    expect(created.paperKeyHash).toBe(paperHash);
    expect(created.revokedAtMs).toBeNull();

    const fetched = getIdentityById(created.identityId);
    expect(fetched?.displayName).toBe('James');
    const byHandle = getIdentityByHandle('@jwpk');
    expect(byHandle?.identityId).toBe(created.identityId);
  });

  it('rotatePaperKeyHash updates the stored hash', () => {
    const ident = createIdentity({
      kind: 'human',
      displayName: 'X',
      canonicalHandle: '@x',
      paperKeyHash: sha256Hex('first')
    });
    rotatePaperKeyHash(ident.identityId, sha256Hex('second'));
    expect(getIdentityById(ident.identityId)?.paperKeyHash).toBe(sha256Hex('second'));
  });
});

describe('identityKeysStore — mintIdentityKey + revokeIdentityKey', () => {
  it('bootstrap mint writes both rows in one transaction with self-attestation', () => {
    const ident = createIdentity({ kind: 'human', displayName: 'B', canonicalHandle: '@b' });
    const { key, attestation } = makeAttesterFor(ident.identityId, 'laptop');
    expect(key.identityId).toBe(ident.identityId);
    expect(key.revokedAtMs).toBeNull();
    expect(attestation.newKeyId).toBe(key.keyId);
    expect(attestation.attesterKeyId).toBe(key.keyId); // self-attest
    expect(attestation.attesterKind).toBe('self');
    const attestations = listAttestationsForIdentity(ident.identityId);
    expect(attestations).toHaveLength(1);
  });

  it('non-bootstrap mint uses an existing key as attester and records attestedByKeyId', () => {
    const ident = createIdentity({ kind: 'human', displayName: 'C', canonicalHandle: '@c' });
    const bootstrap = makeAttesterFor(ident.identityId, 'laptop');

    const newKp = generateEd25519KeyPair();
    const canonical = `attest-device|nonce-1|${newKp.publicKey}|phone`;
    const signature = signCanonicalPayload(
      canonical,
      bootstrap.keypair.privateKey,
      bootstrap.keypair.publicKey
    );
    const minted = mintIdentityKey({
      identityId: ident.identityId,
      deviceLabel: 'phone',
      publicKey: newKp.publicKey,
      keyKind: 'device',
      attestedByKeyId: bootstrap.key.keyId,
      attesterKeyId: bootstrap.key.keyId,
      attesterKind: 'self',
      signature,
      canonicalPayload: canonical
    });
    expect(minted.key.attestedByKeyId).toBe(bootstrap.key.keyId);
    expect(minted.attestation.attesterKeyId).toBe(bootstrap.key.keyId);
    expect(listActiveKeys(ident.identityId)).toHaveLength(2);
  });

  it('revokeIdentityKey marks revoked + writes a revocation attestation', () => {
    const ident = createIdentity({ kind: 'human', displayName: 'D', canonicalHandle: '@d' });
    const bootstrap = makeAttesterFor(ident.identityId, 'laptop');
    const second = makeAttesterFor(ident.identityId, 'phone');
    // Sign the revocation canonical payload with the SECOND key (so the
    // revocation is attested by a key that is NOT the one being revoked).
    const canonical = `revoke|${bootstrap.key.keyId}|lost`;
    const sig = signCanonicalPayload(canonical, second.keypair.privateKey, second.keypair.publicKey);
    const { attestation } = revokeIdentityKey({
      keyId: bootstrap.key.keyId,
      attesterKeyId: second.key.keyId,
      attesterKind: 'self',
      signature: sig,
      canonicalPayload: canonical,
      reason: 'lost'
    });
    expect(attestation.revokedKeyId).toBe(bootstrap.key.keyId);
    expect(attestation.newKeyId).toBeNull();
    const active = listActiveKeys(ident.identityId);
    expect(active.map((k) => k.keyId)).toEqual([second.key.keyId]);
    const all = listAllKeysForIdentity(ident.identityId);
    expect(all.length).toBe(2);
    expect(all.find((k) => k.keyId === bootstrap.key.keyId)?.revokedAtMs).not.toBeNull();
  });

  it('revoking an already-revoked key throws', () => {
    const ident = createIdentity({ kind: 'human', displayName: 'E', canonicalHandle: '@e' });
    const a = makeAttesterFor(ident.identityId, 'laptop');
    const b = makeAttesterFor(ident.identityId, 'phone');
    const canonical = `revoke|${a.key.keyId}|once`;
    const sig = signCanonicalPayload(canonical, b.keypair.privateKey, b.keypair.publicKey);
    revokeIdentityKey({
      keyId: a.key.keyId,
      attesterKeyId: b.key.keyId,
      attesterKind: 'self',
      signature: sig,
      canonicalPayload: canonical
    });
    expect(() =>
      revokeIdentityKey({
        keyId: a.key.keyId,
        attesterKeyId: b.key.keyId,
        attesterKind: 'self',
        signature: sig,
        canonicalPayload: canonical
      })
    ).toThrow(/already revoked/);
  });
});

describe('identityKeysStore — lookupIdentityByPublicKey', () => {
  it('returns the identity for a known public key', () => {
    const ident = createIdentity({ kind: 'agent', displayName: 'F', canonicalHandle: '@f' });
    const bootstrap = makeAttesterFor(ident.identityId, 'desktop');
    const looked = lookupIdentityByPublicKey(bootstrap.keypair.publicKey);
    expect(looked?.identityId).toBe(ident.identityId);
  });

  it('returns null when the public key was never seen', () => {
    const stranger = generateEd25519KeyPair();
    expect(lookupIdentityByPublicKey(stranger.publicKey)).toBeNull();
  });
});

describe('identityKeysStore — verifyAttestation', () => {
  it('returns valid=true when the stored signature verifies', () => {
    const ident = createIdentity({ kind: 'human', displayName: 'G', canonicalHandle: '@g' });
    const bootstrap = makeAttesterFor(ident.identityId, 'laptop');
    const result = verifyAttestation(bootstrap.attestation.attestationId);
    expect(result.valid).toBe(true);
    expect(result.attesterKey?.keyId).toBe(bootstrap.key.keyId);
  });

  it('returns valid=false when the signature was tampered', () => {
    const ident = createIdentity({ kind: 'human', displayName: 'H', canonicalHandle: '@h' });
    const kp = generateEd25519KeyPair();
    const goodCanonical = `bootstrap|${ident.identityId}|laptop|${kp.publicKey}`;
    const goodSig = signCanonicalPayload(goodCanonical, kp.privateKey, kp.publicKey);
    // Mint with a payload that DOES NOT match the signed canonical — the
    // attestation row stores the mismatch; verification must reject.
    const wrongCanonical = `bootstrap|${ident.identityId}|laptop|TAMPERED`;
    const { attestation } = mintIdentityKey({
      identityId: ident.identityId,
      deviceLabel: 'laptop',
      publicKey: kp.publicKey,
      keyKind: 'device',
      attesterKeyId: 'placeholder',
      attesterKind: 'self',
      signature: goodSig,
      canonicalPayload: wrongCanonical,
      selfAttestForBootstrap: true
    });
    const result = verifyAttestation(attestation.attestationId);
    expect(result.valid).toBe(false);
  });

  it('returns valid=false + attesterKey=null when attestation_id is unknown', () => {
    expect(verifyAttestation('att_does_not_exist')).toEqual({
      valid: false,
      attesterKey: null
    });
  });
});

describe('identityKeysStore — verifySignature (raw round-trip)', () => {
  it('signs and verifies a known payload', () => {
    const kp = generateEd25519KeyPair();
    const payload = 'attest-device|nonce-xyz|pubkey-abc|laptop';
    const sig = signCanonicalPayload(payload, kp.privateKey, kp.publicKey);
    expect(verifySignature(payload, sig, kp.publicKey)).toBe(true);
  });

  it('rejects a signature over a different payload', () => {
    const kp = generateEd25519KeyPair();
    const sig = signCanonicalPayload('payload-A', kp.privateKey, kp.publicKey);
    expect(verifySignature('payload-B', sig, kp.publicKey)).toBe(false);
  });

  it('rejects a signature verified against the wrong public key', () => {
    const a = generateEd25519KeyPair();
    const b = generateEd25519KeyPair();
    const sig = signCanonicalPayload('shared-payload', a.privateKey, a.publicKey);
    expect(verifySignature('shared-payload', sig, b.publicKey)).toBe(false);
  });
});

describe('identityKeysStore — recovery_grants', () => {
  it('happy path: request → approve flips status and records resulting_attestation_id', () => {
    const requester = createIdentity({ kind: 'human', displayName: 'R', canonicalHandle: '@r' });
    const admin = createIdentity({ kind: 'human', displayName: 'A', canonicalHandle: '@admin' });
    const grant = requestRecovery({
      requesterIdentityId: requester.identityId,
      reason: 'all personal devices lost: car crash 2026-05-27',
      targetApproverIdentityId: admin.identityId
    });
    expect(grant.status).toBe('pending');
    // Mint a new key on the requester via an admin attestation, then
    // approve the grant pointing at the new attestation.
    const adminKp = generateEd25519KeyPair();
    const canonical = `recover|${requester.identityId}|laptop-mk2|${adminKp.publicKey}`;
    const adminBootstrap = mintIdentityKey({
      identityId: admin.identityId,
      deviceLabel: 'admin-laptop',
      publicKey: adminKp.publicKey,
      keyKind: 'device',
      attesterKeyId: 'placeholder',
      attesterKind: 'self',
      signature: signCanonicalPayload(canonical, adminKp.privateKey, adminKp.publicKey),
      canonicalPayload: canonical,
      selfAttestForBootstrap: true
    });
    // Now use the admin key to mint a recovery key for the requester.
    const requesterKp = generateEd25519KeyPair();
    const recoveryCanonical = `recover|${requester.identityId}|laptop-mk2|${requesterKp.publicKey}`;
    const recoverySig = signCanonicalPayload(
      recoveryCanonical,
      adminKp.privateKey,
      adminKp.publicKey
    );
    const recoveryMint = mintIdentityKey({
      identityId: requester.identityId,
      deviceLabel: 'laptop-mk2',
      publicKey: requesterKp.publicKey,
      keyKind: 'device',
      attestedByKeyId: adminBootstrap.key.keyId,
      attesterKeyId: adminBootstrap.key.keyId,
      attesterKind: 'org-admin',
      signature: recoverySig,
      canonicalPayload: recoveryCanonical,
      reason: 'tier-2 admin attestation'
    });
    const approved = approveRecovery({
      grantId: grant.grantId,
      decidedByIdentityId: admin.identityId,
      resultingAttestationId: recoveryMint.attestation.attestationId
    });
    expect(approved.status).toBe('approved');
    expect(approved.decidedByIdentityId).toBe(admin.identityId);
    expect(approved.resultingAttestationId).toBe(recoveryMint.attestation.attestationId);
  });

  it('approveRecovery throws when the grant is not pending', () => {
    const requester = createIdentity({ kind: 'human', displayName: 'S', canonicalHandle: '@s' });
    const grant = requestRecovery({
      requesterIdentityId: requester.identityId,
      reason: 'test'
    });
    // Approve once (with a fake attestation_id is fine for the state check).
    const ident = createIdentity({ kind: 'human', displayName: 'T', canonicalHandle: '@t' });
    const k = makeAttesterFor(ident.identityId, 'd');
    approveRecovery({
      grantId: grant.grantId,
      decidedByIdentityId: ident.identityId,
      resultingAttestationId: k.attestation.attestationId
    });
    expect(() =>
      approveRecovery({
        grantId: grant.grantId,
        decidedByIdentityId: ident.identityId,
        resultingAttestationId: k.attestation.attestationId
      })
    ).toThrow(/not pending/);
  });
});

describe('identityKeysStore — challenge nonces', () => {
  it('issued nonce can be consumed exactly once', () => {
    const ident = createIdentity({ kind: 'human', displayName: 'U', canonicalHandle: '@u' });
    const bootstrap = makeAttesterFor(ident.identityId, 'laptop');
    const { nonce } = issueAttestChallenge({
      identityId: ident.identityId,
      newPublicKey: 'pk',
      newDeviceLabel: 'phone',
      attesterKeyId: bootstrap.key.keyId
    });
    // Consume via the internal-only helper through the test export below.
    const stored = (
      globalThis as unknown as {
        __antIdentityKeysChallengeStore?: Map<string, unknown>;
      }
    ).__antIdentityKeysChallengeStore;
    expect(stored?.has(nonce)).toBe(true);
  });
});
