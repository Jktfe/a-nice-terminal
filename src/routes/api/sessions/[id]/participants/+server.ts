import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';

export function GET({ params }: RequestEvent<{ id: string }>) {
  const session = queries.getSession(params.id);
  if (!session) return json({ error: 'not found' }, { status: 404 });

  // Phase 6: Return structured participants from chat_room_members if available,
  // falling back to message-derived participants for backwards compatibility.
  const roomMembers: any[] = queries.listRoomMembers(params.id);

  if (roomMembers.length > 0) {
    // Enrich with message counts from the legacy query
    const messageDerived: any[] = queries.listParticipants(params.id);
    const msgCountMap = new Map(messageDerived.map((p: any) => [p.id, p]));

    const participants = roomMembers
      .filter((m: any) => m.role === 'participant')
      .map((m: any) => {
        const msgData = msgCountMap.get(m.member_id);
        return {
          id: m.member_id,
          name: m.member_name || m.member_id,
          handle: m.handle,
          session_type: m.session_type,
          session_status: m.session_status,
          cli_flag: m.cli_flag,
          role: m.role,
          joined_at: m.joined_at,
          first_seen: msgData?.first_seen,
          last_seen: msgData?.last_seen,
          message_count: msgData?.message_count || 0,
        };
      });

    const postsFrom = roomMembers
      .filter((m: any) => m.role === 'external')
      .map((m: any) => {
        const msgData = msgCountMap.get(m.member_id);
        return {
          id: m.member_id,
          name: m.member_name || m.member_id,
          handle: m.handle,
          cli_flag: m.cli_flag,
          role: m.role,
          joined_at: m.joined_at,
          first_seen: msgData?.first_seen,
          last_seen: msgData?.last_seen,
          message_count: msgData?.message_count || 0,
        };
      });

    return json({
      participants,
      postsFrom,
      all: [...participants, ...postsFrom],
    });
  }

  // Fallback: no room members yet, use message-derived participants
  const messageDerived = queries.listParticipants(params.id);
  return json({
    participants: messageDerived,
    postsFrom: [],
    all: messageDerived,
  });
}
