/**
 * GET    /api/chat-rooms/:roomId/links            list outgoing + incoming
 * POST   /api/chat-rooms/:roomId/links            create a link to an
 *                                                 existing room
 * DELETE /api/chat-rooms/:roomId/links?linkId=    remove a link by id
 *
 * Task #49 v3 parity: lets a room surface its sibling discussions /
 * spawned-from / follow-up rooms so the UI can navigate between linked
 * rooms without pasting URLs.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import {
  ROOM_LINK_RELATIONSHIPS,
  createRoomLink,
  deleteRoomLink,
  DuplicateRoomLinkError,
  listIncomingRoomLinks,
  listOutgoingRoomLinks,
  type RoomLinkRelationship
} from '$lib/server/chatRoomLinkStore';
import { requireChatRoomMutationAuth } from '$lib/server/chatRoomAuthGate';

function isKnownRelationship(value: unknown): value is RoomLinkRelationship {
  return (
    typeof value === 'string' &&
    (ROOM_LINK_RELATIONSHIPS as readonly string[]).includes(value)
  );
}

export function GET({ params }: RequestEvent<{ roomId: string }>) {
  const roomId = params.roomId;
  if (!roomId) throw error(400, 'roomId is required.');
  const room = findChatRoomById(roomId);
  if (!room) throw error(404, 'Room not found');
  return json({
    outgoing: listOutgoingRoomLinks(roomId),
    incoming: listIncomingRoomLinks(roomId)
  });
}

export async function POST({ params, request }: RequestEvent<{ roomId: string }>) {
  const sourceRoomId = params.roomId;
  if (!sourceRoomId) throw error(400, 'roomId is required.');

  const sourceRoom = findChatRoomById(sourceRoomId);
  if (!sourceRoom) throw error(404, 'Source room not found');

  const payload = (await request.json().catch(() => null)) as
    | { targetRoomId?: unknown; relationship?: unknown; title?: unknown; createdBy?: unknown }
    | null;
  if (!payload) throw error(400, 'JSON body required.');

  // CVE FIX D miss (msg_hodqchn3ek code-review CRITICAL #1, 2026-05-20):
  // this route was using `export async function POST` instead of `export
  // const`, so the manual cascade-review pattern that drove the CVE FIX D
  // pass at 14f00c6 skipped it entirely. Anonymous network callers
  // could create + delete arbitrary room links + spoof createdBy. Now
  // gated through the same chatRoomAuthGate the rest of the cascade
  // uses, AND createdBy is stamped from the resolved auth (body field
  // ignored — same anti-spoof pattern as CVE-B for terminals/kill).
  const auth = requireChatRoomMutationAuth(sourceRoomId, request, payload);

  const { targetRoomId, relationship, title } = payload;

  if (typeof targetRoomId !== 'string' || targetRoomId.length === 0) {
    throw error(400, 'targetRoomId is required.');
  }
  if (targetRoomId === sourceRoomId) {
    throw error(400, 'A room cannot link to itself.');
  }

  const targetRoom = findChatRoomById(targetRoomId);
  if (!targetRoom) throw error(404, 'Target room not found');

  const resolvedRelationship: RoomLinkRelationship = isKnownRelationship(relationship)
    ? relationship
    : 'discussion_of';

  try {
    const link = createRoomLink({
      sourceRoomId,
      targetRoomId,
      relationship: resolvedRelationship,
      title: typeof title === 'string' ? title : null,
      createdBy: auth.handle
    });
    return json(link, { status: 201 });
  } catch (cause) {
    if (cause instanceof DuplicateRoomLinkError) throw error(409, cause.message);
    throw cause;
  }
}

export async function DELETE({ params, url, request }: RequestEvent<{ roomId: string }>) {
  const sourceRoomId = params.roomId;
  if (!sourceRoomId) throw error(400, 'roomId is required.');

  // Same gate as POST — anonymous network callers should not be able
  // to mass-delete room links. No body to parse (DELETE uses query).
  requireChatRoomMutationAuth(sourceRoomId, request, null);

  const linkId = url.searchParams.get('linkId');
  if (!linkId) throw error(400, 'linkId query parameter is required.');

  const removed = deleteRoomLink(linkId);
  if (!removed) throw error(404, 'Link not found');
  return new Response(null, { status: 204 });
}
