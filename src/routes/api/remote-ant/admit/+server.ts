/**
 * POST /api/remote-ant/admit — operator mints a remote-invite code.
 *
 * Body: { roomId: string, lifetimePreset: 'today'|'48h'|'7d'|'indefinite',
 *         createdByHandle?: string }
 * Auth: admin-bearer (ANT_ADMIN_TOKEN) per chatInviteAuth.requireAdminAuth.
 *
 * Response (201):
 *   { admission: { id, room_id, lifetime_preset, expires_at_ms,
 *                  created_at_ms, expires_acceptance_at_ms },
 *     code: 'ANT-XXX-YYYY' }   // plaintext returned ONCE
 *
 * 400 missing/malformed body or bad lifetime_preset enum.
 */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdminAuth } from '$lib/server/chatInviteAuth';
import { createAdmission, type LifetimePreset } from '$lib/server/remoteAdmissionStore';

const ALLOWED_PRESETS: readonly LifetimePreset[] = ['today', '48h', '7d', 'indefinite'];

function isAllowedPreset(value: unknown): value is LifetimePreset {
  return typeof value === 'string' && (ALLOWED_PRESETS as readonly string[]).includes(value);
}

export const POST: RequestHandler = async ({ request }) => {
  requireAdminAuth(request);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'invalid JSON body');
  }
  if (!body || typeof body !== 'object') throw error(400, 'body required');
  const room_id = (body as Record<string, unknown>).roomId;
  const preset = (body as Record<string, unknown>).lifetimePreset;
  const createdByHandle = (body as Record<string, unknown>).createdByHandle;
  if (typeof room_id !== 'string' || room_id.length === 0) throw error(400, 'roomId required');
  if (!isAllowedPreset(preset)) throw error(400, 'lifetimePreset must be one of today|48h|7d|indefinite');
  const result = createAdmission({
    roomId: room_id,
    lifetimePreset: preset,
    createdByHandle: typeof createdByHandle === 'string' ? createdByHandle : null
  });
  return json({
    admission: {
      id: result.admission.id,
      room_id: result.admission.room_id,
      lifetime_preset: result.admission.lifetime_preset,
      expires_at_ms: result.admission.expires_at_ms,
      created_at_ms: result.admission.created_at_ms,
      expires_acceptance_at_ms: result.admission.expires_acceptance_at_ms
    },
    code: result.code
  }, { status: 201 });
};
