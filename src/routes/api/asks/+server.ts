/**
 * Asks — open + list, room-scoped or cross-room.
 *
 *   GET /api/asks[?roomId=...]
 *     → 200 { asks: Ask[] }   open asks only, open-order
 *     → 404                   unknown roomId when provided
 *
 *   POST /api/asks
 *     Body: { roomId, openedByHandle, title, body, openedByDisplayName? }
 *     → 201 { ask }   the new ask (status=open)
 *     → 400           missing/blank fields, malformed JSON
 *     → 404           unknown room, or openedByHandle is not a member
 *
 * Backs asks foundation slice 1 backend.
 *
 * Security: membership-before-validation matches the rest of the platform
 * (M16/M11/M19/M24/M17). Load the room, normalise the handle, reject
 * non-members with 404, THEN validate other body fields. No-create
 * guarantee: every failed POST path returns early before askStore.openAsk
 * is invoked, so a subsequent GET /api/asks shows zero state change.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findChatRoomById, listChatRooms } from '$lib/server/chatRoomStore';
import {
  listAllRecentlyAnsweredAsks,
  listAllOpenAsks,
  listRecentlyAnsweredAsksInRoom,
  listOpenAsksInRoom,
  openAskInRoom
} from '$lib/server/askStore';
import {
  backfillAskCandidatesFromRecentMessages,
  listOpenAskCandidates
} from '$lib/server/askCandidateStore';
import {
  resolveChatRoomReadAccess,
  canReadChatRoom,
  requireChatRoomReadAccess
} from '$lib/server/chatRoomReadGate';
import { listInboxOwnersWhereHandleIsMember } from '$lib/server/humanInboxRoomStore';
import { lookupTerminalByPidChain } from '$lib/server/terminalsStore';
import { deriveHandle, getTerminalRecord } from '$lib/server/terminalRecordsStore';
import { getIdentityDb } from '$lib/server/db';

/**
 * Per-human inbox pidChain auth (JWPK 2026-05-22): the no-roomId branch
 * needs a way for CLI callers (pidChain) to authenticate without an
 * upfront room context. Resolve the caller's terminal → their handle →
 * the inbox rooms they're a member of → the set of askees they have
 * permission to see. Returns null when the caller has no inbox edges
 * (== no shared context with any human == no business reading asks).
 */
function resolvePidChainInboxScope(request: Request): { handles: string[]; inboxOwners: string[] } | null {
  try {
    const raw = new URL(request.url).searchParams.get('pidChain');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const chain = parsed
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const pid = (entry as { pid?: unknown }).pid;
        if (typeof pid !== 'number' || !Number.isFinite(pid) || pid <= 0) return null;
        const pidStart = (entry as { pid_start?: unknown }).pid_start;
        return { pid: Math.floor(pid), pid_start: typeof pidStart === 'string' ? pidStart : null };
      })
      .filter((entry): entry is { pid: number; pid_start: string | null } => entry !== null);
    if (chain.length === 0) return null;
    const terminal = lookupTerminalByPidChain(chain);
    if (!terminal) return null;
    // Try terminal_records first (canonical agent identity). When absent
    // (e.g. agents that registered via room_memberships only — like the
    // dogfood @claudev4 with no terminal_records row), fall back to ANY
    // room_memberships row for this terminal — that handle is what the
    // messages-post path already trusts via resolveServerSideHandle's
    // getRoomScopedHandle.
    const record = getTerminalRecord(terminal.id);
    let handle: string | null = record ? deriveHandle(record) : null;
    if (!handle) {
      const fallback = getIdentityDb().prepare(
        `SELECT handle FROM room_memberships
         WHERE terminal_id = ? AND revoked_at_ms IS NULL
         LIMIT 1`
      ).get(terminal.id) as { handle: string } | undefined;
      handle = fallback?.handle ?? null;
    }
    if (!handle) return null;
    const inboxOwners = listInboxOwnersWhereHandleIsMember(handle);
    if (inboxOwners.length === 0) return null;
    return { handles: [handle], inboxOwners };
  } catch {
    return null;
  }
}

export const GET: RequestHandler = async ({ request, url }) => {
  try {
    backfillAskCandidatesFromRecentMessages();
  } catch {
    /* candidate backfill is best-effort; explicit asks remain authoritative */
  }
  const rawRoomId = url.searchParams.get('roomId');
  const trimmedRoomId = rawRoomId === null ? null : rawRoomId.trim();
  // No roomId or empty roomId → list-all-readable mode. Auth FIRST, then load rooms.
  // Previous shape paid `listChatRooms()` (1 SQL + N member-loads) before auth check,
  // turning every 401 into a multi-second hang. Now no-auth fast-path returns ~10ms.
  if (trimmedRoomId === null || trimmedRoomId.length === 0) {
    const access = await resolveChatRoomReadAccess(request);
    // Per-human inbox path (JWPK 2026-05-22): when the regular gate fails,
    // try resolving via pidChain → terminal → inbox memberships. This is
    // the CLI auth path that was 401ing pre-2026-05-22 because pidChain
    // alone required a roomId.
    const inboxScope = access ? null : resolvePidChainInboxScope(request);
    if (!access && !inboxScope) throw error(401, 'Authentication required.');

    if (inboxScope) {
      // Inbox-scoped read: response is asks whose target_handle the caller
      // has inbox access to. Cross-room aggregation by definition.
      const ownersSet = new Set(inboxScope.inboxOwners);
      const matchesByTarget = (ask: { targetHandle?: string }) =>
        ask.targetHandle !== undefined && ownersSet.has(ask.targetHandle);
      return json({
        asks: listAllOpenAsks().filter(matchesByTarget),
        recentlyAnswered: listAllRecentlyAnsweredAsks().filter(matchesByTarget),
        candidates: []
      });
    }

    // Existing room-scoped read (admin-bearer / cookie / accounts-bearer).
    const rooms = listChatRooms();
    const readableRoomIds = new Set(
      (access!.isAdminBearer ? rooms : rooms.filter((room) => canReadChatRoom(room, access!))).map(
        (room) => room.id
      )
    );
    return json({
      asks: listAllOpenAsks().filter((ask) => readableRoomIds.has(ask.roomId)),
      recentlyAnswered: listAllRecentlyAnsweredAsks().filter((ask) =>
        readableRoomIds.has(ask.roomId)
      ),
      candidates: listOpenAskCandidates().filter((candidate) =>
        readableRoomIds.has(candidate.roomId)
      )
    });
  }
  const room = findChatRoomById(trimmedRoomId);
  if (!room) {
    throw error(404, 'Room not found.');
  }
  await requireChatRoomReadAccess(request, room);
  const openOnly = url.searchParams.get('openOnly') === '1';
  if (openOnly) {
    return json({ asks: listOpenAsksInRoom(trimmedRoomId) });
  }
  return json({
    asks: listOpenAsksInRoom(trimmedRoomId),
    recentlyAnswered: listRecentlyAnsweredAsksInRoom(trimmedRoomId),
    candidates: listOpenAskCandidates(trimmedRoomId)
  });
};

