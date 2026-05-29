/**
 * identityKeysStore — substrate v0.2 Part 4 (2026-05-29).
 *
 * Cryptographic-identity foundation. Replaces the pidChain auth path with
 * ed25519-signed nonce challenges against keys stored in identity_keys.
 * Spec: /tmp/ant-identity-keys-multi-device-canvas-2026-05-29.md.
 *
 * Tables (additive, schema in db.ts SCHEMA_DDL_STATEMENTS):
 *   - identities — durable subject, kind ∈ {human, agent, bot, system}.
 *   - identity_keys — device-scoped public keys (ed25519). Multiple per
 *     identity; revoked rows are terminal. key_kind ∈ {device,paper,escrow}.
 *   - identity_attestations — append-only log; every mint/revoke writes a
 *     signed row that proves which key authorised the change.
 *   - recovery_grants — pending Tier 2 / Tier 3 approvals.
 *
 * North-star property (canvas):
 *   Loss of any single device must never lock a user out of their identity.
 *   Loss of all personal devices must be recoverable by the org without
 *   third-party password reset, email link, or help-desk ticket.
 *
 * Crypto: node:crypto's ed25519 (no external dep). Public keys + signatures
 * are stored as base64 of the raw key bytes (32 bytes / 64 bytes).
 *
 * NOTE: this store ships the substrate primitives only. Stage A 403-payload
 * and Stage B permissions consume these in follow-up slices. Modal routing
 * for Tier 2 recovery approval also lands later.
 *
 * TODO(stage-b): wire the modal routing for recovery_grants approval into
 * the permissions UX so org admins see pending grants without polling.
 */

import {
  createPublicKey,
  createPrivateKey,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  verify,
  sign,
  createHash
} from 'node:crypto';
import { getIdentityDb } from './db';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type IdentityKind = 'human' | 'agent' | 'bot' | 'system';
export type KeyKind = 'device' | 'paper' | 'escrow';
export type AttesterKind = 'self' | 'org-admin' | 'paper-key' | 'multi-admin';
export type RecoveryStatus = 'pending' | 'approved' | 'denied' | 'expired';

export type Identity = {
  identityId: string;
  kind: IdentityKind;
  displayName: string;
  canonicalHandle: string;
  ownerIdentityId: string | null;
  orgId: string | null;
  paperKeyHash: string | null;
  createdAtMs: number;
  revokedAtMs: number | null;
};

export type IdentityKey = {
  keyId: string;
  identityId: string;
  deviceLabel: string;
  publicKey: string;
  keyKind: KeyKind;
  createdAtMs: number;
  attestedByKeyId: string | null;
  revokedAtMs: number | null;
  revokeReason: string | null;
};

export type IdentityAttestation = {
  attestationId: string;
  identityId: string;
  newKeyId: string | null;
  revokedKeyId: string | null;
  attesterKeyId: string;
  attesterKind: AttesterKind;
  signature: string;
  canonicalPayload: string;
  reason: string | null;
  createdAtMs: number;
};

export type RecoveryGrant = {
  grantId: string;
  requesterIdentityId: string;
  requestedAtMs: number;
  reason: string;
  targetApproverIdentityId: string | null;
  paperKeyHash: string | null;
  status: RecoveryStatus;
  decidedAtMs: number | null;
  decidedByIdentityId: string | null;
  resultingAttestationId: string | null;
};

type IdentityRow = {
  identity_id: string;
  kind: string;
  display_name: string;
  canonical_handle: string;
  owner_identity_id: string | null;
  org_id: string | null;
  paper_key_hash: string | null;
  created_at_ms: number;
  revoked_at_ms: number | null;
};

type IdentityKeyRow = {
  key_id: string;
  identity_id: string;
  device_label: string;
  public_key: string;
  key_kind: string;
  created_at_ms: number;
  attested_by_key_id: string | null;
  revoked_at_ms: number | null;
  revoke_reason: string | null;
};

