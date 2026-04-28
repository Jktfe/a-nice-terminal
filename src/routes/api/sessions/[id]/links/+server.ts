import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db.js';
import { broadcast } from '$lib/server/ws-broadcast.js';
import { SESSIONS_CHANNEL } from '$lib/ws-channels';

function genId() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

const VALID_RELATIONSHIPS = ['discussion_of', 'promoted_summary_for', 'spawned_from', 'follows_up'];

/** GET /api/sessions/:id/links — list all links from this room (outgoing + incoming) */
export function GET({ params }: RequestEvent) {
  const roomId = params.id!;
  const outgoing = queries.getRoomLinks(roomId) as any[];
  const incoming = queries.getRoomBacklinks(roomId) as any[];
  return json({ outgoing, incoming });
}

/** POST /api/sessions/:id/links — create a link or create a discussion room + link */
export async function POST({ params, request }: RequestEvent) {
  const roomId = params.id!;
  const body = await request.json();

  // Verify source room exists
  const sourceRoom = queries.getSession(roomId) as any;
  if (!sourceRoom) throw error(404, 'Source room not found');
  if (sourceRoom.type !== 'chat') throw error(400, 'Room links can only be created from chat rooms');

  // Option A: link to an existing room
  if (body.targetRoomId) {
    if (body.targetRoomId === roomId) throw error(400, 'Room cannot link to itself');

    const targetRoom = queries.getSession(body.targetRoomId) as any;
    if (!targetRoom) throw error(404, 'Target room not found');
    if (targetRoom.type !== 'chat') throw error(400, 'Room links can only target chat rooms');

    const relationship = body.relationship || 'discussion_of';
    if (!VALID_RELATIONSHIPS.includes(relationship)) {
      throw error(400, `Invalid relationship. Valid: ${VALID_RELATIONSHIPS.join(', ')}`);
    }

    const linkId = genId();
    try {
      const settings = JSON.stringify({ inherit_parent_context: body.inheritContext !== false, ...body.settings });
      queries.createRoomLink(linkId, roomId, body.targetRoomId, relationship, body.title || null, body.createdBy || null, settings);
    } catch {
      throw error(409, 'Room link already exists');
    }

    broadcast(roomId, { type: 'room_link_created', roomId, linkId, targetRoomId: body.targetRoomId, relationship });

    return json({ id: linkId, sourceRoomId: roomId, targetRoomId: body.targetRoomId, relationship });
  }

  // Option B: create a new discussion room and link it
  const title = body.title || `Discussion: ${sourceRoom.name}`;
  const relationship = body.relationship || 'discussion_of';
  if (!VALID_RELATIONSHIPS.includes(relationship)) {
    throw error(400, `Invalid relationship. Valid: ${VALID_RELATIONSHIPS.join(', ')}`);
  }

  // Create the discussion room as a normal chat session
  const discussionId = genId();
  queries.createSession(discussionId, title, 'chat', 'forever', sourceRoom.workspace_id, sourceRoom.root_dir, JSON.stringify({ parent_room: roomId }));

  // Create the link
  const linkId = genId();
  try {
    const discussionSettings = JSON.stringify({ inherit_parent_context: true, ...body.settings });
    queries.createRoomLink(linkId, roomId, discussionId, relationship, body.title || title, body.createdBy || null, discussionSettings);
  } catch {
    throw error(409, 'Room link already exists');
  }

  // Auto-add current members from the source room
  if (body.copyMembers !== false) {
    try {
      const members = queries.getRoutableMembers(roomId) as any[];
      for (const member of members) {
        try {
          queries.addRoomMember(discussionId, member.session_id, member.role || 'participant', member.cli_flag || null, member.alias || null);
        } catch { /* duplicate — fine */ }
      }
    } catch { /* no members to copy — fine */ }
  }

  broadcast(roomId, { type: 'room_link_created', roomId, linkId, targetRoomId: discussionId, relationship, title });
  broadcast(SESSIONS_CHANNEL, { type: 'sessions_changed' });

  return json({
    id: linkId,
    sourceRoomId: roomId,
    targetRoomId: discussionId,
    discussionName: title,
    relationship,
    membersCopied: body.copyMembers !== false,
  }, { status: 201 });
}

/** DELETE /api/sessions/:id/links?linkId=xxx — remove a link */
export function DELETE({ params, url }: RequestEvent) {
  const linkId = url.searchParams.get('linkId');
  if (!linkId) throw error(400, 'linkId query parameter required');

  const result = queries.deleteRoomLinkForRoom(linkId, params.id!);
  if (!result?.changes) throw error(404, 'Room link not found');
  broadcast(params.id!, { type: 'room_link_deleted', roomId: params.id, linkId });

  return json({ ok: true });
}
