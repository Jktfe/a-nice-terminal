/**
 * auditEventsStore — typed wrapper around the canonical v0.2
 * `audit_events` table (schema in src/lib/server/db.ts §audit_events).
 *
 * PATH 3 / M7.1: no schema change. The two pre-existing inline helpers
 * in `v02ChatRoomBridge.ts` and `v02RegisterBootstrap.ts` should
 * import `appendAuditEvent` from here so the kind/entity model stays
 * consistent on a single surface.
 *
 * Adds:
 *   - `appendAuditEvent`: typed insert + camelCase return.
 *   - `listAuditEvents`: filtered + cursor-paginated read, stable
 *     ordering (at_ms ASC, audit_id ASC) which survives multiple
 *     inserts in the same millisecond.
 *   - `countAuditEvents`: total under the same filter shape.
 *   - `asAuditEventSource`: factory matching @enterprisec's M1.3
 *     dispatcher contract (`AuditEventSource.listSince(sinceMs,
 *     limit) -> AuditEventRow[]` with snake_case rows, see
 *     `byWormEnvelopeBuilder.ts` in branch
 *     `enterprisec/m13-audit-dispatcher`).
 *
 * The `entity_kind` CHECK constraint (db.ts:2389-2394) is NOT extended
 * here; if M6 RBAC + M7.2 SIEM need a `role` / `role_assignment` /
 * `org` entity_kind they should land via a table-rebuild migration in
 * a future slice. Existing CHECK values: agent, runtime, room,
 * membership, tool_grant, identity, identity_key, recovery_grant,
 * permission_request, pending_action, reclaim_request,
 * user_room_preference, user_panel_pin, system.
 */

import { randomUUID } from 'node:crypto';

// Process-monotonic counter so same-millisecond inserts get distinct,
// lex-sortable audit_ids. Format: <13-digit at_ms>-<8-digit counter>-<random suffix>.
// This makes ORDER BY audit_id ASC equivalent to insertion order within
// the process, and at_ms-prefix ordering correct across processes.
// Matches @enterprisec's M1.3 dispatcher contract assumption that
// audit_id is monotonic (BIG ANT msg_ol9vzm957t).
let auditIdCounter = 0;
function generateMonotonicAuditId(atMs: number): string {
  auditIdCounter = (auditIdCounter + 1) & 0xffffffff;
  const counterStr = auditIdCounter.toString(10).padStart(8, '0');
  const atMsStr = String(atMs).padStart(13, '0');
  const random = randomUUID().slice(0, 8);
  return `${atMsStr}-${counterStr}-${random}`;
}
import { getIdentityDb } from './db';

/** Canonical typed shape returned to callers (camelCase). */
export type AuditEvent = {
  auditId: string;
  atMs: number;
  kind: string;
  entityKind: string;
  entityId: string;
  actorAgentId: string | null;
  actorRuntimeId: string | null;
  beforeJson: string | null;
  afterJson: string | null;
  requestId: string | null;
  ipHash: string | null;
  challengeProof: string | null;
};

/** Raw snake_case row matching the DB schema exactly. */
type AuditEventRow = {
  audit_id: string;
  at_ms: number;
  kind: string;
  entity_kind: string;
  entity_id: string;
  actor_agent_id: string | null;
  actor_runtime_id: string | null;
  before_json: string | null;
  after_json: string | null;
  request_id: string | null;
  ip_hash: string | null;
  challenge_proof: string | null;
};

export type AppendAuditEventInput = {
  kind: string;
  entityKind: string;
  entityId: string;
  actorAgentId?: string | null;
  actorRuntimeId?: string | null;
  before?: Record<string, unknown> | string | null;
  after?: Record<string, unknown> | string | null;
  requestId?: string | null;
  ipHash?: string | null;
  challengeProof?: string | null;
};

export type AuditEventFilter = {
  cursor?: string | null;
  limit?: number;
  kind?: string;
  entityKind?: string;
  entityId?: string;
  actorAgentId?: string;
  since?: number;
  until?: number;
};

export type ListAuditEventsResult = {
  events: AuditEvent[];
  nextCursor: string | null;
};

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

function stringifyJson(value: AppendAuditEventInput['before']): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function rowToEvent(row: AuditEventRow): AuditEvent {
  return {
    auditId: row.audit_id,
    atMs: row.at_ms,
    kind: row.kind,
    entityKind: row.entity_kind,
    entityId: row.entity_id,
    actorAgentId: row.actor_agent_id,
    actorRuntimeId: row.actor_runtime_id,
    beforeJson: row.before_json,
    afterJson: row.after_json,
    requestId: row.request_id,
    ipHash: row.ip_hash,
    challengeProof: row.challenge_proof
  };
}

/**
 * Append an event. Generates `auditId` (crypto.randomUUID) +
 * `atMs` (Date.now). Object payloads are JSON-stringified; strings
 * are inserted verbatim (caller is responsible for JSON shape).
 */
