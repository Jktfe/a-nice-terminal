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
 * v0.2 CUT-OVER PHASE 1 (M9b, 2026-05-30): resolve now ALSO consults the
 * v0.2 v02_runtimes table (status='live' filter — regression case #2 in
 * scripts/v0.2-regression.test.ts: shadow runtimes do NOT resolve).
 * Legacy lookup remains authoritative for terminal_id + name + handle
 * because membership lookup hasn't flipped yet (M9c). The v0.2 fields
 * surface alongside so v0.2-aware clients can adopt incrementally. See
 * docs/concepts/ant-v02-cutover-plan.md §2.1.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { lookupTerminalByPidChain, type PidChainEntry } from '$lib/server/terminalsStore';
import { getRoomScopedHandle } from '$lib/server/roomMembershipsStore';
import { resolveV02ByPidChain } from '$lib/server/v02RegisterBootstrap';
import { getRuntimeById } from '$lib/server/v02RuntimesStore';
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

function v02RuntimeBelongsToTerminal(runtimeId: string, terminalId: string): boolean {
  const runtime = getRuntimeById(runtimeId);
  return runtime?.register_challenge_proof === `pre-v02-attestation:${terminalId}`;
}

export const POST: RequestHandler = async ({ request }) => {
  const rawBody = (await request.json().catch(() => null)) as IdentityResolveBody | null;
  if (!rawBody || typeof rawBody !== 'object') {
    throw error(400, 'Send a JSON body with pids.');
  }

  const pidChain = parsePidChain(rawBody.pids);
  const terminal = lookupTerminalByPidChain(pidChain);

  // v0.2 sidecar lookup — best-effort, never throws. The v02 path uses
  // the same pidChain shape with ISO normalisation applied inside the
  // helper. status='live' filter is structural (case #2 fix).
  let resolvedV02: { agent_id: string; runtime_id: string } | null = null;
  try {
    resolvedV02 = resolveV02ByPidChain(pidChain);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[v02-resolve] sidecar lookup failed (legacy path unaffected):', err);
  }

  if (!terminal) {
    return json({
      terminal_id: null, name: null, agent_kind: null, handle: null,
      v02_agent_id: resolvedV02?.agent_id ?? null,
      v02_runtime_id: resolvedV02?.runtime_id ?? null
    });
  }

  const scopedV02 = resolvedV02 && v02RuntimeBelongsToTerminal(resolvedV02.runtime_id, terminal.id)
    ? resolvedV02
    : null;

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
    v02_agent_id: scopedV02?.agent_id ?? null,
    v02_runtime_id: scopedV02?.runtime_id ?? null
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
