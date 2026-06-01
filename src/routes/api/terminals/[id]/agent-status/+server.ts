/**
 * /api/terminals/:id/agent-status — M3.4a-v2 T2 routes per contract Q4 + Q7.
 *
 * GET → flat row { terminal_id, agent_status, agent_status_source,
 *       agent_status_at_ms, since_ms, evidence_json? }. No auth — global
 *       read surface. 404 unknown terminal.
 * PUT → hook-push. Body: { status, nonce, evidence_json? }. Auth: hook-
 *       nonce verified against terminals.meta.hook_nonce_hash with
 *       PER-PUSH rotation (per OQ #2 lock). 200 returns updated flat row
 *       + next_nonce for the caller's next push. 401 nonce mismatch.
 *       400 bad status. 404 unknown terminal.
 */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  getAgentStatus,
  setAgentStatus,
  isAllowedAgentStatus,
  listEventsForTerminal
} from '$lib/server/agentStatusStore';
import { verifyAndRotateHookNonce } from '$lib/server/agentStatusHookAuth';
import { lookupTerminalByPidChain, type PidChainEntry } from '$lib/server/terminalsStore';

function flattenRow(terminalId: string) {
  const row = getAgentStatus(terminalId);
  if (!row) return null;
  const events = listEventsForTerminal(terminalId);
  const latestEvidence = events.length > 0 ? events[0].evidence_json : null;
  return {
    terminal_id: row.terminal_id,
    agent_status: row.agent_status,
    agent_status_source: row.agent_status_source,
    agent_status_at_ms: row.agent_status_at_ms,
    since_ms: Date.now() - row.agent_status_at_ms,
    evidence_json: latestEvidence
  };
}

export const GET: RequestHandler = async ({ params }) => {
  const terminalId = params.id ?? '';
  if (terminalId.length === 0) throw error(400, 'terminal id required');
  const flat = flattenRow(terminalId);
  if (!flat) throw error(404, 'terminal not found');
  return json(flat);
};

export const PUT: RequestHandler = async ({ request, params }) => {
  const terminalId = params.id ?? '';
  if (terminalId.length === 0) throw error(400, 'terminal id required');
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'invalid JSON body');
  }
  if (!body || typeof body !== 'object') throw error(400, 'body required');
  const status = (body as Record<string, unknown>).status;
  const nonce = (body as Record<string, unknown>).nonce;
  const evidenceJsonRaw = (body as Record<string, unknown>).evidence_json;
  if (!isAllowedAgentStatus(status)) {
    throw error(400, 'status must be one of: idle | thinking | working | response-required');
  }
  const auth = authenticateStatusWrite(terminalId, body);
  if (!auth.ok) throw error(401, auth.message);
  const evidence = evidenceJsonRaw === undefined || evidenceJsonRaw === null
    ? null
    : (typeof evidenceJsonRaw === 'string' ? safeParse(evidenceJsonRaw) : evidenceJsonRaw as Record<string, unknown>);
  try {
    setAgentStatus({ terminalId, newStatus: status, source: auth.source, evidence });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'set failed';
    if (message.includes('not found')) throw error(404, 'terminal not found');
    throw error(400, message);
  }
  const flat = flattenRow(terminalId);
  return json(auth.nextNonce ? { ...flat, next_nonce: auth.nextNonce } : flat, { status: 200 });
};

type StatusWriteAuth =
  | { ok: true; source: 'hook'; nextNonce: string }
  | { ok: true; source: 'ant-activity'; nextNonce: null }
  | { ok: false; message: string };

function authenticateStatusWrite(terminalId: string, body: unknown): StatusWriteAuth {
  const record = body as Record<string, unknown>;
  const nonce = record.nonce;
  if (typeof nonce === 'string' && nonce.length > 0) {
    const nextNonce = verifyAndRotateHookNonce(terminalId, nonce);
    return nextNonce
      ? { ok: true, source: 'hook', nextNonce }
      : { ok: false, message: 'nonce mismatch' };
  }

  const pidChain = parseStatusPidChain(record.pidChain ?? record.pids);
  if (pidChain.length === 0) return { ok: false, message: 'nonce or pidChain required' };
  const resolved = lookupTerminalByPidChain(pidChain);
  if (!resolved || resolved.id !== terminalId) {
    return { ok: false, message: 'pidChain does not resolve to this terminal' };
  }
  return { ok: true, source: 'ant-activity', nextNonce: null };
}

function parseStatusPidChain(raw: unknown): PidChainEntry[] {
  if (!Array.isArray(raw)) return [];
  const chain: PidChainEntry[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const pidValue = (entry as { pid?: unknown }).pid;
    const pid = typeof pidValue === 'number' ? pidValue : Number(pidValue);
    if (!Number.isFinite(pid) || pid <= 0) continue;
    const pidStartValue = (entry as { pid_start?: unknown }).pid_start;
    chain.push({
      pid: Math.floor(pid),
      pid_start: typeof pidStartValue === 'string' ? pidStartValue : null
    });
  }
  return chain;
}

function safeParse(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}
