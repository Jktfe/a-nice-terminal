/**
 * GET /api/remote-invites/list-all — aggregated, machine-wide listing of
 * active (un-redeemed, un-revoked, un-expired) remote-ant admissions across
 * ALL rooms, for the antOS terminals-page invites panel.
 *
 * The per-room shim (/api/remote-invites/list?roomId=R) only covers one room;
 * this aggregates so the operator can see who is invited where in one view and
 * decide where to mint ANT helpers. Each row carries `created_by_handle` so
 * ownership is visible. The plaintext invite code is NEVER replayed here (it is
 * returned once at create time).
 *
 * Auth: Mac antchat Bearer token. 401 if missing/unresolved.
 */
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { bearerTokenFromHeader, resolveToken } from '$lib/server/antchatAuthStore';
import { listChatRooms } from '$lib/server/chatRoomStore';
import { listActivePendingAcrossRooms } from '$lib/server/remoteAdmissionStore';

export const GET: RequestHandler = async ({ request }) => {
  const bearer = bearerTokenFromHeader(request.headers.get('authorization'));
  if (!bearer) throw error(401, 'bearer token required');
  const session = resolveToken(bearer);
  if (!session) throw error(401, 'invalid or expired token');

  const rooms = listChatRooms();
  const roomNameById = new Map(rooms.map((r) => [r.id, r.name]));
  const now = Date.now();

  const invites = listActivePendingAcrossRooms(
    rooms.map((r) => r.id),
    now
  ).map((a) => ({
    admission_id: a.id,
    room_id: a.room_id,
    room_name: roomNameById.get(a.room_id) ?? null,
    lifetime_preset: a.lifetime_preset,
    expires_at_ms: a.expires_at_ms,
    created_at_ms: a.created_at_ms,
    expires_acceptance_at_ms: a.expires_acceptance_at_ms,
    created_by_handle: a.created_by_handle
  }));

  return json({ invites });
};
