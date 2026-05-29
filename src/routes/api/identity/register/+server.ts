// POST /api/identity/register — register a terminal entity.
// Idempotent on `name` (UNIQUE). Stores leaf PID; ancestor lookup walks
// caller-side. TTL clamped 60s..24h in terminalsStore.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  upsertTerminal,
  updatePaneTarget,
  getTerminalById,
  getTerminalByName,
  getLiveTerminalByName,
  getLiveTerminalByPid
} from '$lib/server/terminalsStore';
import { isValidClientAgentKind, AGENT_KINDS_CLIENT_INPUT } from '$lib/server/agentKindEnum';
import { classifyIfUnknown } from '$lib/server/agentStatusPoller';
import { normalisePidStartToIso8601 } from '$lib/server/pidStartNormaliser';
import {
  appendHandleAlias,
  getTerminalRecord,
  updateTerminalRecord
} from '$lib/server/terminalRecordsStore';

const VALID_AGENT_KINDS_LIST = Array.from(AGENT_KINDS_CLIENT_INPUT).join(', ');

type IdentityRegisterBody = {
  name?: unknown;
  pids?: unknown;
  ttl_seconds?: unknown;
  source?: unknown;
  meta?: unknown;
  pane?: unknown;
  agent_kind?: unknown;
  handle?: unknown;
};

function parsePidsList(rawPids: unknown): { pid: number; pid_start: string | null }[] {
  if (!Array.isArray(rawPids) || rawPids.length === 0) {
    throw error(400, 'pids must be a non-empty array of {pid, pid_start} entries.');
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
    // ISO 8601 normalisation at the boundary — see pidStartNormaliser.ts.
    // Client-supplied pid_start may be a POSIX locale lstart string or
    // already-ISO Windows CreationDate. Normalise here so every downstream
    // read of `leafPid.pid_start` (live-name conflict / pid-conflict / upsert)
    // sees the same canonical form.
    const pidStartRawString = typeof pidStartRaw === 'string' ? pidStartRaw : null;
    const pidStart = normalisePidStartToIso8601(pidStartRawString);
    return { pid: pidNumber, pid_start: pidStart };
  });
}

export const POST: RequestHandler = async ({ request }) => {
  const rawBody = (await request.json().catch(() => null)) as IdentityRegisterBody | null;
  if (!rawBody || typeof rawBody !== 'object') {
    throw error(400, 'Send a JSON body with name and pids.');
  }

  const nameRaw = rawBody.name;
  if (typeof nameRaw !== 'string' || nameRaw.trim().length === 0) {
    throw error(400, 'name must be a non-empty string.');
  }

  const leafPid = parsePidsList(rawBody.pids)[0];
  const ttlRaw = rawBody.ttl_seconds;
  const ttlSeconds = typeof ttlRaw === 'number' && Number.isFinite(ttlRaw) ? ttlRaw : undefined;
  const sourceRaw = rawBody.source;
  const source = typeof sourceRaw === 'string' && sourceRaw.length > 0 ? sourceRaw : undefined;
  const metaRaw = rawBody.meta;
  const meta = metaRaw && typeof metaRaw === 'object' ? (metaRaw as Record<string, unknown>) : undefined;
  // M3.2d B1: validate agent_kind BEFORE upsert so invalid never writes a row.
  const paneRaw = rawBody.pane;
  const agentKindRaw = rawBody.agent_kind;
  const paneValue = typeof paneRaw === 'string' && paneRaw.trim().length > 0 ? paneRaw.trim() : null;
  let agentKindValue: string | null = null;
  if (typeof agentKindRaw === 'string' && agentKindRaw.length > 0) {
    if (!isValidClientAgentKind(agentKindRaw)) throw error(400, `agent_kind must be one of: ${VALID_AGENT_KINDS_LIST}`);
    agentKindValue = agentKindRaw;
  }
  // Lifecycle Phase B (JWPK A Team msg_7uvr35x0xr 2026-05-29 Q4 default
  // "new=primary so chat send works under the current name"). Optional
  // top-level `handle` field — when re-register hits an EXISTING
  // terminal_records row and the supplied handle differs from the stored
  // one, append the OLD handle to handle_aliases BEFORE overwriting with
  // the new handle. Empty / whitespace-only handles are ignored.
  const handleRaw = rawBody.handle;
  const handleValue =
    typeof handleRaw === 'string' && handleRaw.trim().length > 0 ? handleRaw.trim() : null;
  // M3.2b: pre-read for INSERT-new probe + path-B kind preservation on re-register.
  const trimmedName = nameRaw.trim();
  const existing = getTerminalByName(trimmedName);
  const existed = existing !== null;
  // Phase A2 (JWPK A Team msg_7uvr35x0xr 2026-05-29, design Q2 default B —
  // helpful error w/ exact recovery command). Two 409 rejections layered
  // over the existing upsert path:
  //   (a) live-name conflict — the name is already owned by a *live*
  //       terminal whose (pid, pid_start) differs from the caller's. A
  //       same-(pid,pid_start) re-register stays idempotent (covered by
  //       M3.2b path-B test); only a foreign PID grabbing a still-live
  //       name is rejected. Archived/deleted rows free the name (the
  //       getLiveTerminalByName helper excludes non-live status).
  //   (b) pid-in-use — the caller's leaf (pid, pid_start) is currently
  //       bound to a different live terminal. Rejected unless the
  //       conflicting row IS the same row we'd upsert (i.e. existing).
  const liveNameConflict = getLiveTerminalByName(trimmedName);
  if (
    liveNameConflict !== null &&
    (liveNameConflict.pid !== leafPid.pid || liveNameConflict.pid_start !== leafPid.pid_start)
  ) {
    throw error(
      409,
      `Name '${trimmedName}' is already live on terminal ${liveNameConflict.id}. Reclaim with --handle <existing-handle> or pick a different --name.`
    );
  }
  const pidConflict = getLiveTerminalByPid(leafPid.pid, leafPid.pid_start);
  if (pidConflict && pidConflict.id !== (existing?.id ?? null)) {
    throw error(
      409,
      `PID ${leafPid.pid} (start=${leafPid.pid_start}) is already bound to live terminal '${pidConflict.name}'. Archive it first or use a different shell.`
    );
  }
  const terminal = upsertTerminal({ pid: leafPid.pid, pid_start: leafPid.pid_start,
    name: trimmedName, ttlSeconds, source, meta });
  const updateKindValue = agentKindValue !== null
    ? agentKindValue : (existed ? (existing?.agent_kind ?? null) : null);
  if (paneValue) updatePaneTarget(terminal.id, paneValue, updateKindValue);
  // Phase B handle morph: only acts when the caller supplied a non-empty
  // handle AND a terminal_records row exists for this session_id. The
  // register endpoint never CREATES terminal_records — that's POST
  // /api/terminals' job — so a session without a record is a no-op here.
  if (handleValue) {
    const record = getTerminalRecord(terminal.id);
    if (record) {
      const existingHandle = record.handle ?? '';
      if (existingHandle.length > 0 && existingHandle !== handleValue) {
        appendHandleAlias(terminal.id, existingHandle);
      }
      if (existingHandle !== handleValue) {
        updateTerminalRecord(terminal.id, { handle: handleValue });
      }
    }
  }
  // Response kind starts at updateKindValue (preserved); re-fetch only when classify ran.
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
  return json({ terminal_id: terminal.id, name: terminal.name,
    expires_at: terminal.expires_at, tmux_target_pane: paneValue,
    agent_kind: classifiedAgentKind }, { status: 201 });
};
