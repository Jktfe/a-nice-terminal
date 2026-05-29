/**
 * v02RegisterBootstrap — auto-bootstrap shim for the M9b cut-over phase.
 *
 * The v0.2 schema requires `v02_runtimes.agent_id` to FK an existing
 * `v02_agents` row before a runtime can be registered. The legacy
 * `ant register` flow has no notion of "create the agent first" — it
 * upserts a terminals row directly given a name + pid + pid_start.
 *
 * This shim bridges that gap. Given the legacy register payload (name,
 * leaf pid, pid_start, pane, agent_kind, optional handle), it:
 *
 *   1. Derives a handle from `handle || name` (mirrors legacy handle
 *      derivation: "@<name>" if no handle supplied).
 *   2. If no v02_agents row exists for that handle: INSERT v02_agents
 *      with the supplied display_name. owner_org is left NULL for legacy
 *      compatibility (no org context in the legacy register payload).
 *   3. If a live runtime already exists for the agent, atomically reclaim
 *      it (flip old → 'reclaimed', insert new live runtime, swap pointer).
 *      Otherwise INSERT v02_runtimes with status='live'. The partial
 *      unique index on (agent_id) WHERE status='live' enforces "at most
 *      one live runtime per agent" structurally.
 *   4. Flip v02_agents.current_runtime_id to the new runtime_id.
 *   5. Write v02_audit_events rows for the agent.created (if new) and
 *      runtime.registered transitions.
 *
 * Compatibility shim disclaimer: once the M9c/M9d phases ship and the
 * legacy stores stop being read, the auto-create-agent path will remain
 * as a convenience for `ant register`-style first-call flows, but the
 * idiomatic v0.2 flow is `ant agents create` explicitly first. We
 * preserve auto-create so JWPK's re-register dance on cut-over evening
 * doesn't require an extra step.
 */

import { randomUUID } from 'node:crypto';
import { getIdentityDb } from './db';
import * as v02Agents from './v02AgentsStore';
import * as v02Runtimes from './v02RuntimesStore';

export type V02BootstrapInput = {
  /** The legacy `name` field — used as display_name + as fallback handle. */
  name: string;
  /** Optional explicit @handle override. If omitted, falls back to `@<name>`. */
  handle?: string | null;
  /** Leaf pid from the caller's pidChain (entry[0]). */
  pid: number;
  /**
   * Raw `ps -o lstart=` style string from the legacy register payload.
   * Will be normalised to ISO 8601 UTC for storage on
   * `v02_runtimes.pid_start_iso`. Null is preserved as null (legacy
   * registers without pid_start are valid; v0.2 stores a synthetic ISO
   * derived from `started_at_ms`).
   */
  pid_start: string | null;
  /** Optional tmux pane id (e.g. "%1"). */
  tmux_pane?: string | null;
  /** Optional client-supplied CLI agent_kind (claude_code, codex, etc.). */
  cli_provider_id?: string | null;
  /** Host identifier — defaults to "local" (the daemon's own host). */
  host?: string;
  /**
   * The session_id of the legacy terminals row we just upserted. Used as
   * the placeholder `register_challenge_proof` until the cut-over evening
   * delivers a real signed challenge per ant-v02-identity-and-recovery
   * design. Format: `pre-v02-attestation:<sessionId>`.
   */
  legacy_terminal_id: string;
};

export type V02BootstrapResult = {
  agent_id: string;
  runtime_id: string;
  agent_was_created: boolean;
  prior_runtime_id: string | null;
};

/**
 * Normalise a handle: lead with '@' if not already. Treats null/empty as
 * "use name fallback" (caller responsibility — this just enforces the
 * leading-@ invariant).
 */