type IdentityAttestationRow = {
  attestation_id: string;
  identity_id: string;
  new_key_id: string | null;
  revoked_key_id: string | null;
  attester_key_id: string;
  attester_kind: string;
  signature: string;
  canonical_payload: string;
  reason: string | null;
  created_at_ms: number;
};

type RecoveryGrantRow = {
  grant_id: string;
  requester_identity_id: string;
  requested_at_ms: number;
  reason: string;
  target_approver_identity_id: string | null;
  paper_key_hash: string | null;
  status: string;
  decided_at_ms: number | null;
  decided_by_identity_id: string | null;
  resulting_attestation_id: string | null;
};

// ---------------------------------------------------------------------------
// Row → record mappers
// ---------------------------------------------------------------------------

function rowToIdentity(row: IdentityRow): Identity {
  return {
    identityId: row.identity_id,
    kind: row.kind as IdentityKind,
    displayName: row.display_name,
    canonicalHandle: row.canonical_handle,
    ownerIdentityId: row.owner_identity_id,
    orgId: row.org_id,
    paperKeyHash: row.paper_key_hash,
    createdAtMs: row.created_at_ms,
    revokedAtMs: row.revoked_at_ms
  };
}

function rowToKey(row: IdentityKeyRow): IdentityKey {
  return {
    keyId: row.key_id,
    identityId: row.identity_id,
    deviceLabel: row.device_label,
    publicKey: row.public_key,
    keyKind: row.key_kind as KeyKind,
    createdAtMs: row.created_at_ms,
    attestedByKeyId: row.attested_by_key_id,
    revokedAtMs: row.revoked_at_ms,
    revokeReason: row.revoke_reason
  };
}

function rowToAttestation(row: IdentityAttestationRow): IdentityAttestation {
  return {
    attestationId: row.attestation_id,
    identityId: row.identity_id,
    newKeyId: row.new_key_id,
    revokedKeyId: row.revoked_key_id,
    attesterKeyId: row.attester_key_id,
    attesterKind: row.attester_kind as AttesterKind,
    signature: row.signature,
    canonicalPayload: row.canonical_payload,
    reason: row.reason,
    createdAtMs: row.created_at_ms
  };
}

function rowToGrant(row: RecoveryGrantRow): RecoveryGrant {
  return {
    grantId: row.grant_id,
    requesterIdentityId: row.requester_identity_id,
    requestedAtMs: row.requested_at_ms,
    reason: row.reason,
    targetApproverIdentityId: row.target_approver_identity_id,
    paperKeyHash: row.paper_key_hash,
    status: row.status as RecoveryStatus,
    decidedAtMs: row.decided_at_ms,
    decidedByIdentityId: row.decided_by_identity_id,
    resultingAttestationId: row.resulting_attestation_id
  };
}

// ---------------------------------------------------------------------------
// Crypto helpers (ed25519 via node:crypto)
// ---------------------------------------------------------------------------

const ED25519_RAW_PUBLIC_KEY_BYTES = 32;
const ED25519_RAW_PRIVATE_KEY_BYTES = 32;

/**
 * Generate a fresh ed25519 keypair. Returns base64-encoded raw key bytes
 * (32B public, 32B private seed). The CLI stores the private key in the
 * OS keychain; the server only ever sees public keys + signatures.
 */
export function generateEd25519KeyPair(): { publicKey: string; privateKey: string } {
  const pair = generateKeyPairSync('ed25519');
  const publicJwk = pair.publicKey.export({ format: 'jwk' }) as { x?: string };
  const privateJwk = pair.privateKey.export({ format: 'jwk' }) as { d?: string };
  if (!publicJwk.x || !privateJwk.d) {
    throw new Error('ed25519 keygen produced unexpected JWK shape');
  }
  // JWK uses base64url; normalise to base64 for storage consistency.
  return {
    publicKey: base64UrlToBase64(publicJwk.x),
    privateKey: base64UrlToBase64(privateJwk.d)
  };
}

function base64UrlToBase64(input: string): string {
  return Buffer.from(input, 'base64url').toString('base64');
}

