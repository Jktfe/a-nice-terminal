import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db.js';
import { broadcast } from '$lib/server/ws-broadcast.js';
import { assertCanWrite, assertSameRoom } from '$lib/server/room-scope';
import { SESSIONS_CHANNEL } from '$lib/ws-channels';

function genId() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

const VALID_RELATIONSHIPS = ['discussion_of', 'promoted_summary_for', 'spawned_from', 'follows_up'];

function getActiveChatRoom(roomId: string, label = 'Room') {
  const room = queries.getSession(roomId) as any;
  if (!room) throw error(404, `${label} not found`);
  if (room.archived || room.deleted_at) throw error(410, `${label} is inactive`);
  if (room.type !== 'chat') throw error(400, 'Room links can only be created between chat rooms');
  return room;
}

async function readBody(request: Request) {
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
    return body as Record<string, any>;
  } catch {
    return null;
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function relationshipValue(value: unknown) {
  const relationship = stringValue(value) ?? 'discussion_of';
  if (!VALID_RELATIONSHIPS.includes(relationship)) {
    throw error(400, `Invalid relationship. Valid: ${VALID_RELATIONSHIPS.join(', ')}`);
  }
  return relationship;
}

/** GET /api/sessions/:id/links — list all links from this room (outgoing + incoming) */
export function GET(event: RequestEvent) {
  const { params } = event;
  const roomId = params.id!;
  assertSameRoom(event, roomId);
  getActiveChatRoom(roomId);
  const outgoing = queries.getRoomLinks(roomId) as any[];
  const incoming = queries.getRoomBacklinks(roomId) as any[];
  return json({ outgoing, incoming });
}

/** POST /api/sessions/:id/links — create a link or create a discussion room + link */
export async function POST(event: RequestEvent) {
  const { params, request } = event;
  const roomId = params.id!;
  assertSameRoom(event, roomId);
  assertCanWrite(event);

  // Verify source room exists and is active before parsing or linking.
  const sourceRoom = getActiveChatRoom(roomId, 'Source room');
  const body = await readBody(request);
  if (body === null) return json({ error: 'Invalid JSON' }, { status: 400 });

  const relationship = relationshipValue(body.relationship);
  const settings = objectValue(body.settings);

  // Option A: link to an existing room
  if (Object.prototype.hasOwnProperty.call(body, 'targetRoomId')) {
    const targetRoomId = stringValue(body.targetRoomId);
    if (!targetRoomId) throw error(400, 'targetRoomId must be a non-empty string');
    if (targetRoomId === roomId) throw error(400, 'Room cannot link to itself');

    getActiveChatRoom(targetRoomId, 'Target room');

    const linkId = genId();
    try {
      const linkSettings = JSON.stringify({ inherit_parent_context: body.inheritContext !== false, ...settings });
      queries.createRoomLink(linkId, roomId, targetRoomId, relationship, stringValue(body.title), stringValue(body.createdBy), linkSettings);
    } catch {
      throw error(409, 'Room link already exists');
    }

    broadcast(roomId, { type: 'room_link_created', roomId, linkId, targetRoomId, relationship });

    return json({ id: linkId, sourceRoomId: roomId, targetRoomId, relationship });
  }

  // Option B: create a new discussion room and link it
  const title = stringValue(body.title) ?? `Discussion: ${sourceRoom.name}`;

  // Create the discussion room as a normal chat session
  const discussionId = genId();
  queries.createSession(discussionId, title, 'chat', 'forever', sourceRoom.workspace_id, sourceRoom.root_dir, JSON.stringify({ parent_room: roomId }));

  // Create the link
  const linkId = genId();
  try {
    const discussionSettings = JSON.stringify({ inherit_parent_context: true, ...settings });
    queries.createRoomLink(linkId, roomId, discussionId, relationship, title, stringValue(body.createdBy), discussionSettings);
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
export function DELETE(event: RequestEvent) {
  const { params, url } = event;
  assertSameRoom(event, params.id!);
  assertCanWrite(event);

  getActiveChatRoom(params.id!);
  const linkId = url.searchParams.get('linkId');
  if (!linkId) throw error(400, 'linkId query parameter required');

  const result = queries.deleteRoomLinkForRoom(linkId, params.id!);
  if (!result?.changes) throw error(404, 'Room link not found');
  broadcast(params.id!, { type: 'room_link_deleted', roomId: params.id, linkId });

  return json({ ok: true });
}
