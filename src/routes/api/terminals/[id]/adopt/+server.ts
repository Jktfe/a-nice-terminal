/**
 * POST /api/terminals/:id/adopt
 *
 * Bind an existing external process pidChain to an ANT terminal identity.
 * This is for old/free-floating tmux/Claude/Codex sessions that were not
 * born inside an ANT-spawned pane. It is deliberately admin-gated and
 * separate from any future human-grant flow.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdminAuth } from '$lib/server/chatInviteAuth';
import { getTerminalRecord, deriveHandle } from '$lib/server/terminalRecordsStore';
import { adoptExternalProcessForTerminal } from '$lib/server/terminalsStore';

const MIN_TTL_SECONDS = 60;
const DEFAULT_TTL_SECONDS = 15 * 60;

function parseTtl(raw: unknown): number {
  if (raw === undefined || raw === null) return DEFAULT_TTL_SECONDS;
  const ttl = Number(raw);
  if (!Number.isFinite(ttl) || ttl < MIN_TTL_SECONDS) {
    throw error(400, 'ttlSeconds must be at least 60.');
  }
  return Math.floor(ttl);
}

export const POST: RequestHandler = async ({ params, request }) => {
  requireAdminAuth(request);
  const sessionId = params.id ?? '';
  if (sessionId.length === 0) throw error(400, 'terminal id is required.');
  const record = getTerminalRecord(sessionId);
  if (!record) throw error(404, `terminal record not found: ${sessionId}`);

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw error(400, 'Send a JSON object body.');
  }
  const b = body as Record<string, unknown>;
  const pid = Number(b.pid);
  if (!Number.isFinite(pid) || pid <= 0) {
    throw error(400, 'pid must be a positive number.');
  }
  const pidStart = typeof b.pidStart === 'string' && b.pidStart.trim().length > 0
    ? b.pidStart.trim()
    : null;
  if (!pidStart) {
    throw error(400, 'pidStart is required to guard against PID reuse.');
  }
  const ttlSeconds = parseTtl(b.ttlSeconds);
  const reason = typeof b.reason === 'string' && b.reason.trim().length > 0
    ? b.reason.trim()
    : null;

  const terminal = adoptExternalProcessForTerminal({
    record,
    pid: Math.floor(pid),
    pidStart,
    ttlSeconds,
    reason,
    adoptedBy: 'admin'
  });

  return json({
    terminalId: terminal.id,
    name: record.name,
    handle: deriveHandle(record),
    adopted: {
      pid: terminal.pid,
      pidStart: terminal.pid_start,
      ttlSeconds
    }
  });
};
