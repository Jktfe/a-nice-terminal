/**
 * GET /api/me/mentions — long-poll for new mentions of the caller's
 * bound handles. Backs the Mac antchat agent-bridge + the
 * `@jktfe/mcp-server-ant` package (Pattern A canonical MCP server).
 *
 * Query string:
 *   since=<unixMs>   strict-greater-than cursor; messages whose
 *                    posted_at is > this are considered. Default 0.
 *   wait=<seconds>   how long to block waiting for new messages when
 *                    the immediate query returns empty. 0..60, default
 *                    0 (no wait — pure poll). Clamped server-side.
 *
 * Auth:
 *   resolveCallerHandleAnyRoom — browser-session cookie, antchat
 *   Bearer, or admin Bearer (the operator path used by the local MCP
 *   server reading $HOME/.ant/secrets.env). No cookie / Bearer / token
 *   → 401.
 *
 * Bound handles:
 *   1. Read `~/.ant/account/<acct>/devices/<dev>/bindings.json` if it
 *      exists. Use the `bindings[].handle` list verbatim.
 *   2. Fall back to `[callerHandle]` — Lane-A S3 hasn't shipped the
 *      bindings.json minter yet, and we want the endpoint to be useful
 *      from day one. JWPK said "stays useful pre-S3" in the M5 spec.
 *
 * Match rule:
 *   Body is scanned with MENTION_REGEX (defined below). A match wins
 *   when the captured token (case-sensitive) is in the bound-handles set.
 *
 * Wait semantics:
 *   - If matches exist after the initial query, return immediately.
 *   - Else if wait > 0, subscribe to broadcast events for every room the
 *     caller participates in and race a setTimeout(wait * 1000). First
 *     matching event wins; timeout returns mentions=[], nextCursor=since.
 *   - Else (wait === 0), return mentions=[], nextCursor=since.
 *
 * Response shape:
 *   200 { mentions: AntMention[], nextCursor: number }
 *   401 no identity resolved
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveCallerHandleAnyRoom } from '$lib/server/authGate';
import { requireAdminAuth } from '$lib/server/chatInviteAuth';
import { getOperatorHandle, isOperatorHandle } from '$lib/server/operatorHandle';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { getIdentityDb } from '$lib/server/db';
import { subscribeRoomEvents } from '$lib/server/eventBroadcast';
import { listBoundHandles } from '$lib/server/handleBindings';

const MAX_WAIT_SECONDS = 60;
// Regex aligns with the M5 spec: at-sign + leading ASCII letter +
// remaining word chars or hyphens. Case-sensitive on purpose so
// matching mirrors "James" vs "james" the way the chat UI does.
const MENTION_REGEX = /@[a-zA-Z][\w-]*/g;

type ChatMessageRow = {
  id: string;
  room_id: string;
  author_handle: string;
  body: string;
  posted_at: string;
};

export type AntMention = {
  messageId: string;
  roomId: string;
  roomName: string;
  authorHandle: string;
  body: string;
  postedAt: string;
  matchedHandle: string;
};

function clampWait(raw: string | null): number {
  if (raw === null) return 0;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  if (parsed > MAX_WAIT_SECONDS) return MAX_WAIT_SECONDS;
  return parsed;
}

function clampSince(raw: string | null): number {
  if (raw === null) return 0;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

function postedAtMs(postedAt: string): number {
  const ms = Date.parse(postedAt);
  return Number.isFinite(ms) ? ms : 0;
}

function findMatch(body: string, bound: Set<string>): string | null {
  // Case-sensitive iteration per the M5 spec. Iterate every at-token
  // in the body until one hits the bound-handle set. First-match wins
  // so a body of "(at)james cc (at)james-bot" reports the first one.
  MENTION_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MENTION_REGEX.exec(body)) !== null) {
    if (bound.has(m[0])) return m[0];
  }
  return null;
}

function listRoomIdsForCaller(callerHandle: string): string[] {
  const db = getIdentityDb();
  const handles = isOperatorHandle(callerHandle)
    ? Array.from(new Set([callerHandle, '@you', getOperatorHandle()]))
    : [callerHandle];
  const placeholders = handles.map(() => '?').join(',');
  // chat_room_members is the source of truth for "which rooms can the
  // caller see". We deliberately don't filter on chat_rooms.deleted_at_ms
  // here — the message query below references chat_rooms via roomName
  // lookup, and any deleted room's messages won't be returned because
  // the room name lookup will return null. The operator has legacy
  // @you rows and canonical @JWPK rows, so read both aliases here.
  const rows = db
    .prepare(`SELECT DISTINCT room_id FROM chat_room_members WHERE handle IN (${placeholders})`)
    .all(...handles) as { room_id: string }[];
  return rows.map((row) => row.room_id);
}

