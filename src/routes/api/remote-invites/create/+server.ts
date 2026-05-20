/**
 * POST /api/remote-invites/create — Mac antchat shim for minting a
 * remote-ant invite via the signed-in user's Bearer token.
 *
 * Why this shim exists: the Mac antchat app speaks the
 * `/api/remote-invites/*` namespace; the canonical implementation lives
 * under `/api/remote-ant/*` and is admin-bearer-gated (CLI/automation
 * surface). This route gives the Mac app a Bearer-token-authenticated
 * surface that reuses the same `remoteAdmissionStore.createAdmission`
 * primitive — no new persistence, no duplicated logic.
 *
 * Auth: Mac antchat Bearer token (issued by /api/auth/login). 401 if
 * missing/unresolved.
 *
 * Request body:
 *   { roomId: string, lifetimePreset?: 'today'|'48h'|'7d'|'indefinite' }
 *
 * Response (201):
 *   {
 *     token: string,                  // plaintext invite code (ANT-XXX-YYYY); returned ONCE
 *     invite_url: string,             // antchat://invite?admission_id=...&token=... deep link
 *     admission_id: string,           // adm_... for follow-up list/revoke
 *     room_id: string,
 *     lifetime_preset: 'today'|'48h'|'7d'|'indefinite',
 *     expires_at_ms: number | null,
 *     expires_acceptance_at_ms: number,
 *     created_at_ms: number
 *   }
 *
 * Errors:
 *   400 missing/malformed body or bad lifetime_preset enum
 *   401 missing/invalid antchat Bearer
 *
 * Source directive: @evolveantswift msg_57o7qyc54b (D2 remote-invite shim).
 */
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  bearerTokenFromHeader,
  resolveToken,
  userShapeForEmail
} from '$lib/server/antchatAuthStore';
import { createAdmission, type LifetimePreset } from '$lib/server/remoteAdmissionStore';

const ALLOWED_PRESETS: readonly LifetimePreset[] = ['today', '48h', '7d', 'indefinite'];

function isAllowedPreset(value: unknown): value is LifetimePreset {
  return typeof value === 'string' && (ALLOWED_PRESETS as readonly string[]).includes(value);
}

function buildInviteUrl(admissionId: string, token: string): string {
  const params = new URLSearchParams({ admission_id: admissionId, token });
  return `antchat://invite?${params.toString()}`;
}

export const POST: RequestHandler = async ({ request }) => {
  const bearer = bearerTokenFromHeader(request.headers.get('authorization'));
  if (!bearer) throw error(401, 'bearer token required');
  const session = resolveToken(bearer);
  if (!session) throw error(401, 'invalid or expired token');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'invalid JSON body');
  }
  if (!body || typeof body !== 'object') throw error(400, 'body required');

  const raw = body as Record<string, unknown>;
  const roomId = raw.roomId;
  if (typeof roomId !== 'string' || roomId.length === 0) {
    throw error(400, 'roomId required');
  }
  const presetRaw = raw.lifetimePreset ?? '48h';
  if (!isAllowedPreset(presetRaw)) {
    throw error(400, 'lifetimePreset must be one of today|48h|7d|indefinite');
  }

  // Stamp the inviter's antchat handle on the admission so the room
  // operator can see who minted the link.
  const inviterHandle = userShapeForEmail(session.email).handle;

  const result = createAdmission({
    roomId,
    lifetimePreset: presetRaw,
    createdByHandle: inviterHandle
  });

  return json(
    {
      token: result.code,
      invite_url: buildInviteUrl(result.admission.id, result.code),
      admission_id: result.admission.id,
      room_id: result.admission.room_id,
      lifetime_preset: result.admission.lifetime_preset,
      expires_at_ms: result.admission.expires_at_ms,
      expires_acceptance_at_ms: result.admission.expires_acceptance_at_ms,
      created_at_ms: result.admission.created_at_ms
    },
    { status: 201 }
  );
};
