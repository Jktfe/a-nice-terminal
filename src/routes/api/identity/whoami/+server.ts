/**
 * POST /api/identity/whoami — self-identification for a fresh CLI/agent.
 *
 * Body: { pids: [{pid, pid_start}, ...] }    pidChain the caller walked locally
 *
 * Returns one of:
 *   200 { status: 'bound', handle, terminalId, terminalName, pidChain,
 *         lastBoundRoom?, lastBoundAt?, v02AgentId?, v02RuntimeId? }
 *   404 { status: 'no-terminal' }                     no record on chain
 *   409 { status: 'stale-rebind', terminalId, name,   PID matches but
 *         recordedPidStart, actualPidStart }          pid_start disagrees
 *   422 { status: 'registered-no-handle',             terminal exists
 *         terminalId, terminalName }                  but handle not set
 *
 * Spec: docs/concepts/ant-whoami-primitive.md. Co-signed @speedy + @v4claude
 * (Heroes msg_so9awpjlmw + msg_eqce1j2cec). Discipline rule: the agent's
 * first action on any fresh shell is `ant whoami` — replaces guess-from-
 * stale-context with query-the-substrate. No admin-bearer required (this
 * is self-identification; the caller already controls the PID chain locally
 * to learn anything via this endpoint).
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getIdentityDb } from '$lib/server/db';
import { lookupTerminalByPidChain, type PidChainEntry } from '$lib/server/terminalsStore';
import { normalisePidStartToIso8601 } from '$lib/server/pidStartNormaliser';
import { resolveV02ByPidChain } from '$lib/server/v02RegisterBootstrap';

type WhoamiBody = { pids?: unknown };

function parsePidChain(rawPids: unknown): PidChainEntry[] {
  if (!Array.isArray(rawPids) || rawPids.length === 0) {
    throw error(400, 'pids must be a non-empty array.');
  }
  return rawPids.map((entry, idx) => {
    if (!entry || typeof entry !== 'object') throw error(400, `pids[${idx}] must be an object.`);
    const pidNum = Number((entry as { pid?: unknown }).pid);
    if (!Number.isFinite(pidNum) || pidNum <= 0) {
      throw error(400, `pids[${idx}].pid must be a positive number.`);
    }
    const rawStart = (entry as { pid_start?: unknown }).pid_start;
    const pidStart = typeof rawStart === 'string' ? rawStart : null;
    return { pid: pidNum, pid_start: pidStart };
  });
}

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => null)) as WhoamiBody | null;
  if (!body || typeof body !== 'object') throw error(400, 'Send a JSON body with pids.');
  const pidChain = parsePidChain(body.pids);

  const terminal = lookupTerminalByPidChain(pidChain);
  const db = getIdentityDb();

  if (!terminal) {
    // Stale-rebind detection: row exists with matching PID but the
    // pid_start lifetime stamp disagrees. That means this PID is being
    // recycled by a different process than the one originally registered.
    // Per JWPK open question #2 + co-sign amendment #1 (Heroes
    // msg_eqce1j2cec) this is a distinct case from "no record at all"
    // and the agent should re-register, not retry.
    const stalePlaceholders = pidChain.map(() => '?').join(',');
    const stale = db.prepare(
      `SELECT id, pid, pid_start, name FROM terminals
        WHERE pid IN (${stalePlaceholders}) AND pid_start IS NOT NULL
        ORDER BY updated_at DESC LIMIT 1`
    ).get(...pidChain.map((entry) => entry.pid)) as
      | { id: string; pid: number; pid_start: string; name: string }
      | undefined;
    if (stale) {
      const sentForPid = pidChain.find((entry) => entry.pid === stale.pid);
      const sentIso = normalisePidStartToIso8601(sentForPid?.pid_start ?? null);
      return json(
        {
          status: 'stale-rebind',
          terminalId: stale.id,
          name: stale.name,
          recordedPidStart: stale.pid_start,
          actualPidStart: sentIso
        },
        { status: 409 }
      );
    }
    return json({ status: 'no-terminal' }, { status: 404 });
  }

  const handleRow = db.prepare(
    `SELECT handle FROM terminal_records
      WHERE session_id = ? AND superseded_at_ms IS NULL
      ORDER BY created_at_ms DESC LIMIT 1`
  ).get(terminal.id) as { handle: string | null } | undefined;
  const handle = handleRow?.handle ?? null;

  let v02AgentId: string | null = null;
  let v02RuntimeId: string | null = null;
  try {
    const v02 = resolveV02ByPidChain(pidChain);
    if (v02) {
      v02AgentId = v02.agent_id;
      v02RuntimeId = v02.runtime_id;
    }
  } catch {
    // Legacy path stays authoritative — v0.2 sidecar is best-effort.
  }

  if (!handle) {
    return json(
      {
        status: 'registered-no-handle',
        terminalId: terminal.id,
        terminalName: terminal.name,
        v02AgentId,
        v02RuntimeId
      },
      { status: 422 }
    );
  }

  const lastBound = db
    .prepare(
      `SELECT room_id, created_at FROM room_memberships
        WHERE terminal_id = ? ORDER BY created_at DESC LIMIT 1`
    )
    .get(terminal.id) as { room_id: string; created_at: number } | undefined;

  return json({
    status: 'bound',
    handle,
    terminalId: terminal.id,
    terminalName: terminal.name,
    pidChain: pidChain.map((entry) => entry.pid),
    lastBoundRoom: lastBound?.room_id ?? null,
    lastBoundAt: lastBound?.created_at
      ? new Date(lastBound.created_at * 1000).toISOString()
      : null,
    v02AgentId,
    v02RuntimeId
  });
};
