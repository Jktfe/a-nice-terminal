/**
 * POST /api/identity/attest-challenge — substrate v0.2 Part 4 (2026-05-29).
 *
 * First leg of the device-attestation handshake. Client posts the target
 * identity_id, the new device's freshly-generated public key, and a label.
 * Server returns a 32-byte random nonce. Client then signs the nonce with
 * an EXISTING active key on the same identity (via OS keychain) and POSTs
 * the result to /api/identity/attest-device.
 *
 * Auth: admin-bearer for this slice. Stage B permissions will lift to a
 * per-identity bearer once the keychain bootstrap lands.
 *
 * TODO(stage-b): swap requireAdminAuth for a per-identity scoped gate.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdminAuth } from '$lib/server/chatInviteAuth';
import {
  getIdentityById,
  issueAttestChallenge,
  listActiveKeys,
  getIdentityKeyById
} from '$lib/server/identityKeysStore';

type ChallengeBody = {
  identity_id?: unknown;
  new_public_key?: unknown;
  new_device_label?: unknown;
  attester_key_id?: unknown;
};

export const POST: RequestHandler = async ({ request }) => {
  requireAdminAuth(request);
  const raw = (await request.json().catch(() => null)) as ChallengeBody | null;
  if (!raw || typeof raw !== 'object') {
    throw error(400, 'Send a JSON body with identity_id + new_public_key + new_device_label.');
  }
  const identityId = typeof raw.identity_id === 'string' ? raw.identity_id : '';
  const newPublicKey = typeof raw.new_public_key === 'string' ? raw.new_public_key : '';
  const newDeviceLabel = typeof raw.new_device_label === 'string' ? raw.new_device_label : '';
  const attesterKeyIdRaw = typeof raw.attester_key_id === 'string' ? raw.attester_key_id : null;

  if (identityId.length === 0) throw error(400, 'identity_id is required.');
  if (newPublicKey.length === 0) throw error(400, 'new_public_key is required.');
  if (newDeviceLabel.length === 0) throw error(400, 'new_device_label is required.');

  const identity = getIdentityById(identityId);
  if (!identity) throw error(404, `Identity ${identityId} not found.`);
  if (identity.revokedAtMs !== null) {
    throw error(409, `Identity ${identityId} is revoked.`);
  }

  // If an attester key was specified, sanity-check it's active and bound
  // to this identity. Stage B will reject mismatches more thoroughly.
  if (attesterKeyIdRaw) {
    const attesterKey = getIdentityKeyById(attesterKeyIdRaw);
    if (!attesterKey) throw error(404, `Attester key ${attesterKeyIdRaw} not found.`);
    if (attesterKey.identityId !== identityId) {
      throw error(409, `Attester key ${attesterKeyIdRaw} belongs to a different identity.`);
    }
    if (attesterKey.revokedAtMs !== null) {
      throw error(409, `Attester key ${attesterKeyIdRaw} is revoked.`);
    }
  } else {
    // No attester specified — require AT LEAST one active key on the identity
    // (otherwise the caller is asking for a Tier 2/3 recovery, not a Tier 1
    // attestation; that goes through /api/identity/recover, not here).
    const active = listActiveKeys(identityId);
    if (active.length === 0) {
      throw error(
        409,
        `Identity ${identityId} has no active keys. Use the recovery flow (ant identity recover) instead.`
      );
    }
  }

  const { nonce } = issueAttestChallenge({
    identityId,
    newPublicKey,
    newDeviceLabel,
    attesterKeyId: attesterKeyIdRaw
  });
  return json({ nonce, ttl_ms: 5 * 60 * 1000 }, { status: 201 });
};
