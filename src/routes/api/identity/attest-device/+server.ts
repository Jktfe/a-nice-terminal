/**
 * POST /api/identity/attest-device — substrate v0.2 Part 4 (2026-05-29).
 *
 * Second leg of the device-attestation handshake. Client previously fetched
 * a nonce from /api/identity/attest-challenge, then signed the canonical
 * payload `nonce|new_public_key|new_device_label` with an EXISTING active
 * key (the attester). This endpoint:
 *
 *   1. Looks up the nonce; rejects expired/unknown.
 *   2. Loads the attester key referenced in the nonce record.
 *   3. Verifies the supplied signature against the attester's public key.
 *   4. On valid signature, mints a new identity_keys row + identity_attestations
 *      row in a single transaction via mintIdentityKey.
 *
 * Returns the new key_id + attestation_id. The client must persist the new
 * private key in its OS keychain — the server never sees it.
 *
 * Auth: admin-bearer. Stage B permissions will lift to a per-identity gate.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdminAuth } from '$lib/server/chatInviteAuth';
import {
  consumeAttestChallenge,
  getIdentityKeyById,
  mintIdentityKey,
  verifySignature
} from '$lib/server/identityKeysStore';

type AttestBody = {
  nonce?: unknown;
  signature?: unknown;
  reason?: unknown;
};

function canonicalPayloadFor(nonce: string, publicKey: string, deviceLabel: string): string {
  // Stable, deterministic, no-JSON-quirks format. Stage B will canonicalise
  // its richer auth payload the same way (sorted-key JSON via a helper);
  // this slice keeps the format trivially auditable.
  return `attest-device|${nonce}|${publicKey}|${deviceLabel}`;
}

export const POST: RequestHandler = async ({ request }) => {
  requireAdminAuth(request);
  const raw = (await request.json().catch(() => null)) as AttestBody | null;
  if (!raw || typeof raw !== 'object') {
    throw error(400, 'Send a JSON body with nonce + signature.');
  }
  const nonce = typeof raw.nonce === 'string' ? raw.nonce : '';
  const signature = typeof raw.signature === 'string' ? raw.signature : '';
  const reason = typeof raw.reason === 'string' && raw.reason.length > 0 ? raw.reason : null;
  if (nonce.length === 0) throw error(400, 'nonce is required.');
  if (signature.length === 0) throw error(400, 'signature is required.');

  const challenge = consumeAttestChallenge(nonce);
  if (!challenge) throw error(401, 'Unknown or expired nonce. Request a fresh challenge.');

  if (!challenge.attesterKeyId) {
    throw error(409, 'Challenge has no attester key — recovery flow required.');
  }
  const attesterKey = getIdentityKeyById(challenge.attesterKeyId);
  if (!attesterKey) throw error(404, `Attester key ${challenge.attesterKeyId} not found.`);
  if (attesterKey.revokedAtMs !== null) {
    throw error(409, `Attester key ${challenge.attesterKeyId} is revoked.`);
  }

  const canonicalPayload = canonicalPayloadFor(
    challenge.nonce,
    challenge.newPublicKey,
    challenge.newDeviceLabel
  );
  const valid = verifySignature(canonicalPayload, signature, attesterKey.publicKey);
  if (!valid) throw error(401, 'Signature did not verify against attester key.');

  const { key, attestation } = mintIdentityKey({
    identityId: challenge.identityId,
    deviceLabel: challenge.newDeviceLabel,
    publicKey: challenge.newPublicKey,
    keyKind: 'device',
    attestedByKeyId: challenge.attesterKeyId,
    attesterKeyId: challenge.attesterKeyId,
    attesterKind: 'self',
    signature,
    canonicalPayload,
    reason
  });

  return json(
    {
      key_id: key.keyId,
      attestation_id: attestation.attestationId,
      device_label: key.deviceLabel,
      identity_id: key.identityId
    },
    { status: 201 }
  );
};
