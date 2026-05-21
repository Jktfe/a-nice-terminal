/**
 * M3.3a linkedchat route.
 *
 * Terminal-scoped permission rows are private to the terminal owner or a room
 * creator for a room containing that terminal. GET/list therefore takes the
 * same pidChain proof as PUT writes; there is no public read by terminal id.
 */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { parsePidChainFromBody, resolveServerSideHandle, type PidChainEntry } from '$lib/server/identityGate';
import {
  isLinkedChatPermissionState,
  listLinkedChatPermissions,
  setLinkedChatPermission
} from '$lib/server/linkedChatPermissionStore';
import { listMembershipsForTerminal } from '$lib/server/roomMembershipsStore';
import { getTerminalById } from '$lib/server/terminalsStore';

type AdminResolution = {
  handle: string;
};

function requireTerminal(terminalId: string): void {
  if (!getTerminalById(terminalId)) throw error(404, 'Terminal not found.');
}

function parsePidChainFromQuery(url: URL): PidChainEntry[] {
  const raw = url.searchParams.get('pidChain');
  if (!raw) return [];
  try {
    return parsePidChainFromBody({ pidChain: JSON.parse(raw) });
  } catch {
    return [];
  }
}

function resolveLinkedChatAdmin(terminalId: string, pidChain: PidChainEntry[]): AdminResolution | null {
  if (pidChain.length === 0) return null;
  for (const membership of listMembershipsForTerminal(terminalId)) {
    const resolvedHandle = resolveServerSideHandle(membership.room_id, pidChain);
    if (!resolvedHandle) continue;
    if (resolvedHandle === membership.handle) return { handle: resolvedHandle };
    if (findChatRoomById(membership.room_id)?.whoCreatedIt === resolvedHandle) {
      return { handle: resolvedHandle };
    }
  }
  return null;
}

function requireLinkedChatAdmin(terminalId: string, pidChain: PidChainEntry[]): AdminResolution {
  const admin = resolveLinkedChatAdmin(terminalId, pidChain);
  if (!admin) throw error(403, 'Caller cannot administer linkedchat permissions for this terminal.');
  return admin;
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const raw = await request.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw error(400, 'Send a JSON body.');
  return raw as Record<string, unknown>;
}

export const GET: RequestHandler = async ({ params, url }) => {
  requireTerminal(params.terminalId);
  requireLinkedChatAdmin(params.terminalId, parsePidChainFromQuery(url));
  return json({
    terminal_id: params.terminalId,
    permissions: listLinkedChatPermissions(params.terminalId)
  });
};

export const PUT: RequestHandler = async ({ params, request }) => {
  requireTerminal(params.terminalId);
  const rawBody = await readJsonBody(request);
  const admin = requireLinkedChatAdmin(params.terminalId, parsePidChainFromBody(rawBody));
  const subjectHandle = rawBody.subjectHandle;
  if (typeof subjectHandle !== 'string' || subjectHandle.trim().length === 0) {
    throw error(400, 'subjectHandle is required.');
  }
  if (!isLinkedChatPermissionState(rawBody.state)) throw error(400, 'state must be allow or deny.');

  const permission = setLinkedChatPermission({
    terminalId: params.terminalId,
    subjectHandle,
    state: rawBody.state,
    setBy: admin.handle,
    reason: typeof rawBody.reason === 'string' ? rawBody.reason : null
  });
  if (!permission) throw error(400, 'Could not write linkedchat permission.');
  return json({ permission });
};