function base64ToBuffer(input: string): Buffer {
  return Buffer.from(input, 'base64');
}

/** Reconstruct an ed25519 KeyObject from the raw 32-byte public seed. */
function publicKeyObjectFromBase64(publicKeyBase64: string) {
  const raw = base64ToBuffer(publicKeyBase64);
  if (raw.length !== ED25519_RAW_PUBLIC_KEY_BYTES) {
    throw new Error(`ed25519 public key must be ${ED25519_RAW_PUBLIC_KEY_BYTES} bytes, got ${raw.length}`);
  }
  return createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: raw.toString('base64url') },
    format: 'jwk'
  });
}

/** Reconstruct an ed25519 private KeyObject from the raw 32-byte seed. */
function privateKeyObjectFromBase64(privateKeyBase64: string, publicKeyBase64: string) {
  const rawPriv = base64ToBuffer(privateKeyBase64);
  const rawPub = base64ToBuffer(publicKeyBase64);
  if (rawPriv.length !== ED25519_RAW_PRIVATE_KEY_BYTES) {
    throw new Error(`ed25519 private seed must be ${ED25519_RAW_PRIVATE_KEY_BYTES} bytes, got ${rawPriv.length}`);
  }
  return createPrivateKey({
    key: {
      kty: 'OKP',
      crv: 'Ed25519',
      x: rawPub.toString('base64url'),
      d: rawPriv.toString('base64url')
    },
    format: 'jwk'
  });
}

/**
 * Sign a canonical payload with the supplied ed25519 private key (base64).
 * The publicKey companion is required so we can rebuild the JWK; ed25519
 * private "seeds" alone aren't sufficient for node:crypto's JWK importer.
 */
export function signCanonicalPayload(
  canonicalPayload: string,
  privateKeyBase64: string,
  publicKeyBase64: string
): string {
  const keyObject = privateKeyObjectFromBase64(privateKeyBase64, publicKeyBase64);
  const signature = sign(null, Buffer.from(canonicalPayload, 'utf8'), keyObject);
  return signature.toString('base64');
}

/** Verify a base64 signature over a canonical payload against a base64 public key. */
export function verifySignature(
  canonicalPayload: string,
  signatureBase64: string,
  publicKeyBase64: string
): boolean {
  try {
    const keyObject = publicKeyObjectFromBase64(publicKeyBase64);
    return verify(
      null,
      Buffer.from(canonicalPayload, 'utf8'),
      keyObject,
      base64ToBuffer(signatureBase64)
    );
  } catch {
    return false;
  }
}

/** 32-byte random nonce, base64. For attest-challenge endpoints. */
export function generateChallengeNonce(): string {
  return randomBytes(32).toString('base64');
}

/** SHA-256 hex digest of the supplied UTF-8 input. For paper-mnemonic storage. */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(Buffer.from(input, 'utf8')).digest('hex');
}

// ---------------------------------------------------------------------------
// Identity CRUD
// ---------------------------------------------------------------------------

