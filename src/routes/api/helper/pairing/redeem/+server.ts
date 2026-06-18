/**
 * POST /api/helper/pairing/redeem — a desktop app redeems a pairing code for a
 * lease (antAppHelper SPEC §3). Open endpoint: the code IS the credential
 * (single-use, short-TTL, mintable only by the signed-in operator), so no
 * separate auth is required here — possession of a live code is the proof.
 *
 * Body: { code: "7F3A29", host?: "mac-mini" }
 *   → 201 { handle, role, leaseId, leaseSecret, scope, expiresAtMs }
 *   → 410 when the code is unknown / expired / already used
 *
 * The leaseSecret is returned ONCE — the app stores it in the OS keychain. The
 * scope is the FIXED profile for the pairing's role: a 'reader' (helper) may
 * subscribe + fire routes; an 'agent' may also post status. Neither role can
 * write room timeline messages.
 * Claiming handles / approving asks are never granted by an attachment.
 */
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { redeemPairingCode } from '$lib/server/helperPairingStore';
import { ATTACHMENT_SCOPES } from '$lib/server/helperLeaseStore';

type Body = { code?: unknown; host?: unknown };

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body || typeof body !== 'object') throw error(400, 'JSON body required with { code }.');
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (code.length === 0) throw error(400, 'code is required.');
  const host = typeof body.host === 'string' && body.host.trim().length > 0 ? body.host.trim() : null;

  const redeemed = redeemPairingCode({ code, pairedHost: host });
  if (!redeemed) throw error(410, 'pairing code is invalid, expired, or already used.');

  return json(
    {
      handle: redeemed.handle,
      role: redeemed.role,
      leaseId: redeemed.leaseId,
      leaseSecret: redeemed.leaseSecret,
      scope: ATTACHMENT_SCOPES[redeemed.role],
      expiresAtMs: redeemed.lease.expires_at_ms
    },
    { status: 201 }
  );
};
