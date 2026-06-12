/**
 * GET /api/helper/message/[messageId]?scope=<direct|everyone|untagged>
 *   — the COURIER body path (v0.1.7). SEPARATE from the doorbell feed: this is
 * the ONLY helper endpoint that returns a message BODY, and it re-checks the
 * lease, membership, and SCOPE on every call.
 *
 * THE DOORBELL LAW, COURIER COROLLARY: a body crosses only when (a) a live
 * attachment presents its secret, (b) the attachment's handle is a clean member
 * of the message's room, and (c) the message falls within the caller's
 * requested scope. Scope is computed HERE, server-side — the client cannot
 * widen it. Out-of-scope → 204 No Content (no body), never the text.
 *
 *   direct   = the message mentions the handle (@handle substring).
 *   everyone = direct OR a bare @everyone broadcast.
 *   untagged = any message in a room the handle is a member of.
 * Each scope is a SUPERSET of the previous; the caller's scope is a ceiling.
 */
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getIdentityDb } from '$lib/server/db';
import { resolveLeaseBySecret, touchLease } from '$lib/server/helperLeaseStore';
import { listRoomsForHandle } from '$lib/server/membershipStore';

type CourierScope = 'direct' | 'everyone' | 'untagged';
const SCOPES: readonly CourierScope[] = ['direct', 'everyone', 'untagged'];

function parseScope(raw: string | null): CourierScope {
  return SCOPES.includes(raw as CourierScope) ? (raw as CourierScope) : 'direct';
}

/** A bare @everyone broadcast — word-boundary so @everyoneelse doesn't match. */
function hasBareEveryone(body: string): boolean {
  return /(^|[^\w@])@everyone\b/i.test(body);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A TOKEN mention of `handle` — word-boundary, NOT a substring. Mirrors
 * hasBareEveryone so @bee does not match @beekeeper. This is the leak guard:
 * substring matching here would courier a body intended for a longer handle.
 */
function mentions(body: string, handle: string): boolean {
  const h = handle.replace(/^@/, '');
  if (h.length === 0) return false;
  return new RegExp(`(^|[^\\w@])@${escapeRe(h)}\\b`, 'i').test(body);
}

/** Does `body` fall within `scope` for `handle`? superset ladder. */
function inScope(body: string, handle: string, scope: CourierScope): boolean {
  if (scope === 'untagged') return true;
  const mentionsYou = mentions(body, handle);
  if (scope === 'everyone') return mentionsYou || hasBareEveryone(body);
  return mentionsYou; // 'direct'
}

export const GET: RequestHandler = async ({ params, request, url }) => {
  const secret = request.headers.get('x-ant-attachment') ?? '';
  const lease = secret.trim().length > 0 ? resolveLeaseBySecret(secret.trim()) : null;
  if (!lease) throw error(401, 'a live attachment is required (x-ant-attachment).');
  try { touchLease(lease.id); } catch { /* heartbeat best-effort */ }

  const scope = parseScope(url.searchParams.get('scope'));
  const db = getIdentityDb();
  const row = db
    .prepare(
      `SELECT id, room_id, author_handle, author_display_name, body, post_order, posted_at
         FROM chat_messages
        WHERE id = ? AND deleted_at_ms IS NULL`
    )
    .get(params.messageId) as
    | { id: string; room_id: string; author_handle: string; author_display_name: string | null;
        body: string; post_order: number; posted_at: string | number } | undefined;

  // Absent / deleted / not-a-member → 404. Never disclose existence outside the
  // handle's rooms; never return a deleted body.
  if (!row) throw error(404, 'message not found');
  const rooms = new Set(listRoomsForHandle(lease.handle));
  if (!rooms.has(row.room_id)) throw error(404, 'message not found');
  if (row.author_handle === lease.handle) throw error(404, 'message not found'); // own post, never couriered

  // SCOPE GATE: the message must fall within the caller's requested scope.
  // Out-of-scope → 204, body withheld (the leak cannot happen here).
  if (!inScope(row.body ?? '', lease.handle, scope)) {
    return new Response(null, { status: 204 });
  }

  return json({
    messageId: row.id,
    roomId: row.room_id,
    senderHandle: row.author_handle,
    senderName: row.author_display_name ?? row.author_handle,
    body: row.body ?? '',
    postOrder: row.post_order,
    postedAt: row.posted_at
  });
};