export function createIdentity(input: {
  kind: IdentityKind;
  displayName: string;
  canonicalHandle: string;
  ownerIdentityId?: string | null;
  orgId?: string | null;
  paperKeyHash?: string | null;
}): Identity {
  const id = `ident_${randomUUID().slice(0, 16)}`;
  const nowMs = Date.now();
  const db = getIdentityDb();
  db.prepare(`INSERT INTO identities (
    identity_id, kind, display_name, canonical_handle,
    owner_identity_id, org_id, paper_key_hash, created_at_ms
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id,
    input.kind,
    input.displayName,
    input.canonicalHandle,
    input.ownerIdentityId ?? null,
    input.orgId ?? null,
    input.paperKeyHash ?? null,
    nowMs
  );
  const row = db
    .prepare<[string], IdentityRow>(`SELECT * FROM identities WHERE identity_id = ?`)
    .get(id);
  if (!row) throw new Error(`createIdentity: row ${id} vanished post-insert`);
  return rowToIdentity(row);
}

export function getIdentityById(identityId: string): Identity | null {
  const row = getIdentityDb()
    .prepare<[string], IdentityRow>(`SELECT * FROM identities WHERE identity_id = ?`)
    .get(identityId);
  return row ? rowToIdentity(row) : null;
}

export function getIdentityByHandle(canonicalHandle: string): Identity | null {
  const row = getIdentityDb()
    .prepare<[string], IdentityRow>(
      `SELECT * FROM identities WHERE canonical_handle = ? AND revoked_at_ms IS NULL`
    )
    .get(canonicalHandle);
  return row ? rowToIdentity(row) : null;
}

export function rotatePaperKeyHash(identityId: string, newHash: string): void {
  getIdentityDb()
    .prepare(`UPDATE identities SET paper_key_hash = ? WHERE identity_id = ?`)
    .run(newHash, identityId);
}

// ---------------------------------------------------------------------------
// Key minting + revocation (atomic with attestation)
// ---------------------------------------------------------------------------

/**
 * Mint a new identity_keys row AND write the matching identity_attestations
 * row in a single transaction. The attester_key_id may be the same as the
 * new key (kind='self') for the bootstrap case where the identity is being
 * created with its first device key; in that case the attester signs its
 * own birth certificate.
 *
 * The signature is supplied by the caller — this store does NOT sign. The
 * CLI signs locally with the private key it just generated (or with an
 * existing attester key); the server only verifies + persists.
 */
export function mintIdentityKey(input: {
  identityId: string;
  deviceLabel: string;
  publicKey: string;
  keyKind: KeyKind;
  attestedByKeyId?: string | null;
  attesterKeyId: string;
  attesterKind: AttesterKind;
  signature: string;
  canonicalPayload: string;
  reason?: string | null;
  selfAttestForBootstrap?: boolean;
}): { key: IdentityKey; attestation: IdentityAttestation } {
  const keyId = `key_${randomUUID().slice(0, 16)}`;
  const attestationId = `att_${randomUUID().slice(0, 16)}`;
  const nowMs = Date.now();
  const db = getIdentityDb();

  const txn = db.transaction(() => {
    db.prepare(`INSERT INTO identity_keys (
      key_id, identity_id, device_label, public_key, key_kind,
      created_at_ms, attested_by_key_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      keyId,
      input.identityId,
      input.deviceLabel,
      input.publicKey,
      input.keyKind,
      nowMs,
      input.attestedByKeyId ?? null
    );

    // For the bootstrap case, attesterKeyId == keyId (the newly-minted key
    // signs its own birth). The FK requires the row exists first, hence
    // the ordering inside the transaction.
    const resolvedAttesterKeyId = input.selfAttestForBootstrap === true
      ? keyId
      : input.attesterKeyId;

    db.prepare(`INSERT INTO identity_attestations (
      attestation_id, identity_id, new_key_id, revoked_key_id,
      attester_key_id, attester_kind, signature, canonical_payload,
      reason, created_at_ms
    ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`).run(
      attestationId,
      input.identityId,
      keyId,
      resolvedAttesterKeyId,
      input.attesterKind,
      input.signature,
      input.canonicalPayload,
      input.reason ?? null,
      nowMs
    );
  });

  txn();

  const keyRow = db
    .prepare<[string], IdentityKeyRow>(`SELECT * FROM identity_keys WHERE key_id = ?`)
    .get(keyId);
  const attRow = db
    .prepare<[string], IdentityAttestationRow>(`SELECT * FROM identity_attestations WHERE attestation_id = ?`)
    .get(attestationId);
  if (!keyRow || !attRow) throw new Error('mintIdentityKey: rows vanished post-insert');
  return { key: rowToKey(keyRow), attestation: rowToAttestation(attRow) };
}

/**
 * Mark an identity_keys row revoked AND append a revocation attestation.
 * Revoked rows are terminal — a re-attested device gets a new key_id.
 */
