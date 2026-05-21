import { randomUUID } from 'node:crypto';
import { getIdentityDb } from './db';

/**
 * General consent grants are room-scoped in V1.
 *
 * - granted_to is a room handle, normalized to a leading @. It is not a
 *   terminal id or mixed subject type in this slice.
 * - topic is normalized to lowercase text at write and consume time.
 * - source_set is stored as a JSON string array. Empty array means the
 *   grant can satisfy operations that do not declare a source; if a write
 *   path declares consentSource, that source must be present in the array.
 * - The enforcement gate is authoritative: it checks status, expiry, and
 *   answer budget before an atomic consume update. Stored status is kept
 *   current lazily on list/consume for expiry, and eagerly on consume for
 *   exhaustion.
 */

export type ConsentGrantStatus = 'active' | 'revoked' | 'expired' | 'exhausted';
export type ConsentGrantAuditAction = 'created' | 'consumed' | 'revoked' | 'expired' | 'exhausted';

export type ConsentGrantAuditEntry = {
  action: ConsentGrantAuditAction;
  actorHandle: string | null;
  atMs: number;
  note: string | null;
};

export type ConsentGrant = {
  id: string;
  roomId: string;
  grantedTo: string;
  topic: string;
  sourceSet: string[];
  duration: string;
  answerCount: number;
  maxAnswers: number | null;
  status: ConsentGrantStatus;
  grantedAtMs: number;
  expiresAtMs: number | null;
  createdBy: string | null;
  revokedAtMs: number | null;
  revokedBy: string | null;
  updatedAtMs: number;
  auditTrail: ConsentGrantAuditEntry[];
};

type ConsentGrantRow = {
  id: string;
  room_id: string;
  granted_to: string;
  topic: string;
  source_set: string;
  duration: string;
  answer_count: number;
  max_answers: number | null;
  status: ConsentGrantStatus;
  granted_at_ms: number;
  expires_at_ms: number | null;
  created_by: string | null;
  revoked_at_ms: number | null;
  revoked_by: string | null;
  updated_at_ms: number;
};

type AuditRow = {
  action: ConsentGrantAuditAction;
  actor_handle: string | null;
  at_ms: number;
  note: string | null;
};

export type CreateConsentGrantInput = {
  roomId: string;
  grantedTo: string;
  topic: string;
  sourceSet?: string[];
  duration?: string;
  maxAnswers?: number | null;
  createdBy?: string | null;
};

export type ListConsentGrantOptions = {
  roomId?: string;
  grantedTo?: string;
  topic?: string;
  status?: ConsentGrantStatus;
  includeInactive?: boolean;
};

export type ConsumeConsentGrantResult =
  | { allowed: true; grant: ConsentGrant }
  | {
      allowed: false;
      reason: 'not_found' | 'room' | 'grantee' | 'topic' | 'source' | 'revoked' | 'expired' | 'exhausted';
      grantId?: string;
    };

