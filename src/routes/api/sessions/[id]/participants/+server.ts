import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';

function resolveCliFlag(session: any): string | null {
  if (session.cli_flag) return session.cli_flag;
  try {
    return JSON.parse(session.meta || '{}').agent_driver || null;
  } catch {
    return null;
  }
}

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
        const msgData = msgCountMap.get(m.session_id);
        return {
          id: m.session_id,
          name: m.display_name || m.name || m.session_id,
          handle: m.handle,
          alias: m.alias,
          session_type: m.type,
          session_status: m.session_status || null,
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
        const msgData = msgCountMap.get(m.session_id);
        return {
          id: m.session_id,
          name: m.display_name || m.name || m.session_id,
          handle: m.handle,
          alias: m.alias,
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

export async function POST({ params, request }: RequestEvent<{ id: string }>) {
  const room = queries.getSession(params.id);
  if (!room) return json({ error: 'not found' }, { status: 404 });
  if (room.type !== 'chat') return json({ error: 'room must be a chat session' }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const rawSessionId = typeof body.session_id === 'string' ? body.session_id.trim() : '';
  const rawHandle = typeof body.handle === 'string' ? body.handle.trim() : '';
  const role = body.role === 'external' ? 'external' : 'participant';

  if (!rawSessionId && !rawHandle) {
    return json({ error: 'session_id or handle required' }, { status: 400 });
  }

  const member = rawSessionId
    ? queries.getSession(rawSessionId)
    : queries.getSessionByHandle(rawHandle.startsWith('@') ? rawHandle : `@${rawHandle}`);

  if (!member) return json({ error: 'member session not found' }, { status: 404 });

  const aliasInput = typeof body.alias === 'string' ? body.alias.trim() : '';
  const alias = aliasInput || member.handle || null;
  const cliFlag = resolveCliFlag(member);
  queries.addRoomMember(params.id, member.id, role, cliFlag, alias);
  if (alias) queries.updateMemberAlias(params.id, member.id, alias);

  const added = (queries.listRoomMembers(params.id) as any[]).find((m: any) => m.session_id === member.id);
  return json({
    id: member.id,
    name: member.display_name || member.name || member.id,
    handle: member.handle,
    alias: added?.alias ?? alias,
    session_type: member.type,
    role,
    cli_flag: added?.cli_flag ?? cliFlag,
    joined_at: added?.joined_at ?? null,
  }, { status: 201 });
}