export function revokeIdentityKey(input: {
  keyId: string;
  attesterKeyId: string;
  attesterKind: AttesterKind;
  signature: string;
  canonicalPayload: string;
  reason?: string | null;
}): { attestation: IdentityAttestation } {
  const db = getIdentityDb();
  const targetRow = db
    .prepare<[string], IdentityKeyRow>(`SELECT * FROM identity_keys WHERE key_id = ?`)
    .get(input.keyId);
  if (!targetRow) throw new Error(`revokeIdentityKey: key ${input.keyId} not found`);
  if (targetRow.revoked_at_ms !== null) {
    throw new Error(`revokeIdentityKey: key ${input.keyId} already revoked`);
  }
  const attestationId = `att_${randomUUID().slice(0, 16)}`;
  const nowMs = Date.now();

  const txn = db.transaction(() => {
    db.prepare(
      `UPDATE identity_keys SET revoked_at_ms = ?, revoke_reason = ? WHERE key_id = ?`
    ).run(nowMs, input.reason ?? null, input.keyId);

    db.prepare(`INSERT INTO identity_attestations (
      attestation_id, identity_id, new_key_id, revoked_key_id,
      attester_key_id, attester_kind, signature, canonical_payload,
      reason, created_at_ms
    ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`).run(
      attestationId,
      targetRow.identity_id,
      input.keyId,
      input.attesterKeyId,
      input.attesterKind,
      input.signature,
      input.canonicalPayload,
      input.reason ?? null,
      nowMs
    );
  });
  txn();

  const attRow = db
    .prepare<[string], IdentityAttestationRow>(`SELECT * FROM identity_attestations WHERE attestation_id = ?`)
    .get(attestationId);
  if (!attRow) throw new Error('revokeIdentityKey: attestation row vanished post-insert');
  return { attestation: rowToAttestation(attRow) };
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export function listActiveKeys(identityId: string): IdentityKey[] {
  return getIdentityDb()
    .prepare<[string], IdentityKeyRow>(
      `SELECT * FROM identity_keys
       WHERE identity_id = ? AND revoked_at_ms IS NULL
       ORDER BY created_at_ms ASC`
    )
    .all(identityId)
    .map(rowToKey);
}

export function listAllKeysForIdentity(identityId: string): IdentityKey[] {
  return getIdentityDb()
    .prepare<[string], IdentityKeyRow>(
      `SELECT * FROM identity_keys
       WHERE identity_id = ?
       ORDER BY created_at_ms ASC`
    )
    .all(identityId)
    .map(rowToKey);
}

export function getIdentityKeyById(keyId: string): IdentityKey | null {
  const row = getIdentityDb()
    .prepare<[string], IdentityKeyRow>(`SELECT * FROM identity_keys WHERE key_id = ?`)
    .get(keyId);
  return row ? rowToKey(row) : null;
}

/**
 * Lookup an identity by one of its public keys. Returns the active identity
 * even if the key itself has been revoked — callers must check listActiveKeys
 * to confirm the key is usable for fresh auth. (Used by Stage B auth gate
 * when verifying a signed-nonce challenge.)
 */
export function lookupIdentityByPublicKey(publicKey: string): Identity | null {
  const db = getIdentityDb();
  const keyRow = db
    .prepare<[string], IdentityKeyRow>(`SELECT * FROM identity_keys WHERE public_key = ? LIMIT 1`)
    .get(publicKey);
  if (!keyRow) return null;
  const identityRow = db
    .prepare<[string], IdentityRow>(`SELECT * FROM identities WHERE identity_id = ?`)
    .get(keyRow.identity_id);
  return identityRow ? rowToIdentity(identityRow) : null;
}

// ---------------------------------------------------------------------------
// Attestation verification
// ---------------------------------------------------------------------------

/**
 * Re-verify an attestation's signature against its attester key's stored
 * public_key. Used by forensic-audit tooling + the Stage B permissions
 * gate to confirm a presented attestation actually proves what it claims.
 *
 * Returns { valid: false, attesterKey: null } when the attester key has
 * been deleted or never existed; { valid: false, attesterKey: <row> } when
 * the signature doesn't verify against the stored public key.
 */
export function verifyAttestation(attestationId: string): {
  valid: boolean;
  attesterKey: IdentityKey | null;
} {
  const db = getIdentityDb();
  const attRow = db
    .prepare<[string], IdentityAttestationRow>(`SELECT * FROM identity_attestations WHERE attestation_id = ?`)
    .get(attestationId);
  if (!attRow) return { valid: false, attesterKey: null };
  const attesterKeyRow = db
    .prepare<[string], IdentityKeyRow>(`SELECT * FROM identity_keys WHERE key_id = ?`)
    .get(attRow.attester_key_id);
  if (!attesterKeyRow) return { valid: false, attesterKey: null };
  const valid = verifySignature(
    attRow.canonical_payload,
    attRow.signature,
    attesterKeyRow.public_key
  );
  return { valid, attesterKey: rowToKey(attesterKeyRow) };
}

export function listAttestationsForIdentity(identityId: string): IdentityAttestation[] {
  return getIdentityDb()
    .prepare<[string], IdentityAttestationRow>(
      `SELECT * FROM identity_attestations
       WHERE identity_id = ?
       ORDER BY created_at_ms ASC`
    )
    .all(identityId)
    .map(rowToAttestation);
}

// ---------------------------------------------------------------------------
// Recovery grants (Tier 2 + Tier 3)
// ---------------------------------------------------------------------------

export function requestRecovery(input: {
  requesterIdentityId: string;
  reason: string;
  targetApproverIdentityId?: string | null;
  paperKeyHash?: string | null;
}): RecoveryGrant {
  const grantId = `recov_${randomUUID().slice(0, 16)}`;
  const nowMs = Date.now();
  const db = getIdentityDb();
  db.prepare(`INSERT INTO recovery_grants (
    grant_id, requester_identity_id, requested_at_ms, reason,
    target_approver_identity_id, paper_key_hash, status
  ) VALUES (?, ?, ?, ?, ?, ?, 'pending')`).run(
    grantId,
    input.requesterIdentityId,
    nowMs,
    input.reason,
    input.targetApproverIdentityId ?? null,
    input.paperKeyHash ?? null
  );
  const row = db
    .prepare<[string], RecoveryGrantRow>(`SELECT * FROM recovery_grants WHERE grant_id = ?`)
    .get(grantId);
  if (!row) throw new Error(`requestRecovery: row ${grantId} vanished post-insert`);
  return rowToGrant(row);
}

export function getRecoveryGrant(grantId: string): RecoveryGrant | null {
  const row = getIdentityDb()
    .prepare<[string], RecoveryGrantRow>(`SELECT * FROM recovery_grants WHERE grant_id = ?`)
    .get(grantId);
  return row ? rowToGrant(row) : null;
}

export function listPendingRecoveryGrants(): RecoveryGrant[] {
  return getIdentityDb()
    .prepare<[], RecoveryGrantRow>(
      `SELECT * FROM recovery_grants
       WHERE status = 'pending'
       ORDER BY requested_at_ms ASC`
    )
    .all()
    .map(rowToGrant);
}

/**
 * Approve a pending recovery_grant. Stamps decided_at_ms + decided_by +
 * resulting_attestation_id and flips status. The caller must have already
 * minted the new key (and its attestation) via mintIdentityKey; that
 * attestation_id is recorded here for forensic chain-up.
 *
 * TODO(stage-b): the modal UX that presents the grant to the approver
 * lives in the Stage B permissions slice. For now, org admins approve
 * by calling `ant identity approve-recovery <grant_id>` from the CLI.
 */
export function approveRecovery(input: {
  grantId: string;
  decidedByIdentityId: string;
  resultingAttestationId: string;
}): RecoveryGrant {
  const nowMs = Date.now();
  const db = getIdentityDb();
  const existing = db
    .prepare<[string], RecoveryGrantRow>(`SELECT * FROM recovery_grants WHERE grant_id = ?`)
    .get(input.grantId);
  if (!existing) throw new Error(`approveRecovery: grant ${input.grantId} not found`);
  if (existing.status !== 'pending') {
    throw new Error(`approveRecovery: grant ${input.grantId} is ${existing.status}, not pending`);
  }
  db.prepare(
    `UPDATE recovery_grants
       SET status = 'approved',
           decided_at_ms = ?,
           decided_by_identity_id = ?,
           resulting_attestation_id = ?
     WHERE grant_id = ?`
  ).run(nowMs, input.decidedByIdentityId, input.resultingAttestationId, input.grantId);
  const updated = db
    .prepare<[string], RecoveryGrantRow>(`SELECT * FROM recovery_grants WHERE grant_id = ?`)
    .get(input.grantId);
  if (!updated) throw new Error('approveRecovery: row vanished post-update');
  return rowToGrant(updated);
}

// ---------------------------------------------------------------------------
// Challenge nonces (in-memory, short-lived)
// ---------------------------------------------------------------------------
//
// The attest-device flow is two-leg: client GETs a nonce, signs it locally
// with an existing active key, posts the signed payload + new public key
// back. The nonce must be replay-protected. We keep nonces in a process-
// local Map with 5-minute TTL — short-lived enrolment flow, no need to
// persist across restarts. (If the server restarts mid-enrolment the user
// re-runs `ant identity attest-device`; not a hot path.)

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
type ChallengeRecord = {
  nonce: string;
  identityId: string;
  newPublicKey: string;
  newDeviceLabel: string;
  attesterKeyId: string | null;
  issuedAtMs: number;
};

declare global {
  // eslint-disable-next-line no-var
  var __antIdentityKeysChallengeStore: Map<string, ChallengeRecord> | undefined;
}

function getChallengeStore(): Map<string, ChallengeRecord> {
  if (!globalThis.__antIdentityKeysChallengeStore) {
    globalThis.__antIdentityKeysChallengeStore = new Map();
  }
  return globalThis.__antIdentityKeysChallengeStore;
}

export function issueAttestChallenge(input: {
  identityId: string;
  newPublicKey: string;
  newDeviceLabel: string;
  attesterKeyId?: string | null;
}): { nonce: string } {
  const nonce = generateChallengeNonce();
  getChallengeStore().set(nonce, {
    nonce,
    identityId: input.identityId,
    newPublicKey: input.newPublicKey,
    newDeviceLabel: input.newDeviceLabel,
    attesterKeyId: input.attesterKeyId ?? null,
    issuedAtMs: Date.now()
  });
  // Opportunistic sweep — keep the map bounded under churn.
  pruneExpiredChallenges();
  return { nonce };
}

export function consumeAttestChallenge(nonce: string): ChallengeRecord | null {
  const store = getChallengeStore();
  const record = store.get(nonce);
  if (!record) return null;
  if (Date.now() - record.issuedAtMs > CHALLENGE_TTL_MS) {
    store.delete(nonce);
    return null;
  }
  store.delete(nonce);
  return record;
}

function pruneExpiredChallenges(): void {
  const now = Date.now();
  const store = getChallengeStore();
  for (const [key, record] of store) {
    if (now - record.issuedAtMs > CHALLENGE_TTL_MS) store.delete(key);
  }
}

export function resetChallengeStoreForTests(): void {
  getChallengeStore().clear();
}

export function denyRecovery(input: {
  grantId: string;
  decidedByIdentityId: string;
}): RecoveryGrant {
  const nowMs = Date.now();
  const db = getIdentityDb();
  db.prepare(
    `UPDATE recovery_grants
       SET status = 'denied', decided_at_ms = ?, decided_by_identity_id = ?
     WHERE grant_id = ? AND status = 'pending'`
  ).run(nowMs, input.decidedByIdentityId, input.grantId);
  const updated = db
    .prepare<[string], RecoveryGrantRow>(`SELECT * FROM recovery_grants WHERE grant_id = ?`)
    .get(input.grantId);
  if (!updated) throw new Error(`denyRecovery: grant ${input.grantId} not found`);
  return rowToGrant(updated);
}
