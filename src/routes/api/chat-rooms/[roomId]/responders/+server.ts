/**
 * Per-room responder list endpoints per the responders design contract
 * 2026-05-13 (M3.b.5).
 *
 * GET    → list responders with handle + pane_status joined.
 * PUT    → replace-all by handle array (sparse-integer 1000/2000/...).
 * POST   → insert single handle, optionally at position N.
 * PATCH  → move existing handle to position N.
 * DELETE → remove handle by JSON body (handle + pidChain).
 *
 * All writes go through IDENTITY-GATE (strict 403, no transition fallback)
 * via parsePidChainFromBody + resolveServerSideHandle.
 *
 * Resolves caller-supplied handles to terminal_ids at write-time via the
 * existing getTerminalIdByHandle helper (room-scoped). Returns the joined
 * list in every successful response so callers can refresh UI cheaply.
 */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { doesChatRoomExist } from '$lib/server/chatRoomStore';
import { parsePidChainFromBody, resolveServerSideHandle } from '$lib/server/identityGate';
import { getTerminalIdByHandle } from '$lib/server/roomMembershipsStore';
import { getTerminalById } from '$lib/server/terminalsStore';
import { listMembershipsForRoom } from '$lib/server/roomMembershipsStore';
import {
  listRespondersForRoom,
  setResponders,
  addResponder,
  removeResponder,
  moveResponder,
  type ResponderRow
} from '$lib/server/roomRespondersStore';

type EnrichedResponder = ResponderRow & {
  handle: string;
  pane_status: 'unknown' | 'verified' | 'stale';
};

function enrich(roomId: string): EnrichedResponder[] {
  const rows = listRespondersForRoom(roomId);
  const memberships = listMembershipsForRoom(roomId);
  const handleByTerminal = new Map(memberships.map((m) => [m.terminal_id, m.handle]));
  return rows.map((row) => {
    const terminal = getTerminalById(row.terminal_id);
    return {
      ...row,
      handle: handleByTerminal.get(row.terminal_id) ?? '',
      pane_status: terminal?.pane_status ?? 'unknown'
    };
  });
}

async function requireMemberHandle(
  roomId: string,
  rawBody: unknown
): Promise<string> {
  const pidChain = parsePidChainFromBody(rawBody);
  if (pidChain.length === 0) throw error(400, 'pidChain is required for responder writes.');
  const handle = resolveServerSideHandle(roomId, pidChain);
  if (!handle) throw error(403, 'Caller is not a registered member of this room.');
  return handle;
}

function resolveHandleToTerminal(roomId: string, handle: string): string {
  const terminalId = getTerminalIdByHandle(roomId, handle);
  if (!terminalId) throw error(400, `handle ${handle} is not a registered member of this room.`);
  return terminalId;
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const raw = await request.json().catch(() => null);
  if (!raw || typeof raw !== 'object') throw error(400, 'Send a JSON body.');
  return raw as Record<string, unknown>;
}

export const GET: RequestHandler = async ({ params }) => {
  if (!doesChatRoomExist(params.roomId)) throw error(404, 'Room not found.');
  return json({ roomId: params.roomId, responders: enrich(params.roomId) });
};

export const PUT: RequestHandler = async ({ params, request }) => {
  if (!doesChatRoomExist(params.roomId)) throw error(404, 'Room not found.');
  const rawBody = await readJsonBody(request);
  const setBy = await requireMemberHandle(params.roomId, rawBody);
  const handles = rawBody.handles;
  if (!Array.isArray(handles)) throw error(400, 'handles must be an array.');
  if (handles.some((h) => typeof h !== 'string')) throw error(400, 'each handle must be a string.');
  const stringHandles = handles as string[];
  if (new Set(stringHandles).size !== stringHandles.length) throw error(400, 'handles must be unique.');
  const terminalIds = stringHandles.map((h) => resolveHandleToTerminal(params.roomId, h));
  setResponders({ roomId: params.roomId, terminalIds, set_by: setBy });
  return json({ roomId: params.roomId, responders: enrich(params.roomId) });
};

export const POST: RequestHandler = async ({ params, request }) => {
  if (!doesChatRoomExist(params.roomId)) throw error(404, 'Room not found.');
  const rawBody = await readJsonBody(request);
  const setBy = await requireMemberHandle(params.roomId, rawBody);
  const handle = rawBody.handle;
  if (typeof handle !== 'string') throw error(400, 'handle is required.');
  const terminalId = resolveHandleToTerminal(params.roomId, handle);
  const at = typeof rawBody.at === 'number' ? Math.floor(rawBody.at) : undefined;
  try {
    addResponder({ roomId: params.roomId, terminalId, at, set_by: setBy });
  } catch {
    throw error(400, `${handle} is already a responder.`);
  }
  return json({ roomId: params.roomId, responders: enrich(params.roomId) });
};

export const PATCH: RequestHandler = async ({ params, request }) => {
  if (!doesChatRoomExist(params.roomId)) throw error(404, 'Room not found.');
  const rawBody = await readJsonBody(request);
  const setBy = await requireMemberHandle(params.roomId, rawBody);
  const handle = rawBody.handle;
  const to = rawBody.to;
  if (typeof handle !== 'string') throw error(400, 'handle is required.');
  if (typeof to !== 'number') throw error(400, 'to (number) is required.');
  const terminalId = resolveHandleToTerminal(params.roomId, handle);
  if (!listRespondersForRoom(params.roomId).some((r) => r.terminal_id === terminalId)) {
    throw error(404, `${handle} is not currently in the responder list.`);
  }
  moveResponder({ roomId: params.roomId, terminalId, to: Math.floor(to), set_by: setBy });
  return json({ roomId: params.roomId, responders: enrich(params.roomId) });
};

export const DELETE: RequestHandler = async ({ params, request }) => {
  if (!doesChatRoomExist(params.roomId)) throw error(404, 'Room not found.');
  const rawBody = await readJsonBody(request);
  await requireMemberHandle(params.roomId, rawBody);
  const handle = rawBody.handle;
  if (typeof handle !== 'string') throw error(400, 'handle is required.');
  const terminalId = resolveHandleToTerminal(params.roomId, handle);
  const removed = removeResponder(params.roomId, terminalId);
  if (!removed) throw error(404, `${handle} is not currently in the responder list.`);
  return json({ roomId: params.roomId, responders: enrich(params.roomId) });
};
