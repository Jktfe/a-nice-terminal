// POST /api/identity/register — register a terminal entity.
// Idempotent on `name` (UNIQUE). Stores leaf PID; ancestor lookup walks
// caller-side. TTL clamped 60s..24h in terminalsStore.
//
// v0.2 CUT-OVER PHASE 1 (M9b, 2026-05-30): this endpoint now DUAL-WRITES
// to the legacy terminals + terminal_records tables AND to the v0.2
// v02_agents + v02_runtimes + v02_audit_events tables. Both surfaces
// stay populated until M9c (chat-rooms endpoints) + M9d (peripheral
// endpoints) flip, then a follow-up PR drops the dual-write. The v0.2
// bootstrap is a best-effort sidecar: if it throws, the legacy 201 path
// is still returned so existing flows are never harder than today. See
// docs/concepts/ant-v02-cutover-plan.md §1 + §2.1.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  upsertTerminal,
  updatePaneTarget,
  getTerminalById,
  getTerminalByName,
  getLiveTerminalByName,
  getLiveTerminalByPid,
  getLiveTerminalsByHandle,
  setTerminalStatus
} from '$lib/server/terminalsStore';
import { listArchivedMatchesForBase } from '$lib/server/archivedNameMatches';
import { baseName } from '$lib/server/terminalNameTag';
import { isValidClientAgentKind, AGENT_KINDS_CLIENT_INPUT } from '$lib/server/agentKindEnum';
import { classifyIfUnknown } from '$lib/server/agentStatusPoller';
import { normalisePidStartToIso8601 } from '$lib/server/pidStartNormaliser';
import {
  appendHandleAlias,
  getTerminalRecord,
  updateTerminalRecord
} from '$lib/server/terminalRecordsStore';
import {
  autoRebindMembershipsFromStaleTerminal,
  isCandidateStale
} from '$lib/server/roomMembershipsStore';
import { bootstrapV02Identity, normaliseV02Handle } from '$lib/server/v02RegisterBootstrap';
import { getLiveAgentByHandle } from '$lib/server/v02AgentsStore';
import { validateHandleForRegistration } from '$lib/server/handleValidation';
import { findActiveTerminalRecordByHandle } from '$lib/server/terminalRecordsStore';

const VALID_AGENT_KINDS_LIST = Array.from(AGENT_KINDS_CLIENT_INPUT).join(', ');

