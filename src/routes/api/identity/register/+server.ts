// POST /api/identity/register — register a terminal entity.
// Idempotent on `name` (UNIQUE). Stores leaf PID; ancestor lookup walks
// caller-side. TTL clamped 60s..24h in terminalsStore.
//
// vNext identity register. Production no longer dual-writes to the old v0.2
// agents/runtimes sidecar; those tables are historical until a migration drops
// them. The durable session + room membership/lease stores are authoritative.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { randomBytes } from 'node:crypto';
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
import { validateHandleForRegistration } from '$lib/server/handleValidation';
import {
  findActiveTerminalRecordByHandle,
  lowestFreeTerminalHandle
} from '$lib/server/terminalRecordsStore';
import { ensureSession, getSession, SessionAdoptionRefused } from '$lib/server/antSessionStore';
import { backfillActiveLeasesFromRoomMemberships } from '$lib/server/roomHandleLeaseStore';
import { reclaimCleanHandleIfStale } from '$lib/server/roomHandleLeaseClean';
import { listRoomsForHandle, rebindMemberSessionIfStale } from '$lib/server/membershipStore';
import { resolveOrNull } from '$lib/server/sessionResolver';
import { bindHandle, getHandleRow, getLiveBinding } from '$lib/server/handleBindingsStore';
import { appendLedger } from '$lib/server/identityLedgerStore';
import { corroboratePaneFact } from '$lib/server/paneFactCorroboration';
import { buildHandleOccupiedPayload } from '$lib/server/permissionDeniedPayload';
import { readIdentityReadMode } from '$lib/server/callerIdentityResolver';

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
   * Optional explicit handle override. Empty / whitespace-only handles are
   * ignored; valid handles are canonicalised to leading-@ form.
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

  const pidsList = parsePidsList(rawBody.pids);
  const leafPid = pidsList[0];
  const ttlRaw = rawBody.ttl_seconds;
  const ttlSeconds = typeof ttlRaw === 'number' && Number.isFinite(ttlRaw) ? ttlRaw : undefined;
  const sourceRaw = rawBody.source;
  const source = typeof sourceRaw === 'string' && sourceRaw.length > 0 ? sourceRaw : undefined;
  const metaRaw = rawBody.meta;
  const metaInput = metaRaw && typeof metaRaw === 'object' ? (metaRaw as Record<string, unknown>) : undefined;
  const meta: Record<string, unknown> = { ...(metaInput ?? {}) };
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
  if (reviveId && freshIntent) {
    throw error(400, 'Specify revive or fresh, not both.');
  }
  // M3.2b: pre-read for INSERT-new probe + path-B kind preservation on re-register.
  const trimmedName = nameRaw.trim();
  const existing = getTerminalByName(trimmedName);
  const existed = existing !== null;
  const sessionTokenRaw = (rawBody as { sessionToken?: unknown }).sessionToken;
  const sessionTokenFromCaller =
    typeof sessionTokenRaw === 'string' && sessionTokenRaw.trim().length > 0
      ? sessionTokenRaw.trim()
      : null;
  const callerSession = sessionTokenFromCaller ? getSession(sessionTokenFromCaller) : null;
  const callerOwnsExistingTerminal =
    existing !== null && callerSession?.terminal_id === existing.id;
  // NB: there is deliberately NO operator-handle re-register allow-block here.
  // An earlier idempotent-operator-reregister branch lived at this point, but
  // it was dead code: validateHandleForRegistration (above, ~line 138) already
  // rejects the operator handle as `reserved` → 400 BEFORE handleValue is set,
  // so this branch's `handleValue && isOperatorHandle(handleValue)` was never
  // reachable. Dropped on review (@c4 / @speedy 2026-06-10). This is the
  // tightest reading of JWPK's "no-one but me changes the server handle"
  // (msg_1iff57erwg): the OPEN self-register endpoint can NEVER mint the
  // operator handle — the operator acquires @JWPK via operator-authed
  // bind/config + room leases, not this route. The complementary write-side
  // guard is requireOperatorForOperatorHandle on /api/terminals.
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
  // Corroboration runs ONCE, before any gate that can use it (pane-witnessed
  // self-ownership below, CLEAN refusal, dual-write, shadow compare) — a
  // spoofed pane ledgers exactly one signature row.
  const { pane: corroboratedPane } = paneValue
    ? corroboratePaneFact(paneValue, pidsList)
    : { pane: null };
  const liveNameConflict = getLiveTerminalByName(trimmedName);
  // Pane-witnessed self-ownership (cut-live fix 2026-06-11, caught by the
  // reclaim sweep): a restarted/tool-spawned shell has a drifted pid and may
  // hold no session token — but if the daemon corroborates that the caller
  // OCCUPIES the very pane the existing terminal row claims, it is the same
  // desk re-registering. Witnessed, not asserted: corroboratePaneFact proved
  // the pane hosts the caller's own process chain.
  const paneWitnessedSelf =
    liveNameConflict !== null &&
    corroboratedPane !== null &&
    liveNameConflict.tmux_target_pane === corroboratedPane;
  if (
    liveNameConflict !== null &&
    (liveNameConflict.pid !== leafPid.pid || liveNameConflict.pid_start !== leafPid.pid_start) &&
    !callerOwnsExistingTerminal &&
    !paneWitnessedSelf
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
  // loud when non-interactive).
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
  //   - claimant's backing terminal is stale per isCandidateStale —
  //     the PR-B auto-rebind block below handles it by superseding the
  //     prior row + moving memberships. Without this exemption the
  //     legitimate "shell restart under same handle" flow 409s.
  // Third-adopter shadow (msg_i5mnwve57r): remember what the caller ASKED
  // for and what the witness shows BEFORE any suffix/dual-write mutates
  // either — the AC3 comparison is requested-vs-granted against what
  // refuse-or-claim would have done at claim time. Corroboration runs ONCE
  // here and is reused by every consumer below (refusal check, dual-write,
  // shadow comparison) so a spoofed pane ledgers exactly one signature row.
  const requestedHandle = handleValue;
  const witnessBindingAtClaim = requestedHandle ? getLiveBinding(requestedHandle) : null;
  // CUTOVER BEHAVIOUR — refuse-or-claim (AC3, contract ratified 2026-06-10;
  // soak sequencing msg_l7gimewpiy). Active ONLY when ANT_IDENTITY_READ=clean:
  // a handle with a LIVE witnessed binding on a pane that is not the caller's
  // own corroborated pane is OCCUPIED → the registration is refused with the
  // structured handle_occupied payload (owners as approvers, rebind as the
  // remedy), the refusal is ledgered, and the owners are notified. Nothing is
  // inherited; no suffix is minted. Vacant or never-bound handles claim
  // instantly. LEGACY and SHADOW behaviour is untouched.
  if (
    requestedHandle &&
    readIdentityReadMode() === 'clean' &&
    witnessBindingAtClaim !== null &&
    witnessBindingAtClaim.pane !== corroboratedPane
  ) {
    const handleRow = getHandleRow(requestedHandle);
    const owners = handleRow?.owners ?? [];
    try {
      appendLedger({
        kind: 'handle.claim-refused', handle: requestedHandle, actor: 'daemon',
        detail: {
          claimant_pane: corroboratedPane, claimant_pid: leafPid.pid,
          incumbent_pane: witnessBindingAtClaim.pane
        }
      });
      if (owners.length > 0) {
        appendLedger({
          kind: 'owner.notified', handle: requestedHandle, actor: 'daemon',
          detail: { reason: 'claim-refused', owners, pane: corroboratedPane }
        });
      }
    } catch { /* ledger best-effort; the refusal itself is the contract act */ }
    throw error(403, buildHandleOccupiedPayload({
      handle: requestedHandle,
      owners,
      ...(corroboratedPane ? { claimant_pane: corroboratedPane } : {})
    }) as unknown as App.Error);
  }
  if (handleValue) {
    const claimedBy = findActiveTerminalRecordByHandle(handleValue);
    if (
      claimedBy &&
      claimedBy.session_id !== (existing?.id ?? null)
    ) {
      const claimantTerminal = getTerminalById(claimedBy.session_id);
      const claimantIsStale =
        !claimantTerminal || isCandidateStale(claimantTerminal, Date.now());
      if (!claimantIsStale) {
        // OPTION A (2026-06-04, register-writes-real-token): a genuinely-LIVE
        // different terminal already holds this clean handle. The old behaviour
        // threw 409 here — but that rejected BEFORE the session token + lease
        // were minted, so the caller walked away tokenless = mute (the bug we
        // hand-repaired five times). Instead, grant the lowest-free suffixed
        // handle (@x-N, same dash convention as the room lease layer) and fall
        // through to mint a token. The live incumbent keeps clean @x untouched
        // (no-hijack), the caller gets a distinct, visible identity it can post
        // under. Stale incumbents still fall through unsuffixed to the
        // auto-rebind / reclaim path below (they get clean @x back).
        handleValue = lowestFreeTerminalHandle(handleValue, existing?.id ?? null);
      }
    }
  }
  const terminal = upsertTerminal({ pid: leafPid.pid, pid_start: leafPid.pid_start,
    name: trimmedName, ttlSeconds, source, meta });
  // ACTIVATION (Simplify & Harden lane A): populate the durable session so the
  // identity model is IN FORCE, not dormant (ant_sessions was 0 on live). Keyed
  // by the client's persisted SECRET token when sent, else mint a fresh secret
  // for the client to persist. Do NOT use terminal.id as a session token:
  // terminal ids are discoverable runtime identifiers, not credentials.
  const sessionToken =
    sessionTokenFromCaller !== null
      ? sessionTokenFromCaller
      : randomBytes(32).toString('hex');
  const sessionLabel = handleValue ?? trimmedName;
  // Bind the durable session to THIS terminal (anti-adoption anchor): a caller
  // re-presenting a known token from a different terminal is refused, and the
  // post-path requires the caller's pidChain to resolve to this terminal.
  let antSession;
  try {
    antSession = ensureSession(sessionToken, {
      kind: 'local-cli',
      label: sessionLabel,
      terminalId: terminal.id
    });
  } catch (e) {
    if (e instanceof SessionAdoptionRefused) {
      throw error(409, 'sessionToken is bound to a different terminal — refusing to adopt another terminal\'s session.');
    }
    throw e;
  }
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
  // Clean-core dual-write (AC3 Step 1, ant-handles-rooms-ownership-contract.md
  // 2026-06-10): when this register carries both a handle and a pane, record
  // the witnessed pane↔handle binding in the greenfield tables. Nothing reads
  // these for authority yet (that's the Step 2 read-flip); the witness layer
  // (pty-inject-bridge / boot reconcile) owns the tombstone side. No pane =
  // nothing witnessed = no binding. Best-effort: never blocks a 201.
  if (handleValue && paneValue) {
    try {
      // Corroboration gate (msg_fjbp2o97h9, applies in EVERY mode): register
      // WRITES the witness table, so an uncorroborated pane must never feed
      // it — that would poison the very data the cutover flatline measures.
      // The corroboration ran once above; reuse its verdict here.
      if (corroboratedPane) {
        bindHandle({
          handle: handleValue,
          pane: corroboratedPane,
          pid: leafPid.pid,
          pidStart: leafPid.pid_start,
          terminalId: terminal.id
        });
      }
    } catch { /* clean-core write failure must not break registration */ }
  }
  // AC3 outcome shadow (third adopter, msg_i5mnwve57r): in SHADOW mode,
  // ledger every registration whose LEGACY outcome diverges from what the
  // contract's refuse-or-claim would have done. Registration behaviour is
  // untouched in LEGACY and SHADOW — the flip happens at cutover only.
  //  - witness had a LIVE binding for the requested handle → contract REFUSES;
  //    legacy granting anything (suffix or inherit) is a divergence.
  //  - witness vacant/unknown → contract CLAIMS the requested handle; legacy
  //    granting a SUFFIX instead (terminal_records incumbent) is a divergence.
  if (requestedHandle && readIdentityReadMode() === 'shadow') {
    try {
      const contractOutcome = witnessBindingAtClaim !== null ? 'refuse' : 'claim';
      const diverged =
        contractOutcome === 'refuse' || handleValue !== requestedHandle;
      if (diverged) {
        appendLedger({
          kind: 'resolver.disagreement',
          handle: requestedHandle,
          actor: 'resolver',
          detail: {
            surface: 'register',
            requested_handle: requestedHandle,
            granted_handle: handleValue,
            contract_outcome: contractOutcome,
            witness_pane: witnessBindingAtClaim?.pane ?? null
          }
        });
      }
    } catch { /* proving-mode write failure never blocks a 201 */ }
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
  backfillActiveLeasesFromRoomMemberships({
    sessionId: antSession.id,
    terminalId: terminal.id,
    createdFrom: 'register-existing-membership-backfill'
  });
  // PART 2 (2026-06-04, register-writes-real-token): re-key the CLEAN room
  // leases the POST-gate actually reads — roomHandleLeaseClean (the SINGULAR
  // room_handle_lease, session-token-keyed) — to THIS real token, for every
  // room this handle already belongs to. The backfill above writes the LEGACY
  // PLURAL room_handle_leases, which the gate does NOT read, so on its own a
  // register never refreshed the gate's lease: an agent whose clean lease was
  // minted under a now-dead terminal-id stayed mute in invite rooms (which
  // never auto-join). reclaimCleanHandleIfStale promotes our token to clean @x
  // only when the incumbent clean holder is stale/unresolvable; a genuinely
  // live different holder keeps @x (no-hijack) and we'd take a rule-4 suffix.
  // Scoped to listRoomsForHandle so we only touch EXISTING memberships, never
  // auto-join new rooms.
  if (handleValue) {
    const isHolderStale = (holderSessionId: string): boolean => {
      const holder = resolveOrNull(holderSessionId);
      if (!holder) return true;
      const holderTerminal = holder.terminal_id
        ? getTerminalById(holder.terminal_id)
        : null;
      return !holderTerminal || isCandidateStale(holderTerminal, Date.now());
    };
    for (const memberRoomId of listRoomsForHandle(handleValue)) {
      const reclaimed = reclaimCleanHandleIfStale(memberRoomId, handleValue, antSession.id, isHolderStale);
      if (reclaimed !== null) {
        rebindMemberSessionIfStale(memberRoomId, handleValue, antSession.id, isHolderStale);
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
    agent_kind: classifiedAgentKind,
    // ACTIVATION: the durable session id — the CLI persists this and sends it
    // back as `sessionToken` on register + as x-ant-session-id on post, so the
    // durable identity model is exercised end-to-end.
    session_id: antSession.id,
    v02_agent_id: null, v02_runtime_id: null
  }, { status: 201 });
};