export function appendAuditEvent(input: AppendAuditEventInput): AuditEvent {
  const db = getIdentityDb();
  const atMs = Date.now();
  const auditId = generateMonotonicAuditId(atMs);
  const beforeJson = stringifyJson(input.before ?? null);
  const afterJson = stringifyJson(input.after ?? null);
  const actorAgentId = input.actorAgentId ?? null;
  const actorRuntimeId = input.actorRuntimeId ?? null;
  const requestId = input.requestId ?? null;
  const ipHash = input.ipHash ?? null;
  const challengeProof = input.challengeProof ?? null;

  db.prepare(
    `INSERT INTO audit_events
       (audit_id, at_ms, kind, entity_kind, entity_id,
        actor_agent_id, actor_runtime_id, before_json, after_json,
        request_id, ip_hash, challenge_proof)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    auditId,
    atMs,
    input.kind,
    input.entityKind,
    input.entityId,
    actorAgentId,
    actorRuntimeId,
    beforeJson,
    afterJson,
    requestId,
    ipHash,
    challengeProof
  );

  return {
    auditId,
    atMs,
    kind: input.kind,
    entityKind: input.entityKind,
    entityId: input.entityId,
    actorAgentId,
    actorRuntimeId,
    beforeJson,
    afterJson,
    requestId,
    ipHash,
    challengeProof
  };
}

type WhereClause = { sql: string; params: unknown[] };

function buildWhere(filter: AuditEventFilter, cursor: ParsedCursor | null): WhereClause {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.kind !== undefined) {
    clauses.push('kind = ?');
    params.push(filter.kind);
  }
  if (filter.entityKind !== undefined) {
    clauses.push('entity_kind = ?');
    params.push(filter.entityKind);
  }
  if (filter.entityId !== undefined) {
    clauses.push('entity_id = ?');
    params.push(filter.entityId);
  }
  if (filter.actorAgentId !== undefined) {
    clauses.push('actor_agent_id = ?');
    params.push(filter.actorAgentId);
  }
  if (filter.since !== undefined) {
    clauses.push('at_ms >= ?');
    params.push(filter.since);
  }
  if (filter.until !== undefined) {
    clauses.push('at_ms <= ?');
    params.push(filter.until);
  }
  if (cursor) {
    // Strict tuple comparison so the next page starts strictly AFTER
    // the cursor anchor — works even with multiple inserts at the
    // same at_ms because audit_id is the tiebreaker.
    clauses.push('(at_ms > ? OR (at_ms = ? AND audit_id > ?))');
    params.push(cursor.atMs, cursor.atMs, cursor.auditId);
  }
  return {
    sql: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    params
  };
}

type ParsedCursor = { atMs: number; auditId: string };

function parseCursor(raw: string | null | undefined): ParsedCursor | null {
  if (!raw) return null;
  const underscoreIdx = raw.indexOf('_');
  if (underscoreIdx <= 0 || underscoreIdx === raw.length - 1) return null;
  const atMsStr = raw.slice(0, underscoreIdx);
  const auditId = raw.slice(underscoreIdx + 1);
  const atMs = Number(atMsStr);
  if (!Number.isFinite(atMs)) return null;
  return { atMs, auditId };
}

function formatCursor(event: AuditEvent): string {
  return `${event.atMs}_${event.auditId}`;
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

export function listAuditEvents(filter: AuditEventFilter = {}): ListAuditEventsResult {
  const db = getIdentityDb();
  const limit = clampLimit(filter.limit);
  const cursor = parseCursor(filter.cursor);
  const where = buildWhere(filter, cursor);
  // audit_id is monotonic per `generateMonotonicAuditId` (at_ms-prefixed
  // + process-monotonic counter), so ORDER BY (at_ms, audit_id) gives
  // insertion order within process AND matches @enterprisec's M1.3
  // dispatcher contract.
  const rows = db
    .prepare(
      `SELECT audit_id, at_ms, kind, entity_kind, entity_id,
              actor_agent_id, actor_runtime_id, before_json, after_json,
              request_id, ip_hash, challenge_proof
         FROM audit_events
         ${where.sql}
         ORDER BY at_ms ASC, audit_id ASC
         LIMIT ?`
    )
    .all(...where.params, limit + 1) as AuditEventRow[];

  const events = rows.slice(0, limit).map(rowToEvent);
  const hasMore = rows.length > limit;
  const nextCursor = hasMore && events.length > 0 ? formatCursor(events[events.length - 1]) : null;
  return { events, nextCursor };
}

export function countAuditEvents(filter: AuditEventFilter = {}): number {
  const db = getIdentityDb();
  const where = buildWhere(filter, null);
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM audit_events ${where.sql}`)
    .get(...where.params) as { n: number };
  return row.n;
}

/**
 * Factory returning an object that matches @enterprisec's M1.3
 * dispatcher `AuditEventSource` interface (see
 * `byWormEnvelopeBuilder.ts` in branch
 * `enterprisec/m13-audit-dispatcher`):
 *
 *   interface AuditEventSource {
 *     listSince(sinceMs: number, limit: number): AuditEventRow[];
 *   }
 *
 * Returns snake_case rows ordered by (at_ms ASC, audit_id ASC). audit_id
 * is monotonic per `generateMonotonicAuditId` so same-millisecond inserts
 * surface in insertion order. Uses STRICT-greater-than `at_ms > sinceMs`
 * semantics as the dispatcher spec requires (so the dispatcher can pass
 * the last-seen at_ms back and not double-process).
 */
export function asAuditEventSource(): {
  listSince(sinceMs: number, limit: number): AuditEventRow[];
} {
  return {
    listSince(sinceMs: number, limit: number): AuditEventRow[] {
      const db = getIdentityDb();
      const effectiveLimit = clampLimit(limit);
      return db
        .prepare(
          `SELECT audit_id, at_ms, kind, entity_kind, entity_id,
                  actor_agent_id, actor_runtime_id, before_json, after_json,
                  request_id, ip_hash, challenge_proof
             FROM audit_events
            WHERE at_ms > ?
            ORDER BY at_ms ASC, audit_id ASC
            LIMIT ?`
        )
        .all(sinceMs, effectiveLimit) as AuditEventRow[];
    }
  };
}