type IdentityRegisterBody = {
  name?: unknown;
  pids?: unknown;
  ttl_seconds?: unknown;
  source?: unknown;
  meta?: unknown;
  pane?: unknown;
  agent_kind?: unknown;
  /**
   * Optional explicit handle override. When omitted the v0.2 bootstrap
   * derives the handle as `@<name>`. Matches the field accepted by
   * main's Phase B handle-aliasing path (see PR #89) so callers can
   * supply either form during the cut-over window.
   */
  handle?: unknown;
  /**
   * Task 4 (spec 2026-05-31): archived-name intent flags. Exactly one
   * should be supplied when the CLI confirms a revive-vs-fresh choice.
   * Both absent → 409 if archived matches exist (drives CLI prompt).
   */
  fresh?: unknown;
  revive?: unknown;
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
  const metaInput = metaRaw && typeof metaRaw === 'object' ? (metaRaw as Record<string, unknown>) : undefined;
  // Tag the legacy meta with `v0.2_bridged: true` so M9c/M9d code can
  // distinguish rows written by the cut-over dual-write from rows
  // written before the cut-over PR landed. Stripped off once M9d ships
  // and the dual-write is removed.
  const meta: Record<string, unknown> = { ...(metaInput ?? {}), 'v0.2_bridged': true };
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
  let handleValue: string | null = null;
  if (typeof handleRaw === 'string' && handleRaw.trim().length > 0) {
    // Fix #3 (sec-iter1 2026-05-30): M13 reserved-handle enforcement +
    // canonical character/length checks. The validator returns a
    // canonical leading-`@` form so downstream stores never have to
    // re-normalise.
    const validation = validateHandleForRegistration(handleRaw);
    if (!validation.ok) {
      throw error(400, validation.message);
    }
    handleValue = validation.canonicalHandle;
  }
  // Task 4 (spec 2026-05-31): parse archived-name intent fields.
  const reviveId = typeof rawBody.revive === 'string' && rawBody.revive.trim().length > 0
    ? rawBody.revive.trim() : null;
  const freshIntent = rawBody.fresh === true;
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
  // v0.2 reclaim takes precedence over Phase A2 rule (a) when the caller
  // is a known v0.2 agent. JWPK ratified design call (msg_undyx0gkd3
  // 2026-05-30): re-register with a different PID under the same handle
  // is the "shell restart / brew upgrade / laptop→mini" recovery story —
  // it auto-reclaims via bootstrapV02Identity rather than 409-erroring.
  // Phase A2 rule (a) still fires for genuinely-new callers (no prior v0.2
  // agent for the derived handle) so silent dual-binds remain rejected.
  const v02HandleForGate = handleValue
    ? normaliseV02Handle(handleValue)
    : normaliseV02Handle(trimmedName);
  const knownV02Agent =
    v02HandleForGate.length > 0 ? getLiveAgentByHandle(v02HandleForGate) : null;
  const liveNameConflict = getLiveTerminalByName(trimmedName);
  if (
    liveNameConflict !== null &&
    (liveNameConflict.pid !== leafPid.pid || liveNameConflict.pid_start !== leafPid.pid_start) &&
    !knownV02Agent
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
  // Archived-name decision (spec 2026-05-31). The base name is free of any
  // LIVE terminal here (liveNameConflict guards that), but archived history
  // rows may hold it under an [A] tag. Honour an explicit intent; otherwise
  // surface the ambiguity as a structured 409 so the CLI can prompt (or fail
  // loud when non-interactive). Skipped for known v0.2 reclaim callers.
  if (!knownV02Agent) {
    if (reviveId) {
      const target = getTerminalById(reviveId);
      if (!target || target.status !== 'archived' || baseName(target.name) !== trimmedName) {
        throw error(409, `Cannot revive ${reviveId}: not an archived terminal whose base name is '${trimmedName}'.`);
      }
      setTerminalStatus(reviveId, 'live'); // restores base name; upsert below rebinds pid
    } else if (!freshIntent) {
      const candidates = listArchivedMatchesForBase(trimmedName);
      if (candidates.length > 0) {
        return json(
          {
            error: 'archived_name_matches',
            message: `Name '${trimmedName}' has ${candidates.length} archived terminal(s). Pass revive:<id> or fresh:true.`,
            candidates
          },
          { status: 409 }
        );
      }
    }
  }
  // Fix #2 (sec-iter1 2026-05-30): handle uniqueness across
  // terminal_records — reject if another ACTIVE terminal_record already
  // claims this handle AND its backing terminal is still alive.
  // Prevents the @you-spam / impersonation class where an attacker
  // registers under a victim's handle. The DB-level UNIQUE INDEX
  // `terminal_records_handle_unique` is the structural backstop; this
  // 409 returns a friendlier error before the INSERT throws
  // SQLITE_CONSTRAINT.
  //
  // Exemptions (must defer to existing recovery paths):
  //   - same session_id as the row we'd upsert (idempotent re-register);
  //   - known v0.2 agent for this handle (reclaim path);
  //   - claimant's backing terminal is stale per isCandidateStale —
  //     the PR-B auto-rebind block below handles it by superseding the
  //     prior row + moving memberships. Without this exemption the
  //     legitimate "shell restart under same handle" flow 409s.
  if (handleValue) {
    const claimedBy = findActiveTerminalRecordByHandle(handleValue);
    if (
      claimedBy &&
      claimedBy.session_id !== (existing?.id ?? null) &&
      !knownV02Agent
    ) {
      const claimantTerminal = getTerminalById(claimedBy.session_id);
      const claimantIsStale =
        !claimantTerminal || isCandidateStale(claimantTerminal, Date.now());
      if (!claimantIsStale) {
        throw error(
          409,
          `Handle '${handleValue}' is already claimed by terminal '${claimedBy.name}' (session ${claimedBy.session_id}). Pick a different --handle or reclaim with --handle <your-existing-handle>.`
        );
      }
    }
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
  // PR-B v0.2 (JWPK enterprise-concern #5 — @speedyc dual-bind 2026-05-29).
  // After the new registration completes, sweep any OTHER live terminals
  // that own this handle. When a stale candidate is found, atomically
  // re-point its room_memberships to this fresh terminal, archive the old
  // row, and supersede its terminal_records row. Safe-by-construction:
  // isCandidateStale never fires on a live row (heartbeat freshness gate)
  // so an active old session won't have memberships stolen from under it.
  if (handleValue) {
    const nowMs = Date.now();
    const liveCandidates = getLiveTerminalsByHandle(handleValue);
    for (const candidate of liveCandidates) {
      if (candidate.id === terminal.id) continue;
      if (!isCandidateStale(candidate, nowMs)) continue;
      const { reboundCount, affectedRoomIds } = autoRebindMembershipsFromStaleTerminal({
        handle: handleValue,
        oldTerminalId: candidate.id,
        newTerminalId: terminal.id,
        nowMs
      });
      if (reboundCount > 0) {
        // Structured log line — forensic trail for the rebind. JWPK rule
        // (msg_5xjtox2059): any operational decision invisible to the
        // operator is a bug, so the rebind has to leave an audit thread.
        // eslint-disable-next-line no-console
        console.log(
          `[auto-rebind] handle=${handleValue} old=${candidate.id} new=${terminal.id} ` +
            `rooms=${affectedRoomIds.join(',')} count=${reboundCount}`
        );
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

  // v0.2 dual-write sidecar (M9b). Auto-creates the v02_agents row if
  // the handle has never been seen, atomically reclaims any existing
  // live runtime, and writes audit events for both transitions. Failures
  // are swallowed so the legacy 201 path is unconditional — the
  // structural invariants we want are SQLite-enforced (partial unique
  // index, FK chain), so a thrown-here failure means the schema PR
  // didn't ship, which the cut-over plan §4 step a covers explicitly.
  let v02AgentId: string | null = null;
  let v02RuntimeId: string | null = null;
  try {
    const bootstrap = bootstrapV02Identity({
      name: trimmedName,
      handle: handleValue,
      pid: leafPid.pid,
      pid_start: leafPid.pid_start,
      tmux_pane: paneValue,
      cli_provider_id: classifiedAgentKind,
      legacy_terminal_id: terminal.id
    });
    v02AgentId = bootstrap.agent_id;
    v02RuntimeId = bootstrap.runtime_id;
  } catch (err) {
    // Sidecar failure must NOT block the legacy 201. Log to stderr so
    // operators see it during cut-over; the runbook covers diagnosis.
    // eslint-disable-next-line no-console
    console.error('[v02-bootstrap] register sidecar failed (legacy 201 unaffected):', err);
  }

  return json({ terminal_id: terminal.id, name: terminal.name,
    expires_at: terminal.expires_at, tmux_target_pane: paneValue,
    agent_kind: classifiedAgentKind,
    // v0.2 surface — clients that don't yet consume these can ignore them.
    // The legacy fields above remain the contract until M9d ships.
    v02_agent_id: v02AgentId, v02_runtime_id: v02RuntimeId
  }, { status: 201 });
};