function normaliseHandle(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return trimmed;
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

/**
 * Convert a raw `ps -o lstart=` string (e.g. "Tue May 13 00:00:00 2026")
 * to ISO 8601 UTC ("2026-05-13T00:00:00.000Z"). Returns a synthetic ISO
 * derived from `Date.now()` if the input is null/unparseable — legacy
 * registers without pid_start are valid and we must not reject them in
 * the cut-over PR.
 *
 * The v0.2 spec mandates ISO 8601 UTC on the pid_start_iso column
 * because the legacy locale-dependent string compare silently mismatched
 * across locale changes — see v0.2 spec §Three Structural Invariants.
 */
export function pidStartToIso(raw: string | null, fallbackMs?: number): string {
  if (raw === null) return new Date(fallbackMs ?? Date.now()).toISOString();
  const trimmed = raw.trim();
  if (trimmed.length === 0) return new Date(fallbackMs ?? Date.now()).toISOString();
  // If the input already looks ISO-shaped (starts with 4-digit year + 'T'
  // or '-'), pass it through.
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  // Best-effort Date parse of common `ps -o lstart=` shapes.
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  // Unparseable — fall back to "now" but tag with a recognisable suffix
  // so forensic queries can surface "we synthesised this" rows. Cut-over
  // evening should NOT see this branch fire; if it does, that's a
  // diagnostic that the legacy pid_start serialisation drifted from
  // what `new Date()` accepts.
  return `${new Date(fallbackMs ?? Date.now()).toISOString()}#unparseable`;
}

/**
 * Append a single audit event. Best-effort: never throws (audit writes
 * must not break the register/resolve hot paths). v0.2 audit_events
 * schema is in src/lib/server/db.ts §audit_events — see also the spec
 * doc §audit_events for the kind taxonomy.
 */
function appendAuditEvent(input: {
  kind: string;
  entity_kind: 'agent' | 'runtime' | 'membership' | 'system';
  entity_id: string;
  actor_agent_id: string | null;
  actor_runtime_id: string | null;
  after_json: Record<string, unknown> | null;
}): void {
  try {
    const db = getIdentityDb();
    db.prepare(
      `INSERT INTO v02_audit_events
         (audit_id, at_ms, kind, entity_kind, entity_id,
          actor_agent_id, actor_runtime_id, before_json, after_json,
          request_id, ip_hash, challenge_proof)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL, NULL)`
    ).run(
      randomUUID(),
      Date.now(),
      input.kind,
      input.entity_kind,
      input.entity_id,
      input.actor_agent_id,
      input.actor_runtime_id,
      input.after_json ? JSON.stringify(input.after_json) : null
    );
  } catch {
    // Audit write failed — swallow. The cut-over PR cannot break the
    // register hot path because the audit table has a CHECK or FK
    // constraint we missed. Investigate if this fires in production.
  }
}

/**
 * The bootstrap entry point. Idempotent on (handle, pid, pid_start_iso)
 * in the sense that running it twice for the same caller produces one
 * agent + one live runtime (the second call atomically reclaims the
 * first), not duplicates.
 *
 * Returns the agent_id + runtime_id pair plus diagnostic flags
 * (was-created, prior-runtime-if-reclaimed). The caller uses these to
 * thread the v0.2 identity into downstream auth gates as M9c lands.
 */
export function bootstrapV02Identity(input: V02BootstrapInput): V02BootstrapResult {
  const trimmedName = input.name.trim();
  if (trimmedName.length === 0) {
    throw new Error('bootstrapV02Identity: name must be non-empty.');
  }
  const handle =
    input.handle && input.handle.trim().length > 0
      ? normaliseHandle(input.handle)
      : normaliseHandle(trimmedName);

  // 1. Ensure v02_agents row exists. Auto-create with display_name=name
  // when the handle has never been seen.
  let agent = v02Agents.getLiveAgentByHandle(handle);
  let agentWasCreated = false;
  if (!agent) {
    agent = v02Agents.createAgent({
      display_name: trimmedName,
      primary_handle: handle,
      owner_org: null
    });
    agentWasCreated = true;
    appendAuditEvent({
      kind: 'agent.created',
      entity_kind: 'agent',
      entity_id: agent.agent_id,
      actor_agent_id: agent.agent_id,
      actor_runtime_id: null,
      after_json: {
        display_name: agent.display_name,
        primary_handle: agent.primary_handle,
        via: 'v02-bootstrap-shim'
      }
    });
  }

  // 2. Resolve any existing live runtime — drives reclaim-vs-register
  // path. The structural unique index forces at-most-one live runtime
  // per agent, so this is either null or exactly one row.
  const priorLive = v02Runtimes.getLiveRuntimeForAgent(agent.agent_id);
  const pid_start_iso = pidStartToIso(input.pid_start);
  const challengeProof = `pre-v02-attestation:${input.legacy_terminal_id}`;
  const host = input.host ?? 'local';

  let runtime;
  if (priorLive) {
    // Atomic reclaim: old → 'reclaimed', new live runtime, pointer flip.
    runtime = v02Runtimes.reclaimRuntime({
      old_runtime_id: priorLive.runtime_id,
      new_runtime_input: {
        agent_id: agent.agent_id,
        host,
        pid: input.pid,
        pid_start_iso,
        tmux_pane: input.tmux_pane ?? null,
        cli_provider_id: input.cli_provider_id ?? null,
        register_challenge_proof: challengeProof
      }
    });
  } else {
    runtime = v02Runtimes.registerRuntime({
      agent_id: agent.agent_id,
      host,
      pid: input.pid,
      pid_start_iso,
      tmux_pane: input.tmux_pane ?? null,
      cli_provider_id: input.cli_provider_id ?? null,
      register_challenge_proof: challengeProof
    });
  }

  appendAuditEvent({
    kind: 'runtime.registered',
    entity_kind: 'runtime',
    entity_id: runtime.runtime_id,
    actor_agent_id: agent.agent_id,
    actor_runtime_id: runtime.runtime_id,
    after_json: {
      pid: runtime.pid,
      pid_start_iso: runtime.pid_start_iso,
      tmux_pane: runtime.tmux_pane,
      cli_provider_id: runtime.cli_provider_id,
      reclaimed_prior: priorLive?.runtime_id ?? null,
      legacy_terminal_id: input.legacy_terminal_id,
      via: 'v02-bootstrap-shim'
    }
  });

  return {
    agent_id: agent.agent_id,
    runtime_id: runtime.runtime_id,
    agent_was_created: agentWasCreated,
    prior_runtime_id: priorLive?.runtime_id ?? null
  };
}

/**
 * Resolve the v0.2 pair (agent_id, runtime_id) for a caller given
 * pidChain — wraps v02RuntimesStore.lookupRuntimeByPidChain. Returns
 * null if no live runtime matches. The chain MUST already have
 * pid_start values converted via pidStartToIso (or null, which is
 * treated as a wildcard).
 */
export function resolveV02ByPidChain(
  pidChain: { pid: number; pid_start: string | null }[]
): { agent_id: string; runtime_id: string } | null {
  if (pidChain.length === 0) return null;
  const normalised = pidChain.map((entry) => ({
    pid: entry.pid,
    // null is wildcard; preserved as null.
    pid_start_iso: entry.pid_start === null ? null : pidStartToIso(entry.pid_start)
  }));
  const runtime = v02Runtimes.lookupRuntimeByPidChain(normalised);
  if (!runtime) return null;
  return { agent_id: runtime.agent_id, runtime_id: runtime.runtime_id };
}
