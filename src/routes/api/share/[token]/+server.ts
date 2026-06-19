import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getShareLink, incrementLinkAccess, revokeShareLink } from '$lib/server/shareLinkStore';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { requireChatRoomMutationAuth } from '$lib/server/chatRoomAuthGate';

export const GET: RequestHandler = async ({ params, fetch }) => {
  const link = getShareLink(params.token);
  if (!link) throw error(404, 'Link not found');
  if (link.revoked_at_ms) throw error(410, 'Link revoked');
  if (link.expires_at_ms && link.expires_at_ms < Date.now()) throw error(410, 'Link expired');

  incrementLinkAccess(params.token);

  const room = findChatRoomById(link.room_id);
  if (!room) throw error(404, 'Room not found');

  const response: Record<string, unknown> = {
    room: { id: room.id, name: room.name },
    scope: link.scope,
    title: link.title,
    accessed_at: Date.now(),
  };

  if (link.scope === 'messages' || link.scope === 'room') {
    const messagesRes = await fetch(`/api/chat-rooms/${encodeURIComponent(link.room_id)}/messages?limit=100`);
    if (messagesRes.ok) {
      const messagesBody = await messagesRes.json();
      response.messages = messagesBody.messages || [];
    }
  }

  return json(response);
};

export const DELETE: RequestHandler = async ({ request, params }) => {
  const link = getShareLink(params.token);
  if (!link) throw error(404, 'Link not found');
  requireChatRoomMutationAuth(link.room_id, request, null);
  revokeShareLink(params.token);
  return json({ token: params.token });
};
