/**
 * v3-compat shim — translates v3 CLI's `POST /api/sessions/:id/messages` into
 * v4's `POST /api/chat-rooms/:id/messages`. Unblocks `ant chat send` from the
 * globally-installed v3 CLI (~/.bun/bin/ant) which hits this path with a v3
 * body shape and currently 404s → CLI wraps to HTTP 500. localgem (LM Studio
 * gemma) + every other agent on the v3 CLI tonight hits the same wall.
 *
 * v3 body:    { role, content, format, sender_id, msg_type?, meta?, target? }
 * v4 body:    { body, authorHandle?, kind?, parentMessageId?, pidChain? }
 *
 * Strategy: in-process HTTP loopback to the v4 route. Preserves all headers
 * (cookies, admin bearer, identity-gate inputs) so the v4 handler's auth path
 * is the one source of truth. We translate body fields only.
 *
 * Banked: project_ant_spawned_terminals_dual_table_2026_05_16 (autoRegister)
 * + the abstract-kindling-fiddle plan (CLI v3→v4 migration). This shim is
 * intentionally TEMPORARY — once ~/.bun/bin/ant points at the v4 CLI, v3
 * CLI no longer hits /api/sessions/:id/messages and this route can be
 * removed.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { doesChatRoomExist } from '$lib/server/chatRoomStore';
import { listMessagesPageInRoom, postMessage, type ChatMessage } from '$lib/server/chatMessageStore';
import { requireAdminAuth } from '$lib/server/chatInviteAuth';
import { verifyToken } from '$lib/server/chatInviteStore';
import { broadcastToRoom } from '$lib/server/eventBroadcast';
import { fanoutMessageToRoomTerminals } from '$lib/server/pty-inject-fanout';
import { hasBareEveryoneMention } from '$lib/chat/mentionRouting';
import { collectAskCandidatesFromMessage } from '$lib/server/askCandidateStore';

type V3Body = {
  role?: unknown;
  content?: unknown;
  format?: unknown;
  sender_id?: unknown;
  msg_type?: unknown;
  meta?: unknown;
  target?: unknown;
  pidChain?: unknown;
  parentMessageId?: unknown;
};

const DEFAULT_MESSAGE_PAGE_SIZE = 50;
const MAX_MESSAGE_PAGE_SIZE = 200;

function translateBody(v3: V3Body): Record<string, unknown> | null {
  const content = typeof v3.content === 'string' ? v3.content : null;
  if (content === null) return null;
  const sender = typeof v3.sender_id === 'string' && v3.sender_id.trim().length > 0
    ? v3.sender_id
    : null;
  const v4: Record<string, unknown> = { body: content };
  if (sender) v4.authorHandle = sender;
  // pidChain is the identity-gate input — passthrough if the CLI included it
  if (Array.isArray(v3.pidChain)) v4.pidChain = v3.pidChain;
  // parentMessageId carries through verbatim if present
  if (typeof v3.parentMessageId === 'string') v4.parentMessageId = v3.parentMessageId;
  // kind/meta/msg_type are dropped — v4's chat-rooms route enforces its own
  // kind validation. v3 CLI doesn't set kind so default ('human') is fine.
  return v4;
}

function parseLimit(rawLimit: string | null): number {
  if (rawLimit === null || rawLimit.trim().length === 0) return DEFAULT_MESSAGE_PAGE_SIZE;
  const parsed = Number(rawLimit);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw error(400, 'limit must be a positive integer.');
  }
  return Math.min(parsed, MAX_MESSAGE_PAGE_SIZE);
}

function emitLegacyMessageSideEffects(roomId: string, message: ChatMessage): void {
  try {
    collectAskCandidatesFromMessage(message);
  } catch {
    /* ask-candidate inference is best-effort */
  }
  try {
    fanoutMessageToRoomTerminals(roomId, message, {
      forceBroadcastToAll: hasBareEveryoneMention(message.body)
    });
  } catch {
    /* fanout is best-effort */
  }
  try {
    broadcastToRoom(roomId, { type: 'message_added', message });
  } catch {
    /* SSE broadcast is best-effort */
  }
  try {
    broadcastToRoom(roomId, {
      type: 'agent_activity',
      handle: message.authorHandle,
      status: 'working',
      at: new Date().toISOString()
    });
  } catch {
    /* activity tick is best-effort */
  }
}

