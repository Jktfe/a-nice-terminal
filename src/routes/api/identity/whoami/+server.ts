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
import { resolveHandleForTerminal } from '$lib/server/membershipStore';
import { resolveCallerIdentity } from '$lib/server/callerIdentityResolver';
import { corroboratePaneFact } from '$lib/server/paneFactCorroboration';

type WhoamiBody = { pids?: unknown; pane?: unknown };

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

  let handle: string | null = null;
  const handleRow = db
    .prepare(
      `SELECT handle FROM terminal_records
        WHERE session_id = ? AND superseded_at_ms IS NULL
        ORDER BY created_at_ms DESC LIMIT 1`
    )
    .get(terminal.id) as { handle: string | null } | undefined;
  const legacy = handleRow?.handle;
  if (legacy && legacy.length > 0) handle = legacy;
  if (!handle) {
    // MEMBERSHIP FALLBACK (2026-06-08): post-cut-over a live agent posts via
    // the session/lease path, so its handle lives in the clean room_membership
    // keyed by the durable session — NOT in agents.primary_handle or
    // terminal_records.handle (both empty for current rows). Without this,
    // whoami reports "registered-no-handle" for an agent that is demonstrably
    // a live room member receiving + posting — the contradiction JWPK hit
    // (Oldboys msg_3iqrmww20n). Resolve the handle the same way the post path
    // does: terminal -> its durable ant_sessions -> clean room_membership.
    // Self-ID only: the caller already controls this PID chain locally, so
    // surfacing the handle its OWN terminal's sessions hold grants no new
    // authority (no membership/lease is written here — read-only).
    const memberHandle = resolveHandleForTerminal(terminal.id, db);
    if (memberHandle && memberHandle.length > 0) handle = memberHandle;
  }

  // Step 2 seam adoption — FIRST endpoint on resolveCallerIdentity (blessed
  // msg_6dtpw2o4pn, chair order item 2). The legacy resolution above becomes
  // the deferred thunk; `pane` is a CLI-presented transport fact (optional —
  // older CLIs omit it, which in SHADOW mode ledgers the legacy-answered-
  // nothing-witnessed signature, exactly the adoption gap the proving mode
  // exists to surface). LEGACY mode is behaviour-identical. CLEAN mode makes
  // whoami answer purely from daemon-witnessed bindings — AC1 verbatim; the
  // unresolved case maps onto the existing registered-no-handle status until
  // Step 3 introduces a distinct payload.
  const paneRaw = body.pane;
  const presentedPane = typeof paneRaw === 'string' && paneRaw.trim().length > 0 ? paneRaw.trim() : null;
  // Daemon corroboration (msg_fjbp2o97h9): the presented pane is transport
  // data, never an identity claim. It only feeds the witness lookup when
  // tmux confirms the pane hosts a pid from the caller's own chain; a pane
  // the caller does not occupy is treated as absent and ledgered as the
  // spoof signature (pane.uncorroborated).
  const { pane: corroboratedPane } = corroboratePaneFact(presentedPane, pidChain);
  const legacyHandle = handle;
  const resolution = resolveCallerIdentity({
    pane: corroboratedPane,
    // pidChain already proved this terminal; the witness binding is keyed to
    // it, so clean-mode resolves even when the live pane can't be corroborated
    // (desktop apps / detached spawns — the grandfathered-straggler hole).
    terminalId: terminal.id,
    legacy: () => (legacyHandle ? { handle: legacyHandle, terminalId: terminal.id } : null)
  });

  if (!resolution.ok) {
    return json(
      {
        status: 'registered-no-handle',
        terminalId: terminal.id,
        terminalName: terminal.name,
        v02AgentId: null,
        v02RuntimeId: null
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
    handle: resolution.identity.handle,
    identitySource: resolution.identity.source,
    terminalId: terminal.id,
    terminalName: terminal.name,
    pidChain: pidChain.map((entry) => entry.pid),
    lastBoundRoom: lastBound?.room_id ?? null,
    lastBoundAt: lastBound?.created_at
      ? new Date(lastBound.created_at * 1000).toISOString()
      : null,
    v02AgentId: null,
    v02RuntimeId: null
  });
};