function queryMatchingMessages(input: {
  callerHandle: string;
  since: number;
  boundHandles: Set<string>;
}): AntMention[] {
  const roomIds = listRoomIdsForCaller(input.callerHandle);
  if (roomIds.length === 0) return [];
  const db = getIdentityDb();
  // Use SQLite's `?` placeholders for the roomId IN-list. Bound at
  // statement prepare time so the cache stays warm across calls.
  const placeholders = roomIds.map(() => '?').join(',');
  const stmt = db.prepare(
    `SELECT id, room_id, author_handle, body, posted_at
     FROM chat_messages
     WHERE room_id IN (${placeholders})
       AND kind IN ('human','agent')
     ORDER BY post_order ASC`
  );
  const rows = stmt.all(...roomIds) as ChatMessageRow[];
  const out: AntMention[] = [];
  for (const row of rows) {
    if (postedAtMs(row.posted_at) <= input.since) continue;
    const matched = findMatch(row.body, input.boundHandles);
    if (matched === null) continue;
    const room = findChatRoomById(row.room_id);
    if (!room) continue;
    out.push({
      messageId: row.id,
      roomId: row.room_id,
      roomName: room.name,
      authorHandle: row.author_handle,
      body: row.body,
      postedAt: row.posted_at,
      matchedHandle: matched
    });
  }
  return out;
}

function nextCursorOf(mentions: AntMention[], fallback: number): number {
  let max = fallback;
  for (const m of mentions) {
    const ms = postedAtMs(m.postedAt);
    if (ms > max) max = ms;
  }
  return max;
}

/**
 * Wait at most `waitMs` milliseconds for a broadcast `message_added`
 * event in any of `roomIds` whose body mentions a bound handle.
 *
 * Returns the matching event (or null on timeout). Designed to be
 * idle when nobody's broadcasting — no polling, no timers beyond the
 * single setTimeout race.
 */
function waitForNextMention(input: {
  roomIds: string[];
  boundHandles: Set<string>;
  waitMs: number;
  since: number;
}): Promise<AntMention | null> {
  return new Promise((resolve) => {
    if (input.roomIds.length === 0 || input.waitMs <= 0) {
      resolve(null);
      return;
    }
    const unsubscribers: Array<() => void> = [];
    let settled = false;
    const cleanup = () => {
      for (const u of unsubscribers) {
        try {
          u();
        } catch {
          // best-effort
        }
      }
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(null);
    }, input.waitMs);
    const finish = (m: AntMention | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      resolve(m);
    };
    for (const roomId of input.roomIds) {
      const unsubscribe = subscribeRoomEvents(roomId, (event) => {
        if (settled) return;
        if (event.type !== 'message_added') return;
        const msg = event.message as Record<string, unknown> | undefined;
        if (!msg) return;
        const body = typeof msg.body === 'string' ? msg.body : '';
        const postedAt = typeof msg.postedAt === 'string' ? msg.postedAt : '';
        if (postedAtMs(postedAt) <= input.since) return;
        const matched = findMatch(body, input.boundHandles);
        if (matched === null) return;
        const room = findChatRoomById(roomId);
        const messageId = typeof msg.id === 'string' ? msg.id : '';
        const authorHandle = typeof msg.authorHandle === 'string' ? msg.authorHandle : '';
        finish({
          messageId,
          roomId,
          roomName: room?.name ?? '',
          authorHandle,
          body,
          postedAt,
          matchedHandle: matched
        });
      });
      unsubscribers.push(unsubscribe);
    }
  });
}

export const GET: RequestHandler = async ({ url, request }) => {
  // Identity-gate: cookie/antchat-Bearer first (the user-facing path),
  // then admin-bearer (the operator path the local MCP server uses
  // when reading $HOME/.ant/secrets.env). Mirrors the auth shape on
  // /api/plans/[planId]/rooms so callers don't have to learn a new
  // ceremony per endpoint.
  let callerHandle = resolveCallerHandleAnyRoom(request);
  if (!callerHandle) {
    try {
      requireAdminAuth(request);
      // Admin-bearer is the operator on the local machine. The
      // operator running the MCP server IS the box owner; mapping
      // admin-bearer to the structural operator matches the convention used by terminal
      // sub-routes (see resolveTerminalCallerHandle).
      callerHandle = getOperatorHandle();
    } catch {
      throw error(401, 'browser-session, antchat Bearer, or admin-bearer required');
    }
  }

  const sinceMs = clampSince(url.searchParams.get('since'));
  const waitSeconds = clampWait(url.searchParams.get('wait'));

  const bindingsHandles = listBoundHandles();
  // Fallback path documented in spec: pre-S3 the bindings.json file
  // probably doesn't exist yet, so use the resolved caller handle as
  // the only bound handle. Endpoint stays functional from day one.
  const boundList = bindingsHandles ?? [callerHandle];
  const boundHandles = new Set(boundList);
  if (boundHandles.size === 0) {
    return json({ mentions: [], nextCursor: sinceMs });
  }

  const immediate = queryMatchingMessages({
    callerHandle,
    since: sinceMs,
    boundHandles
  });
  if (immediate.length > 0) {
    return json({ mentions: immediate, nextCursor: nextCursorOf(immediate, sinceMs) });
  }

  if (waitSeconds <= 0) {
    return json({ mentions: [], nextCursor: sinceMs });
  }

  const roomIds = listRoomIdsForCaller(callerHandle);
  const matched = await waitForNextMention({
    roomIds,
    boundHandles,
    waitMs: waitSeconds * 1000,
    since: sinceMs
  });
  if (!matched) {
    return json({ mentions: [], nextCursor: sinceMs });
  }
  return json({
    mentions: [matched],
    nextCursor: Math.max(sinceMs, postedAtMs(matched.postedAt))
  });
};
