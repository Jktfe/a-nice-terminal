// POST /api/sessions/add — retrospective registration helper.
// Mode A (terminal): { pid, pid_start?, name, ttl_seconds?, source?, meta? }.
// Mode B (membership): { room_id, handle, terminal_name }. Idempotent on both
// shapes (upsertTerminal handles name-collision, addMembership UNIQUE).

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { upsertTerminal, getTerminalByName, getTerminalById, updatePaneTarget } from '$lib/server/terminalsStore';
import { addMembership } from '$lib/server/roomMembershipsStore';
import { isValidClientAgentKind, AGENT_KINDS_CLIENT_INPUT } from '$lib/server/agentKindEnum';
import { classifyIfUnknown } from '$lib/server/agentStatusPoller';

const VALID_AGENT_KINDS_LIST = Array.from(AGENT_KINDS_CLIENT_INPUT).join(', ');

type SessionsAddBody = {
  pid?: unknown;
  pid_start?: unknown;
  name?: unknown;
  ttl_seconds?: unknown;
  source?: unknown;
  meta?: unknown;
  room_id?: unknown;
  handle?: unknown;
  terminal_name?: unknown;
  pane?: unknown;
  agent_kind?: unknown;
};

function isMembershipMode(body: SessionsAddBody): boolean {
  return typeof body.room_id === 'string'
    && typeof body.handle === 'string'
    && typeof body.terminal_name === 'string';
}

function isTerminalMode(body: SessionsAddBody): boolean {
  return typeof body.pid !== 'undefined' && typeof body.name === 'string';
}

function handleTerminalMode(body: SessionsAddBody): Response {
  const pidNumber = Number(body.pid);
  if (!Number.isFinite(pidNumber) || pidNumber <= 0) throw error(400, 'pid must be a positive number.');
  const pidStart = typeof body.pid_start === 'string' ? body.pid_start : null;
  const name = (body.name as string).trim();
  if (name.length === 0) throw error(400, 'name cannot be empty.');
  const ttlRaw = body.ttl_seconds;
  const ttlSeconds = typeof ttlRaw === 'number' && Number.isFinite(ttlRaw) ? ttlRaw : undefined;
  const sourceRaw = body.source;
  const source = typeof sourceRaw === 'string' && sourceRaw.length > 0 ? sourceRaw : 'cli-add-session';
  const metaRaw = body.meta;
  const meta = metaRaw && typeof metaRaw === 'object' ? (metaRaw as Record<string, unknown>) : undefined;
  const paneRaw = body.pane;
  const agentKindRaw = body.agent_kind;
  const paneValue = typeof paneRaw === 'string' && paneRaw.trim().length > 0 ? paneRaw.trim() : null;
  // M3.2d B1: validate client agent_kind before any write.
  let agentKindValue: string | null = null;
  if (typeof agentKindRaw === 'string' && agentKindRaw.length > 0) {
    if (!isValidClientAgentKind(agentKindRaw)) throw error(400, `agent_kind must be one of: ${VALID_AGENT_KINDS_LIST}`);
    agentKindValue = agentKindRaw;
  }
  // M3.2b: pre-read for INSERT-new probe + path-B kind preservation on re-register.
  const existing = getTerminalByName(name);
  const existed = existing !== null;
  const terminal = upsertTerminal({ pid: pidNumber, pid_start: pidStart, name, ttlSeconds, source, meta });
  const updateKindValue = agentKindValue !== null
    ? agentKindValue : (existed ? (existing?.agent_kind ?? null) : null);
  if (paneValue) updatePaneTarget(terminal.id, paneValue, updateKindValue);
  // Response kind starts at updateKindValue so re-register with omitted kind
  // returns the preserved existing kind, not null (delta-5 residual 2 fix).
  let classifiedAgentKind: string | null = updateKindValue;
  if (!existed && agentKindValue === null && paneValue !== null) {
    try {
      const fresh = getTerminalById(terminal.id);
      if (fresh) {
        classifyIfUnknown(fresh);
        const reread = getTerminalById(terminal.id);
        if (reread) classifiedAgentKind = reread.agent_kind ?? null;
      }
    } catch { /* best-effort: classify failure never blocks 201 */ }
  }
  return json({ terminal_id: terminal.id, name: terminal.name, tmux_target_pane: paneValue, agent_kind: classifiedAgentKind }, { status: 201 });
}

function handleMembershipMode(body: SessionsAddBody): Response {
  const roomId = (body.room_id as string).trim();
  const handle = (body.handle as string).trim();
  const terminalName = (body.terminal_name as string).trim();
  if (!roomId || !handle || !terminalName) {
    throw error(400, 'room_id, handle, and terminal_name must all be non-empty.');
  }
  const terminal = getTerminalByName(terminalName);
  if (!terminal) {
    throw error(404, `No terminal registered with name "${terminalName}".`);
  }
  const membership = addMembership({ room_id: roomId, handle, terminal_id: terminal.id });
  return json({
    membership_id: membership.id,
    room_id: membership.room_id,
    handle: membership.handle,
    terminal_id: membership.terminal_id
  }, { status: 201 });
}

export const POST: RequestHandler = async ({ request }) => {
  const rawBody = (await request.json().catch(() => null)) as SessionsAddBody | null;
  if (!rawBody || typeof rawBody !== 'object') {
    throw error(400, 'Send a JSON body with either {pid, name} or {room_id, handle, terminal_name}.');
  }

  if (isMembershipMode(rawBody)) return handleMembershipMode(rawBody);
  if (isTerminalMode(rawBody)) return handleTerminalMode(rawBody);

  throw error(400, 'Body must match either terminal-add mode (pid, name) or membership-add mode (room_id, handle, terminal_name).');
};