function makeGrantId(): string {
  return `cg_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

function normaliseHandle(rawHandle: string): string {
  const trimmed = rawHandle.trim();
  if (trimmed.length === 0) throw new Error('grantedTo is required');
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

function normaliseTopic(rawTopic: string): string {
  return normaliseRequiredText(rawTopic, 'topic').toLowerCase();
}

function normaliseRequiredText(value: string, field: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new Error(`${field} is required`);
  return trimmed;
}

function parseDurationToMs(duration: string): number | null {
  const trimmed = duration.trim().toLowerCase();
  if (trimmed === 'never' || trimmed === 'indefinite') return null;
  const match = trimmed.match(/^(\d+)(ms|s|m|h|d)$/);
  if (!match) throw new Error('duration must look like 15m, 1h, 7d, or never');
  const amount = Number(match[1]);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000
  };
  return amount * multipliers[unit];
}

function parseSourceSet(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

function auditRowsForGrant(grantId: string): ConsentGrantAuditEntry[] {
  const rows = getIdentityDb()
    .prepare(`SELECT action, actor_handle, at_ms, note
              FROM consent_grant_audit WHERE grant_id = ? ORDER BY at_ms ASC, id ASC`)
    .all(grantId) as AuditRow[];
  return rows.map((row) => ({
    action: row.action,
    actorHandle: row.actor_handle,
    atMs: row.at_ms,
    note: row.note
  }));
}

function rowToGrant(row: ConsentGrantRow): ConsentGrant {
  return {
    id: row.id,
    roomId: row.room_id,
    grantedTo: row.granted_to,
    topic: row.topic,
    sourceSet: parseSourceSet(row.source_set),
    duration: row.duration,
    answerCount: row.answer_count,
    maxAnswers: row.max_answers,
    status: row.status,
    grantedAtMs: row.granted_at_ms,
    expiresAtMs: row.expires_at_ms,
    createdBy: row.created_by,
    revokedAtMs: row.revoked_at_ms,
    revokedBy: row.revoked_by,
    updatedAtMs: row.updated_at_ms,
    auditTrail: auditRowsForGrant(row.id)
  };
}

function insertAudit(grantId: string, action: ConsentGrantAuditAction, actorHandle?: string | null, note?: string | null): void {
  getIdentityDb()
    .prepare(`INSERT INTO consent_grant_audit (grant_id, action, actor_handle, at_ms, note)
              VALUES (?, ?, ?, ?, ?)`)
    .run(grantId, action, actorHandle ?? null, Date.now(), note ?? null);
}

function getGrantRow(id: string): ConsentGrantRow | undefined {
  return getIdentityDb().prepare(`SELECT * FROM consent_grants WHERE id = ?`).get(id) as
    | ConsentGrantRow
    | undefined;
}

function markExpiredGrants(nowMs = Date.now()): void {
  const rows = getIdentityDb()
    .prepare(`SELECT id FROM consent_grants
              WHERE status = 'active' AND expires_at_ms IS NOT NULL AND expires_at_ms <= ?`)
    .all(nowMs) as { id: string }[];
  if (rows.length === 0) return;
  const db = getIdentityDb();
  const txn = db.transaction(() => {
    for (const row of rows) {
      db.prepare(`UPDATE consent_grants SET status = 'expired', updated_at_ms = ? WHERE id = ?`)
        .run(nowMs, row.id);
      insertAudit(row.id, 'expired', null, 'duration elapsed');
    }
  });
  txn();
}

export function createConsentGrant(input: CreateConsentGrantInput): ConsentGrant {
  const roomId = normaliseRequiredText(input.roomId, 'roomId');
  const grantedTo = normaliseHandle(input.grantedTo);
  const topic = normaliseTopic(input.topic);
  const duration = input.duration?.trim() || '1h';
  const durationMs = parseDurationToMs(duration);
  const nowMs = Date.now();
  const maxAnswers = input.maxAnswers === undefined ? null : input.maxAnswers;
  if (maxAnswers !== null && (!Number.isInteger(maxAnswers) || maxAnswers <= 0)) {
    throw new Error('maxAnswers must be a positive integer when present');
  }
  const sourceSet = (input.sourceSet ?? [])
    .filter((source) => typeof source === 'string')
    .map((source) => source.trim())
    .filter((source) => source.length > 0);
  const id = makeGrantId();
  const db = getIdentityDb();
  const txn = db.transaction(() => {
    db.prepare(`INSERT INTO consent_grants (
      id, room_id, granted_to, topic, source_set, duration, answer_count,
      max_answers, status, granted_at_ms, expires_at_ms, created_by,
      revoked_at_ms, revoked_by, updated_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'active', ?, ?, ?, NULL, NULL, ?)`).run(
      id,
      roomId,
      grantedTo,
      topic,
      JSON.stringify(sourceSet),
      duration,
      maxAnswers,
      nowMs,
      durationMs === null ? null : nowMs + durationMs,
      input.createdBy ?? null,
      nowMs
    );
    insertAudit(id, 'created', input.createdBy ?? null);
  });
  txn();
  const row = getGrantRow(id);
  if (!row) throw new Error('createConsentGrant: row not found after insert.');
  return rowToGrant(row);
}

export function listConsentGrants(options: ListConsentGrantOptions = {}): ConsentGrant[] {
  markExpiredGrants();
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (options.roomId !== undefined) {
    clauses.push('room_id = ?');
    params.push(options.roomId);
  }
  if (options.grantedTo !== undefined) {
    clauses.push('granted_to = ?');
    params.push(normaliseHandle(options.grantedTo));
  }
  if (options.topic !== undefined) {
    clauses.push('topic = ?');
    params.push(normaliseTopic(options.topic));
  }
  if (options.status !== undefined) {
    clauses.push('status = ?');
    params.push(options.status);
  } else if (options.includeInactive !== true) {
    clauses.push(`status = 'active'`);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = getIdentityDb()
    .prepare(`SELECT * FROM consent_grants ${where} ORDER BY granted_at_ms DESC`)
    .all(...params) as ConsentGrantRow[];
  return rows.map(rowToGrant);
}

export function revokeConsentGrant(id: string, actorHandle?: string | null): ConsentGrant | null {
  markExpiredGrants();
  const row = getGrantRow(id);
  if (!row) return null;
  if (row.status !== 'revoked') {
    const nowMs = Date.now();
    getIdentityDb()
      .prepare(`UPDATE consent_grants
                SET status = 'revoked', revoked_at_ms = ?, revoked_by = ?, updated_at_ms = ?
                WHERE id = ?`)
      .run(nowMs, actorHandle ?? null, nowMs, id);
    insertAudit(id, 'revoked', actorHandle ?? null);
  }
  const next = getGrantRow(id);
  return next ? rowToGrant(next) : null;
}

export function consumeConsentGrant(input: {
  roomId: string;
  grantedTo: string;
  topic: string;
  source?: string | null;
  actorHandle?: string | null;
}): ConsumeConsentGrantResult {
  markExpiredGrants();
  const grantedTo = normaliseHandle(input.grantedTo);
  const allForGrantee = listConsentGrants({ grantedTo, includeInactive: true });
  if (allForGrantee.length === 0) return { allowed: false, reason: 'grantee' };
  const roomMatches = allForGrantee.filter((grant) => grant.roomId === input.roomId);
  if (roomMatches.length === 0) return { allowed: false, reason: 'room', grantId: allForGrantee[0].id };
  const topic = normaliseTopic(input.topic);
  const topicMatches = roomMatches.filter((grant) => grant.topic === topic);
  if (topicMatches.length === 0) return { allowed: false, reason: 'topic', grantId: roomMatches[0].id };
  const source = input.source?.trim() ?? '';
  const sourceMatches = topicMatches.filter((grant) => {
    if (grant.sourceSet.length === 0) return source.length === 0;
    return source.length > 0 && grant.sourceSet.includes(source);
  });
  if (sourceMatches.length === 0) return { allowed: false, reason: 'source', grantId: topicMatches[0].id };
  const grant = sourceMatches[0];
  if (grant.status === 'revoked') return { allowed: false, reason: 'revoked', grantId: grant.id };
  if (grant.status === 'expired') return { allowed: false, reason: 'expired', grantId: grant.id };
  if (grant.status === 'exhausted') return { allowed: false, reason: 'exhausted', grantId: grant.id };

  const nowMs = Date.now();
  const db = getIdentityDb();
  let raceLostStatus: ConsentGrantStatus | null = null;
  const txn = db.transaction(() => {
    const info = db
      .prepare(`UPDATE consent_grants
                SET answer_count = answer_count + 1,
                    status = CASE
                      WHEN max_answers IS NOT NULL AND answer_count + 1 >= max_answers
                      THEN 'exhausted'
                      ELSE 'active'
                    END,
                    updated_at_ms = ?
                WHERE id = ?
                  AND status = 'active'
                  AND (expires_at_ms IS NULL OR expires_at_ms > ?)
                  AND (max_answers IS NULL OR answer_count < max_answers)`)
      .run(nowMs, grant.id, nowMs);
    if (info.changes === 0) {
      raceLostStatus = getGrantRow(grant.id)?.status ?? null;
      return;
    }
    insertAudit(grant.id, 'consumed', input.actorHandle ?? null, input.source ?? null);
    const updated = getGrantRow(grant.id);
    if (updated?.status === 'exhausted') {
      insertAudit(grant.id, 'exhausted', input.actorHandle ?? null);
    }
  });
  txn();
  if (raceLostStatus !== null) {
    if (raceLostStatus === 'revoked') return { allowed: false, reason: 'revoked', grantId: grant.id };
    if (raceLostStatus === 'expired') return { allowed: false, reason: 'expired', grantId: grant.id };
    return { allowed: false, reason: 'exhausted', grantId: grant.id };
  }
  const row = getGrantRow(grant.id);
  if (!row) return { allowed: false, reason: 'not_found', grantId: grant.id };
  return { allowed: true, grant: rowToGrant(row) };
}

export function resetConsentGrantStoreForTests(): void {
  const db = getIdentityDb();
  db.prepare('DELETE FROM consent_grant_audit').run();
  db.prepare('DELETE FROM consent_grants').run();
}
