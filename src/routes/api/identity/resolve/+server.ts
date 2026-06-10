/**
 * POST /api/identity/resolve — resolve a caller's PID chain to a terminal.
 *
 * Body: { pids: [{pid, pid_start}], room_id? }
 *
 * Returns:
 *   { terminal_id, name, agent_kind, handle?,
 *     v02_agent_id?, v02_runtime_id? }
 * handle is only populated if room_id was supplied AND a membership exists
 * for (room_id, terminal_id). Otherwise the response contains terminal
 * identity only and the caller is anonymous-with-warning in chat.
 *
 * Chain walk on the server picks the MOST RECENT match across the chain.
 * The leaf PID typically matches first; ancestor matches are the fallback
 * (e.g. the CLI's parent shell is registered but the CLI process itself is
 * not directly mapped).
 *
 * The old v0.2 runtime sidecar is no longer consulted in production. Resolve
 * returns null v0.2 fields for compatibility while terminal/session/membership
 * stores remain the authority.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { lookupTerminalByPidChain, type PidChainEntry } from '$lib/server/terminalsStore';
import { getRoomScopedHandle } from '$lib/server/roomMembershipsStore';
import { getSession } from '$lib/server/antSessionStore';
import { resolveHandleForSession } from '$lib/server/membershipStore';
import { displayHandleForSession } from '$lib/server/roomHandleLeaseClean';

type IdentityResolveBody = {
  pids?: unknown;
  room_id?: unknown;
  sessionId?: unknown;
  session_id?: unknown;
  antSessionId?: unknown;
};

function parsePidChain(rawPids: unknown): PidChainEntry[] {
  if (!Array.isArray(rawPids) || rawPids.length === 0) {
    throw error(400, 'pids must be a non-empty array.');
  }
  return rawPids.map((entry, idx) => {
    if (!entry || typeof entry !== 'object') {
      throw error(400, `pids[${idx}] must be an object.`);
    }
    const pidRaw = (entry as { pid?: unknown }).pid;
    const pidStartRaw = (entry as { pid_start?: unknown }).pid_start;
    const pidNumber = Number(pidRaw);
    if (!Number.isFinite(pidNumber) || pidNumber <= 0) {
      throw error(400, `pids[${idx}].pid must be a positive number.`);
    }
    const pidStart = typeof pidStartRaw === 'string' ? pidStartRaw : null;
    return { pid: pidNumber, pid_start: pidStart };
  });
}

export const POST: RequestHandler = async ({ request }) => {
  const rawBody = (await request.json().catch(() => null)) as IdentityResolveBody | null;
  if (!rawBody || typeof rawBody !== 'object') {
    throw error(400, 'Send a JSON body with pids.');
  }

  const pidChain = parsePidChain(rawBody.pids);
  const terminal = lookupTerminalByPidChain(pidChain);

  if (!terminal) {
    return json({
      terminal_id: null, name: null, agent_kind: null, handle: null,
      v02_agent_id: null,
      v02_runtime_id: null
    });
  }

  const roomIdRaw = rawBody.room_id;
  const roomId = typeof roomIdRaw === 'string' && roomIdRaw.length > 0 ? roomIdRaw : null;
  const sessionId = extractSessionId(request, rawBody);
  let handle: string | null = null;
  if (roomId && sessionId) {
    const session = getSession(sessionId);
    const sessionBelongsToTerminal =
      session !== null &&
      (session.terminal_id === null || session.terminal_id === terminal.id);
    if (sessionBelongsToTerminal) {
      handle =
        displayHandleForSession(roomId, session.id) ??
        resolveHandleForSession(roomId, session.id);
    }
  }
  if (!handle && roomId) {
    handle = getRoomScopedHandle(roomId, terminal.id);
  }

  return json({
    terminal_id: terminal.id,
    name: terminal.name,
    agent_kind: terminal.agent_kind,
    handle,
    v02_agent_id: null,
    v02_runtime_id: null
  });
};

function extractSessionId(request: Request, body: IdentityResolveBody): string | null {
  const fromHeader = request.headers.get('x-ant-session-id')?.trim();
  if (fromHeader) return fromHeader;
  const bodySessionId = body.sessionId ?? body.session_id ?? body.antSessionId;
  if (typeof bodySessionId !== 'string') return null;
  const trimmed = bodySessionId.trim();
  return trimmed.length > 0 ? trimmed : null;
}
