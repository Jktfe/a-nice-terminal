import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';
import { revokeInvite } from '$lib/server/room-invites';
import { assertNotRoomScoped } from '$lib/server/room-scope';

export function DELETE(event: RequestEvent<{ id: string; inviteId: string }>) {
  // Revoking an invite is admin-only — a guest can't kill the door they
  // came through, much less the doors others came through.
  assertNotRoomScoped(event);
  const { params } = event;
  const invite = queries.getRoomInvite(params.inviteId) as any;
  if (!invite || invite.room_id !== params.id) throw error(404, 'Invite not found');
  if (invite.revoked_at) return json({ ok: true, already_revoked: true });
  const ok = revokeInvite(params.inviteId);
  return json({ ok });
}
