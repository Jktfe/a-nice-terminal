/**
 * v02AgentsStore — the durable agent identity entity for v0.2.
 *
 * Schema (see ./db.ts V02_SCHEMA_DDL_STATEMENTS):
 *   v02_agents(agent_id, display_name, primary_handle, primary_trust_key_id?,
 *              status, owner_org?, current_runtime_id?, created_at_ms,
 *              reclaim_count)
 *
 * Replaces the LEGACY `terminal_records` table for the durable-identity
 * concern. terminal_records conflated identity-shape data (handle, name,
 * linked_chat_room_id) with runtime-shape data (allowlist, handle_aliases);
 * v0.2 splits these into v02_agents (identity) + v02_runtimes (ephemeral
 * pane binding).
 *
 * Identity-key state lives in PR #99's `identities` + `identity_keys`
 * tables — this store treats `v02_agents.primary_trust_key_id` as an
 * opaque FK into `identity_keys(key_id)`. Use `identityKeysStore.ts` to
 * mint / revoke / verify keys.
 *
 * Cross-cuts:
 * - handle resolution → derived from `primary_handle` (mirrors the legacy
 *   `terminal_records.handle` semantics)
 * - current runtime lookup → `current_runtime_id` is the pointer the
 *   fanout layer reads at send time. The structural invariant is that
 *   memberships do NOT cache this — see v02MembershipsStore.
 *
 * Cut-over PR (this file's commit): provides the agent-identity primitive
 * for v0.2-aware endpoint code. Legacy callers continue to consume
 * terminalRecordsStore.ts unmodified until the endpoint-flip PR.
 */

import { randomUUID } from 'node:crypto';
import { getIdentityDb } from './db';

export type V02AgentStatus = 'live' | 'archived' | 'deleted';

export type V02AgentRow = {
  agent_id: string;
  display_name: string;
  primary_handle: string;
  primary_trust_key_id: string | null;
  status: V02AgentStatus;
  owner_org: string | null;
  current_runtime_id: string | null;
  created_at_ms: number;
  reclaim_count: number;
};

export type CreateAgentInput = {
  display_name: string;
  primary_handle: string;
  owner_org?: string | null;
  primary_trust_key_id?: string | null;
  status?: V02AgentStatus;
};

