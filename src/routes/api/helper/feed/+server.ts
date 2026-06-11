/**
 * GET /api/helper/feed?since=<postOrder>[&wait=<0..25s>] — the helper's
 * delivery feed, authorised by a live attachment (x-ant-attachment header).
 *
 * THE DOORBELL LAW: metadata only — room id, message id, post order, sender
 * handle, and a server-computed mentionsYou boolean. Message BODIES never
 * cross this endpoint; the woken AI fetches content itself through its own
 * witnessed credential. Compromise this stream and all you can do is ring a
 * bell.
 *
 * Scope: rooms where the attachment's handle is a member (clean
 * room_membership), messages newer than `since`, the handle's own posts
 * excluded. `wait` long-polls up to 25s so the daemon holds one cheap
 * request instead of hammering — events arrive within a second of the post.
 * Every call touches the lease (the paired-apps "last used" heartbeat).
 */
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getIdentityDb } from '$lib/server/db';
import { resolveLeaseBySecret, touchLease } from '$lib/server/helperLeaseStore';
import { listRoomsForHandle } from '$lib/server/membershipStore';

type FeedEvent = {
  roomId: string;
  messageId: string;
  postOrder: number;
  senderHandle: string;
  mentionsYou: boolean;
};

function readEvents(handle: string, since: number): { events: FeedEvent[]; cursor: number } {
  const rooms = listRoomsForHandle(handle);
  if (rooms.length === 0) return { events: [], cursor: since };
  const db = getIdentityDb();
  const placeholders = rooms.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT id, room_id, post_order, author_handle, body FROM chat_messages
        WHERE room_id IN (${placeholders}) AND post_order > ?
          AND deleted_at_ms IS NULL AND author_handle != ?
        ORDER BY post_order ASC LIMIT 200`
    )
    .all(...rooms, since, handle) as {
    id: string; room_id: string; post_order: number; author_handle: string; body: string;
  }[];
  const needle = handle.toLowerCase();
  const events = rows.map((row) => ({
    roomId: row.room_id,
    messageId: row.id,
    postOrder: row.post_order,
    senderHandle: row.author_handle,
    // mention check happens HERE so only the boolean crosses, never the body
    mentionsYou: (row.body ?? '').toLowerCase().includes(needle)
  }));
  const cursor = rows.length > 0 ? rows[rows.length - 1].post_order : since;
  return { events, cursor };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const GET: RequestHandler = async ({ request, url }) => {
  const secret = request.headers.get('x-ant-attachment') ?? '';
  const lease = secret.trim().length > 0 ? resolveLeaseBySecret(secret.trim()) : null;
  if (!lease) throw error(401, 'a live attachment is required (x-ant-attachment).');
  try { touchLease(lease.id); } catch { /* heartbeat is best-effort */ }

  const sinceRaw = Number(url.searchParams.get('since') ?? '0');
  const since = Number.isFinite(sinceRaw) && sinceRaw >= 0 ? sinceRaw : 0;
  const waitRaw = Number(url.searchParams.get('wait') ?? '0');
  const waitMs = Math.min(Math.max(Number.isFinite(waitRaw) ? waitRaw : 0, 0), 25) * 1000;

  let result = readEvents(lease.handle, since);
  const deadline = Date.now() + waitMs;
  while (result.events.length === 0 && Date.now() < deadline) {
    await sleep(1000);
    result = readEvents(lease.handle, since);
  }
  return json({ handle: lease.handle, ...result });
};
