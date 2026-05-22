/**
 * Plan Mode store — append-only event log for tracked initiatives.
 *
 * Source: in-room Plan Mode Contract §1-§6 (PASS-confirmed by @codex2 as
 * read-only reference, 2026-05-12). Implements the §2 typed event shape,
 * §3 projection rules, and §1 identity-key derivation.
 *
 * Append-only writes; revisions made by appending a new event with the
 * same identity key and a newer ts_millis. Projection returns the latest
 * event per identity key, sorted by parent_id then order.
 *
 * Persistence: SQLite-backed via getIdentityDb (JWPK msg_71divtsj8r
 * ratified ask_r0v3b4t — plan events must survive launchd kickstart).
 * Schema lives in db.ts (plan_events table). The in-process row shape
 * keeps `order` as the public field name; the DB column is `order_index`
 * to dodge the SQL reserved word, mapped at the store boundary.
 */

import { getIdentityDb } from './db';

export type PlanEventKind =
  | 'plan_section'
  | 'plan_decision'
  | 'plan_milestone'
  | 'plan_acceptance'
  | 'plan_test';

export type PlanStatus =
  | 'planned'
  | 'active'
  | 'blocked'
  | 'passing'
  | 'failing'
  | 'done'
  | 'archived';

export type PlanAuthorKind = 'agent' | 'human' | 'system';

export type EvidenceRef = {
  kind: 'run_event' | 'task' | 'url' | 'file' | 'chat_message' | 'proposal';
  ref: string;
  label?: string;
  narration?: string;
};

export type ProvenanceRef = {
  chat_message_id?: string;
  source?: string;
  author?: string;
  section?: string;
};

export type PlanEvent = {
  id: string;
  plan_id: string;
  parent_id?: string;
  kind: PlanEventKind;
  title: string;
  body?: string;
  status?: PlanStatus;
  owner?: string;
  milestone_id?: string;
  acceptance_id?: string;
  order: number;
  author_handle: string;
  author_kind: PlanAuthorKind;
  ts_millis: number;
  evidence: EvidenceRef[];
  provenance?: ProvenanceRef;
};

type PlanEventRow = {
  id: string;
  plan_id: string;
  parent_id: string | null;
  kind: PlanEventKind;
  title: string;
  body: string | null;
  status: PlanStatus | null;
  owner: string | null;
  milestone_id: string | null;
  acceptance_id: string | null;
  order_index: number;
  author_handle: string;
  author_kind: PlanAuthorKind;
  ts_millis: number;
  evidence_json: string;
  provenance_json: string | null;
};

function rowToEvent(row: PlanEventRow): PlanEvent {
  let evidence: EvidenceRef[];
  try {
    const parsed = JSON.parse(row.evidence_json);
    evidence = Array.isArray(parsed) ? (parsed as EvidenceRef[]) : [];
  } catch {
    evidence = [];
  }
  let provenance: ProvenanceRef | undefined;
  if (row.provenance_json) {
    try {
      const parsed = JSON.parse(row.provenance_json);
      if (parsed && typeof parsed === 'object') provenance = parsed as ProvenanceRef;
    } catch {
      /* malformed JSON — drop the provenance, keep the event */
    }
  }
  const event: PlanEvent = {
    id: row.id,
    plan_id: row.plan_id,
    kind: row.kind,
    title: row.title,
    order: row.order_index,
    author_handle: row.author_handle,
    author_kind: row.author_kind,
    ts_millis: row.ts_millis,
    evidence
  };
  if (row.parent_id !== null) event.parent_id = row.parent_id;
  if (row.body !== null) event.body = row.body;
  if (row.status !== null) event.status = row.status;
  if (row.owner !== null) event.owner = row.owner;
  if (row.milestone_id !== null) event.milestone_id = row.milestone_id;
  if (row.acceptance_id !== null) event.acceptance_id = row.acceptance_id;
  if (provenance !== undefined) event.provenance = provenance;
  return event;
}

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function identityKeyFor(event: PlanEvent): string {
  const planId = event.plan_id;
  switch (event.kind) {
    case 'plan_section':
      return `section:${planId}:${slugify(event.title)}`;
    case 'plan_milestone':
      return `milestone:${planId}:${event.milestone_id ?? slugify(event.title)}`;
    case 'plan_acceptance':
      return `acceptance:${planId}:${event.milestone_id ?? ''}:${event.acceptance_id ?? slugify(event.title)}`;
    case 'plan_test':
      return `test:${planId}:${event.milestone_id ?? ''}:${slugify(event.title)}`;
    case 'plan_decision':
      return `decision:${planId}:${event.parent_id ?? ''}:${slugify(event.title)}`;
  }
}

export function appendPlanEvent(event: PlanEvent): void {
  const db = getIdentityDb();
  db.prepare(
    `INSERT INTO plan_events
       (id, plan_id, parent_id, kind, title, body, status, owner,
        milestone_id, acceptance_id, order_index, author_handle, author_kind,
        ts_millis, evidence_json, provenance_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    event.id,
    event.plan_id,
    event.parent_id ?? null,
    event.kind,
    event.title,
    event.body ?? null,
    event.status ?? null,
    event.owner ?? null,
    event.milestone_id ?? null,
    event.acceptance_id ?? null,
    event.order,
    event.author_handle,
    event.author_kind,
    event.ts_millis,
    JSON.stringify(event.evidence ?? []),
    event.provenance ? JSON.stringify(event.provenance) : null
  );
}

function pickLatestPerIdentityKey(events: PlanEvent[]): PlanEvent[] {
  const latestByKey = new Map<string, PlanEvent>();
  for (const event of events) {
    const key = identityKeyFor(event);
    const incumbent = latestByKey.get(key);
    if (!incumbent || event.ts_millis > incumbent.ts_millis) {
      latestByKey.set(key, event);
    }
  }
  return Array.from(latestByKey.values());
}

function compareByParentThenOrder(left: PlanEvent, right: PlanEvent): number {
  const leftParent = left.parent_id ?? '';
  const rightParent = right.parent_id ?? '';
  if (leftParent !== rightParent) {
    return leftParent < rightParent ? -1 : 1;
  }
  return left.order - right.order;
}

export function projectPlanEvents(planId: string): PlanEvent[] {
  const db = getIdentityDb();
  const rows = db
    .prepare(`SELECT * FROM plan_events WHERE plan_id = ? ORDER BY ts_millis ASC`)
    .all(planId) as PlanEventRow[];
  if (rows.length === 0) return [];
  const events = rows.map(rowToEvent);
  const latest = pickLatestPerIdentityKey(events);
  return latest.sort(compareByParentThenOrder);
}

export function listKnownPlanIds(): string[] {
  const db = getIdentityDb();
  const rows = db
    .prepare(`SELECT DISTINCT plan_id FROM plan_events ORDER BY plan_id ASC`)
    .all() as Array<{ plan_id: string }>;
  return rows.map((row) => row.plan_id);
}

export function resetPlanModeStoreForTests(): void {
  // Test helper: drop every row. Tests that target plan-event projection
  // call this at setup so the SQLite-backed projection starts clean —
  // matches the prior in-memory Map.clear() behaviour.
  const db = getIdentityDb();
  db.prepare(`DELETE FROM plan_events`).run();
}
