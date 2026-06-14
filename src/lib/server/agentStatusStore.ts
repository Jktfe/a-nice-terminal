/**
 * agentStatusStore — rich agent status (M3.4a-v2).
 *
 * Schema (see ./db.ts SCHEMA_DDL_STATEMENTS):
 *   terminals.agent_status        TEXT, one of idle/thinking/working/response-required
 *   terminals.agent_status_source TEXT, one of fingerprint/hook/ant-activity/pid-cpu/default
 *   terminals.agent_status_at_ms  INTEGER, when the current status was set
 *   chat_agent_status_events      append-only transition log
 *
 * setAgentStatus is ATOMIC: writes the terminals row + appends the events row
 * inside a single db.transaction so callers cannot observe split state. The
 * event row preserves prev_status so the transition history is reconstructable
 * without reading two snapshots.
 *
 * v1 (per contract Q9): agent_status is parallel to pane_status, NOT a
 * replacement. pane_status is M3.4a-v1 delivery state; agent_status is
 * M3.4a-v2 attention state. Both columns coexist on terminals.
 */

import { getIdentityDb } from './db';

export type AgentStatus = 'idle' | 'thinking' | 'working' | 'response-required';
// 'pane' = pane-label re-promotion (feat/status-cascade 2026-06-10): the CLI's
// own rendered status-strip label (paneStatusParser source==='label') observed
// by the poller. Same trust tier as a hook event — the CLI asserted it, we
// just read it off the pane instead of receiving a POST.
// 'helper' = relayed by the antAppHelper on a handle's behalf (Picture 3,
// 2026-06-15): a paneless agent can't post its own status, so its bound helper
// relays it (lease + postStatus scope gated). Same assert-tier as a hook.
export type AgentStatusSource = 'fingerprint' | 'hook' | 'pane' | 'ant-activity' | 'pid-cpu' | 'default' | 'helper';

export type AgentStatusRow = {
  terminal_id: string;
  agent_status: AgentStatus;
  agent_status_source: AgentStatusSource;
  agent_status_at_ms: number;
};

export type AgentStatusEvent = {
  id: number;
  terminal_id: string;
  prev_status: AgentStatus | null;
  new_status: AgentStatus;
  source: AgentStatusSource;
  changed_at_ms: number;
  evidence_json: string | null;
};

const ALLOWED_STATUSES: readonly AgentStatus[] = ['idle', 'thinking', 'working', 'response-required'];
const ALLOWED_SOURCES: readonly AgentStatusSource[] = ['fingerprint', 'hook', 'pane', 'ant-activity', 'pid-cpu', 'default', 'helper'];

export function isAllowedAgentStatus(value: unknown): value is AgentStatus {
  return typeof value === 'string' && (ALLOWED_STATUSES as readonly string[]).includes(value);
}

export function isAllowedAgentStatusSource(value: unknown): value is AgentStatusSource {
  return typeof value === 'string' && (ALLOWED_SOURCES as readonly string[]).includes(value);
}

export function getAgentStatus(terminalId: string): AgentStatusRow | null {
  const db = getIdentityDb();
  const row = db
    .prepare(`SELECT id, agent_status, agent_status_source, agent_status_at_ms FROM terminals WHERE id = ?`)
    .get(terminalId) as
    | { id: string; agent_status: AgentStatus; agent_status_source: AgentStatusSource; agent_status_at_ms: number }
    | undefined;
  if (!row) return null;
  return {
    terminal_id: row.id,
    agent_status: row.agent_status,
    agent_status_source: row.agent_status_source,
    agent_status_at_ms: row.agent_status_at_ms
  };
}

export type SetAgentStatusInput = {
  terminalId: string;
  newStatus: AgentStatus;
  source: AgentStatusSource;
  evidence?: Record<string, unknown> | null;
  nowMs?: number;
};

export function setAgentStatus(input: SetAgentStatusInput): AgentStatusRow {
  if (!isAllowedAgentStatus(input.newStatus)) {
    throw new Error(`agent_status must be one of: ${ALLOWED_STATUSES.join(', ')}`);
  }
  if (!isAllowedAgentStatusSource(input.source)) {
    throw new Error(`agent_status_source must be one of: ${ALLOWED_SOURCES.join(', ')}`);
  }
  const db = getIdentityDb();
  const nowMs = input.nowMs ?? Date.now();
  const evidenceJson = input.evidence !== undefined && input.evidence !== null
    ? JSON.stringify(input.evidence)
    : null;

  const txn = db.transaction(() => {
    const existing = db
      .prepare(`SELECT agent_status FROM terminals WHERE id = ?`)
      .get(input.terminalId) as { agent_status: AgentStatus } | undefined;
    if (!existing) {
      throw new Error(`terminal ${input.terminalId} not found`);
    }
    db.prepare(`UPDATE terminals
      SET agent_status = ?, agent_status_source = ?, agent_status_at_ms = ?
      WHERE id = ?`).run(input.newStatus, input.source, nowMs, input.terminalId);
    db.prepare(`INSERT INTO chat_agent_status_events
      (terminal_id, prev_status, new_status, source, changed_at_ms, evidence_json)
      VALUES (?, ?, ?, ?, ?, ?)`).run(
      input.terminalId,
      existing.agent_status,
      input.newStatus,
      input.source,
      nowMs,
      evidenceJson
    );
  });
  txn();
  return {
    terminal_id: input.terminalId,
    agent_status: input.newStatus,
    agent_status_source: input.source,
    agent_status_at_ms: nowMs
  };
}

export function refreshAgentStatusAtMs(terminalId: string, nowMs: number = Date.now()): void {
  const db = getIdentityDb();
  db.transaction(() => {
    db.prepare(`UPDATE terminals
      SET agent_status_at_ms = ?
      WHERE id = ?`).run(nowMs, terminalId);
  })();
}

export function listEventsForTerminal(terminalId: string): AgentStatusEvent[] {
  const db = getIdentityDb();
  const rows = db
    .prepare(`SELECT id, terminal_id, prev_status, new_status, source, changed_at_ms, evidence_json
              FROM chat_agent_status_events WHERE terminal_id = ?
              ORDER BY changed_at_ms DESC, id DESC`)
    .all(terminalId) as AgentStatusEvent[];
  return rows;
}