export const POST: RequestHandler = async ({ request }) => {
  const bodyAsObject = await parseRequiredJsonBody(request);

  const roomIdRaw = bodyAsObject.roomId;
  if (typeof roomIdRaw !== 'string' || roomIdRaw.trim().length === 0) {
    throw error(400, 'roomId must be a non-empty string.');
  }
  const room = findChatRoomById(roomIdRaw.trim());
  if (!room) {
    throw error(404, 'Room not found.');
  }

  const openedByHandleRaw = bodyAsObject.openedByHandle;
  if (typeof openedByHandleRaw !== 'string' || openedByHandleRaw.trim().length === 0) {
    throw error(400, 'openedByHandle must be a non-empty string.');
  }
  const trimmedHandle = openedByHandleRaw.trim();
  const handleWithAtSign = trimmedHandle.startsWith('@')
    ? trimmedHandle
    : `@${trimmedHandle}`;
  // Asks principle (JWPK msg_86qcfvbkur 2026-05-19, locked in
  // audits/2026-05-19-asks-principle-user-only.md): Open Asks are
  // user-facing decision points only. Agent-pattern handles cannot file
  // asks via this surface — they must use POST /api/tasks for internal
  // tracking. Legitimate aggregator paths ([@you] mentions + 🙋🙌
  // reactions) go through askCandidateStore, not this endpoint.
  if (isAgentHandle(handleWithAtSign)) {
    throw error(
      400,
      'Agent handles cannot open user-facing asks. Use POST /api/tasks for agent-internal tracking. (Asks principle, audits/2026-05-19-asks-principle-user-only.md.)'
    );
  }
  const isMemberOfRoom = room.members.some((member) => member.handle === handleWithAtSign);
  if (!isMemberOfRoom) {
    throw error(404, `${handleWithAtSign} is not a member of this room.`);
  }

  const titleRaw = bodyAsObject.title;
  if (typeof titleRaw !== 'string' || titleRaw.trim().length === 0) {
    throw error(400, 'title must be a non-empty string.');
  }
  const bodyTextRaw = bodyAsObject.body;
  if (typeof bodyTextRaw !== 'string' || bodyTextRaw.trim().length === 0) {
    throw error(400, 'body must be a non-empty string.');
  }
  const openedByDisplayNameRaw = bodyAsObject.openedByDisplayName;
  const openedByDisplayName =
    typeof openedByDisplayNameRaw === 'string' ? openedByDisplayNameRaw : undefined;
  const targetHandleRaw = bodyAsObject.targetHandle;
  const targetHandle = typeof targetHandleRaw === 'string' ? targetHandleRaw : undefined;

  try {
    const ask = openAskInRoom({
      roomId: room.id,
      openedByHandle: handleWithAtSign,
      openedByDisplayName,
      targetHandle,
      title: titleRaw,
      body: bodyTextRaw
    });
    return json({ ask }, { status: 201 });
  } catch (causeOfFailure) {
    const failureMessage =
      causeOfFailure instanceof Error ? causeOfFailure.message : 'Could not open ask.';
    throw error(400, failureMessage);
  }
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Agent handles use the @evolveant* prefix (Claude, Codex, Svelte, UX,
 * and future fleet members). The asks-principle audit
 * (audits/2026-05-19-asks-principle-user-only.md) reserves user-facing
 * asks for human operators; agents must use POST /api/tasks for
 * internal tracking. Configurable via ANT_ASK_AGENT_PATTERN env if a
 * deployment wants a different convention.
 */
function isAgentHandle(handle: string): boolean {
  const pattern = process.env.ANT_ASK_AGENT_PATTERN ?? '^@evolveant';
  try {
    return new RegExp(pattern).test(handle);
  } catch {
    // Bad regex env → fall back to the default check, never silently allow.
    return /^@evolveant/.test(handle);
  }
}

async function parseRequiredJsonBody(request: Request): Promise<Record<string, unknown>> {
  const requestBodyText = await request.text();
  if (requestBodyText.length === 0) {
    throw error(400, 'Body must be a JSON object.');
  }
  try {
    const parsed = JSON.parse(requestBodyText);
    if (!isPlainObject(parsed)) {
      throw error(400, 'Body must be a JSON object.');
    }
    return parsed;
  } catch (parseFailure) {
    if (parseFailure instanceof SyntaxError) {
      throw error(400, 'Body must be valid JSON.');
    }
    throw parseFailure;
  }
}
