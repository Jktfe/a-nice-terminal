import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';
import { revokeToken } from '$lib/server/room-invites';

export function DELETE({ params }: RequestEvent<{ id: string; inviteId: string; tokenId: string }>) {
  const invite = queries.getRoomInvite(params.inviteId) as any;
  if (!invite || invite.room_id !== params.id) throw error(404, 'Invite not found');

  const tokens = queries.listRoomTokens(params.inviteId) as any[];
  const token = tokens.find((t) => t.id === params.tokenId);
  if (!token) throw error(404, 'Token not found');
  if (token.revoked_at) return json({ ok: true, already_revoked: true });

  const ok = revokeToken(params.tokenId);
  return json({ ok });
}