export const POST: RequestHandler = async ({ params, request, fetch }) => {
  const id = params.id;
  if (!id) throw error(400, 'id required.');
  if (!doesChatRoomExist(id)) {
    throw error(404, `Chat room ${id} not found (v3-compat shim).`);
  }
  const raw = (await request.json().catch(() => null)) as V3Body | null;
  if (!raw || typeof raw !== 'object') {
    throw error(400, 'JSON body required.');
  }
  const translated = translateBody(raw);
  if (!translated) {
    throw error(400, 'v3 body must include a string content field.');
  }

  // Auth paths (in priority): admin-bearer → v3 room-token → loopback gate.
  //
  // 1. Admin bearer: v3 CLI's ctx.apiKey carries the admin token when no
  //    per-room token is configured. v3 trust model is "admin = full access"
  //    — sender_id taken at face value.
  // 2. v3 room-token: when ~/.ant/config.json has a per-room token entry,
  //    the CLI passes it as `Authorization: Bearer <fullToken>` INSTEAD of
  //    the admin bearer. verifyToken resolves it to a {handle, room_id};
  //    we override authorHandle with the token's handle (prevents
  //    sender_id-spoofing across token kinds).
  // 3. Otherwise fall through to event.fetch loopback → v4 chat-rooms
  //    POST → identity gate (pidChain / browser-session).
  const authHeader = request.headers.get('authorization') ?? '';
  const bearerSecret = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  let isAdmin = false;
  try {
    requireAdminAuth(request);
    isAdmin = true;
  } catch {
    /* not admin — try room-token next */
  }
  let roomTokenHandle: string | null = null;
  if (!isAdmin && bearerSecret.length > 0) {
    const tokenIdentity = verifyToken(bearerSecret, id);
    if (tokenIdentity) roomTokenHandle = tokenIdentity.handle ?? null;
  }
  if (isAdmin || roomTokenHandle) {
    const authorHandle = roomTokenHandle
      ?? (translated.authorHandle as string | undefined)
      ?? '@cli';
    const messageBody = translated.body as string;
    const parentMessageId = translated.parentMessageId as string | undefined;
    const newMessage = postMessage({
      roomId: id,
      authorHandle,
      body: messageBody,
      kind: 'human',
      ...(parentMessageId !== undefined && { parentMessageId })
    });
    emitLegacyMessageSideEffects(id, newMessage);
    return json({ ok: true, message: newMessage }, { status: 201 });
  }

  // Forward to v4 chat-rooms route. SvelteKit's event.fetch preserves cookies
  // + origin context, so the identity gate sees the same caller it would have
  // seen on a direct POST. Headers like x-ant-admin-token / Authorization
  // pass through too.
  const forwardHeaders = new Headers();
  forwardHeaders.set('content-type', 'application/json');
  const cookie = request.headers.get('cookie');
  if (cookie) forwardHeaders.set('cookie', cookie);
  const origin = request.headers.get('origin');
  if (origin) forwardHeaders.set('origin', origin);
  const auth = request.headers.get('authorization');
  if (auth) forwardHeaders.set('authorization', auth);
  const adminToken = request.headers.get('x-ant-admin-token');
  if (adminToken) forwardHeaders.set('x-ant-admin-token', adminToken);

  const upstream = await fetch(`/api/chat-rooms/${id}/messages`, {
    method: 'POST',
    headers: forwardHeaders,
    body: JSON.stringify(translated)
  });
  const text = await upstream.text();
  // Preserve upstream status + content-type so the v3 CLI sees the same
  // success/failure shape it would on a direct v4 call.
  const responseInit: ResponseInit = {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' }
  };
  return new Response(text, responseInit);
};

export const GET: RequestHandler = ({ params, url }) => {
  const id = params.id;
  if (!id) throw error(400, 'id required.');
  if (!doesChatRoomExist(id)) {
    throw error(404, `Chat room ${id} not found (v3-compat shim).`);
  }
  const limit = parseLimit(url.searchParams.get('limit'));
  const page = listMessagesPageInRoom({ roomId: id, limit });
  return json({ messages: page.messages });
};