function normalizeHandle(rawHandle: string): string {
  const trimmed = rawHandle.trim();
  if (trimmed.length === 0) return trimmed;
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

/**
 * Create a v0.2 agent. Returns the inserted row.
 *
 * Mirrors the legacy `createTerminalRecord` shape but writes to v02_agents
 * instead. handle is normalised to lead with '@'.
 *
 * Note: primary_trust_key_id may be NULL at creation — production flow is
 * (1) create agent, (2) mint identity_key via identityKeysStore, (3) flip
 * primary_trust_key_id pointer once first key is in place.
 */
export function createAgent(input: CreateAgentInput): V02AgentRow {
  const db = getIdentityDb();
  const agent_id = randomUUID();
  const now_ms = Date.now();
  const primary_handle = normalizeHandle(input.primary_handle);
  db.prepare(
    `INSERT INTO v02_agents
       (agent_id, display_name, primary_handle, primary_trust_key_id,
        status, owner_org, current_runtime_id, created_at_ms, reclaim_count)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 0)`
  ).run(
    agent_id,
    input.display_name,
    primary_handle,
    input.primary_trust_key_id ?? null,
    input.status ?? 'live',
    input.owner_org ?? null,
    now_ms
  );
  return getAgentById(agent_id) as V02AgentRow;
}

export function getAgentById(agent_id: string): V02AgentRow | null {
  const db = getIdentityDb();
  const row = db
    .prepare(`SELECT * FROM v02_agents WHERE agent_id = ?`)
    .get(agent_id) as V02AgentRow | undefined;
  return row ?? null;
}

/**
 * Resolve agent by primary_handle. Normalises the leading '@'. Returns the
 * MOST-RECENTLY-created live agent if multiple match (handles aren't
 * UNIQUE on the table — v0.2 deliberately allows handle reuse after an
 * agent is archived, mirroring legacy `terminal_records` permissiveness).
 *
 * For strict uniqueness on live agents, use {@link getLiveAgentByHandle}.
 */
export function getAgentByHandle(handle: string): V02AgentRow | null {
  const db = getIdentityDb();
  const normalised = normalizeHandle(handle);
  const row = db
    .prepare(
      `SELECT * FROM v02_agents
        WHERE primary_handle = ?
        ORDER BY created_at_ms DESC
        LIMIT 1`
    )
    .get(normalised) as V02AgentRow | undefined;
  return row ?? null;
}

/**
 * Same as {@link getAgentByHandle} but constrained to status='live'.
 * Use this for the "is this handle in use right now" check.
 */
export function getLiveAgentByHandle(handle: string): V02AgentRow | null {
  const db = getIdentityDb();
  const normalised = normalizeHandle(handle);
  const row = db
    .prepare(
      `SELECT * FROM v02_agents
        WHERE primary_handle = ? AND status = 'live'
        ORDER BY created_at_ms DESC
        LIMIT 1`
    )
    .get(normalised) as V02AgentRow | undefined;
  return row ?? null;
}

export function listAgents(): V02AgentRow[] {
  const db = getIdentityDb();
  return db
    .prepare(`SELECT * FROM v02_agents ORDER BY created_at_ms DESC`)
    .all() as V02AgentRow[];
}

export function listLiveAgents(): V02AgentRow[] {
  const db = getIdentityDb();
  return db
    .prepare(`SELECT * FROM v02_agents WHERE status = 'live' ORDER BY created_at_ms DESC`)
    .all() as V02AgentRow[];
}

/**
 * Flip an agent's status. Idempotent.
 *
 * Status semantics (mirrors v0.2 spec §The 11 Tables, agents row):
 *   - 'live'     → recoverable + bindable (default)
 *   - 'archived' → owner explicitly archived; not auto-selected for new
 *                  bindings but rows + audit trail preserved
 *   - 'deleted'  → tombstone; never resurfaces in any listing
 */
export function setAgentStatus(agent_id: string, status: V02AgentStatus): boolean {
  const db = getIdentityDb();
  const info = db
    .prepare(`UPDATE v02_agents SET status = ? WHERE agent_id = ?`)
    .run(status, agent_id);
  return info.changes > 0;
}

/**
 * Update v02_agents.current_runtime_id pointer. THE fanout-target write
 * path. Called by the runtime lifecycle code on register / reclaim /
 * runtime-archive transitions.
 *
 * The structural invariant — "fanout target is derived from
 * agents.current_runtime_id at send time, NEVER cached on the membership
 * row" — depends on this pointer being authoritative. See v0.2 spec
 * §Three Structural Invariants #3 + v02-schema.test.ts §"fanout target
 * derives from agents.current_runtime_id".
 */
export function setCurrentRuntimeId(
  agent_id: string,
  runtime_id: string | null
): boolean {
  const db = getIdentityDb();
  const info = db
    .prepare(`UPDATE v02_agents SET current_runtime_id = ? WHERE agent_id = ?`)
    .run(runtime_id, agent_id);
  return info.changes > 0;
}

/**
 * Increment reclaim_count. Atomic + idempotent (well, monotonically
 * increasing — not idempotent in the strict sense, but a no-op-on-missing
 * agent_id). Called by the reclaim flow after a successful runtime swap.
 */
export function incrementReclaimCount(agent_id: string): number {
  const db = getIdentityDb();
  const info = db
    .prepare(`UPDATE v02_agents SET reclaim_count = reclaim_count + 1 WHERE agent_id = ?`)
    .run(agent_id);
  if (info.changes === 0) return 0;
  const row = db
    .prepare(`SELECT reclaim_count FROM v02_agents WHERE agent_id = ?`)
    .get(agent_id) as { reclaim_count: number } | undefined;
  return row?.reclaim_count ?? 0;
}

/**
 * Update primary_trust_key_id pointer at the v02_agents layer. The actual
 * key minting / revocation lives in identityKeysStore (PR #99).
 *
 * Set to NULL when revoking the last primary key without a replacement —
 * agents.status will typically flip to 'archived' shortly thereafter.
 */
export function setPrimaryTrustKeyId(
  agent_id: string,
  identity_key_id: string | null
): boolean {
  const db = getIdentityDb();
  const info = db
    .prepare(
      `UPDATE v02_agents SET primary_trust_key_id = ? WHERE agent_id = ?`
    )
    .run(identity_key_id, agent_id);
  return info.changes > 0;
}
