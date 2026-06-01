/**
 * POST /api/remote-ant/admissions/:admissionId/redeem
 *
 * Body: { code: string, remoteInstanceLabel: string, direction?: 'in'|'out'|'both' }
 * Auth: NONE (the code IS the auth — single-use, hashed-compare).
 *
 * On success (201): { mapping: {...}, bridge_token: 'rbt_...' }
 *   bridge_token plaintext returned ONCE.
 * On failure: 410 Gone (admission revoked, expired, or already redeemed,
 *   OR wrong code). Per T2 B1 atomicity fix: NO mapping/terminal/
 *   membership rows written when redeem fails — the entire flow runs
 *   inside redeemAdmissionAndMintMapping's single tx.
 * 400 missing body fields.
 */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { MappingDirection } from '$lib/server/remoteMappingStore';
import { redeemAdmissionAndMintMapping } from '$lib/server/remoteRedeem';

const ALLOWED_DIRECTIONS: readonly MappingDirection[] = ['in', 'out', 'both'];

function isAllowedDirection(v: unknown): v is MappingDirection {
  return typeof v === 'string' && (ALLOWED_DIRECTIONS as readonly string[]).includes(v);
}

export const POST: RequestHandler = async ({ request, params }) => {
  const admissionId = params.admissionId ?? '';
  if (admissionId.length === 0) throw error(400, 'admissionId required');
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'invalid JSON body');
  }
  if (!body || typeof body !== 'object') throw error(400, 'body required');
  const code = (body as Record<string, unknown>).code;
  const label = (body as Record<string, unknown>).remoteInstanceLabel;
  const directionRaw = (body as Record<string, unknown>).direction;
  if (typeof code !== 'string' || code.length === 0) throw error(400, 'code required');
  if (typeof label !== 'string' || label.length === 0) throw error(400, 'remoteInstanceLabel required');
  let direction: MappingDirection | undefined = undefined;
  if (directionRaw !== undefined) {
    if (!isAllowedDirection(directionRaw)) throw error(400, 'direction must be in|out|both');
    direction = directionRaw;
  }

  const result = redeemAdmissionAndMintMapping({
    admissionId,
    code,
    remoteInstanceLabel: label,
    direction
  });
  if (!result) throw error(410, 'admission not found, revoked, expired, or already redeemed');

  return json({
    mapping: {
      id: result.mapping.id,
      room_id: result.mapping.room_id,
      remote_instance_label: result.mapping.remote_instance_label,
      direction: result.mapping.direction,
      lifetime_preset: result.mapping.lifetime_preset,
      expires_at_ms: result.mapping.expires_at_ms
    },
    bridge_token: result.bridgeToken
  }, { status: 201 });
};
