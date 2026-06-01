/**
 * GET /api/remote-invites/list?roomId=R — Mac antchat shim listing
 * active (un-redeemed, un-revoked, un-expired) remote-ant admissions for
 * a room.
 *
 * Wraps `remoteAdmissionStore.listActiveForRoom` and filters down to
 * admissions that are still inside their acceptance window AND have not
 * been accepted yet — i.e. invites that could still be redeemed. Already-
 * redeemed admissions surface via `/api/remote-ant/mappings` (or its
 * future shim equivalent) and are intentionally excluded here so the
 * Mac app's "pending invites" panel doesn't double-count them.
 *
 * Auth: Mac antchat Bearer token (issued by /api/auth/login). 401 if
 * missing/unresolved.
 *
 * Query params:
 *   roomId  required — the room whose invites to list
 *
 * Response (200):
 *   { invites: Array<{
 *       admission_id: string,
 *       room_id: string,
 *       lifetime_preset: 'today'|'48h'|'7d'|'indefinite',
 *       expires_at_ms: number | null,
 *       created_at_ms: number,
 *       expires_acceptance_at_ms: number,
 *       created_by_handle: string | null
 *     }> }
 *
 *   Note: the plaintext invite code is NEVER replayed here. It is
 *   returned ONCE at create time. Token-hash storage is by design.
 *
 * Errors:
 *   400 missing roomId
 *   401 missing/invalid antchat Bearer
 *
 * Source directive: @evolveantswift msg_57o7qyc54b (D2 remote-invite shim).
 */
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  bearerTokenFromHeader,
  resolveToken
} from '$lib/server/antchatAuthStore';
import { listActiveForRoom } from '$lib/server/remoteAdmissionStore';

export const GET: RequestHandler = async ({ request, url }) => {
  const bearer = bearerTokenFromHeader(request.headers.get('authorization'));
  if (!bearer) throw error(401, 'bearer token required');
  const session = resolveToken(bearer);
  if (!session) throw error(401, 'invalid or expired token');

  const roomId = url.searchParams.get('roomId') ?? '';
  if (roomId.length === 0) throw error(400, 'roomId required');

  const now = Date.now();
  const invites = listActiveForRoom(roomId)
    // Pending invites only — accepted ones graduate to mappings.
    .filter((a) => a.accepted_at_ms === null && now <= a.expires_acceptance_at_ms)
    .map((a) => ({
      admission_id: a.id,
      room_id: a.room_id,
      lifetime_preset: a.lifetime_preset,
      expires_at_ms: a.expires_at_ms,
      created_at_ms: a.created_at_ms,
      expires_acceptance_at_ms: a.expires_acceptance_at_ms,
      created_by_handle: a.created_by_handle
    }));

  return json({ invites });
};
