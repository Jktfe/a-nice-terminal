/**
 * planEvidenceStore — Lane-D PLANS Evidence Harvest.
 *
 * Flattens every `task.evidence[]` array across non-deleted tasks into one
 * searchable corpus so a reader can answer "what proof do we have for X?"
 * without opening 18 task-detail panels.
 *
 * Read-only: never mutates tasks/plans. Backs the `/plans/evidence` route
 * + `/api/plans/evidence` endpoint. Filters (kind / planId / q / limit) are
 * URL-driven so links are shareable.
 *
 * Sort: most recent first by `tasks.created_at_ms` DESC (matches the
 * "what changed recently?" use case the route is built for).
 */

import { getIdentityDb } from './db';
import type { EvidenceRef } from './planModeStore';
import type { TaskStatus } from './taskStore';
import { isTaskStatus } from './taskStore';

export type EvidenceRow = {
  taskId: string;
  taskSubject: string;
  planId: string | null;
  planTitle: string | null;
  status: TaskStatus;
  kind: EvidenceRef['kind'];
  ref: string;
  label: string | null;
  taskCreatedAtMs: number;
};

export type EvidenceStats = {
  byKind: Record<EvidenceRef['kind'], number>;
  total: number;
  withLabel: number;
};

export type EvidenceListOpts = {
  kind?: EvidenceRef['kind'];
  planId?: string;
  q?: string;
  limit?: number;
};

const EVIDENCE_KINDS: ReadonlySet<EvidenceRef['kind']> = new Set<
  EvidenceRef['kind']
>(['run_event', 'task', 'url', 'file', 'chat_message', 'proposal']);

export function isEvidenceKind(value: unknown): value is EvidenceRef['kind'] {
  return typeof value === 'string' && EVIDENCE_KINDS.has(value as EvidenceRef['kind']);
}

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

type Row = {
  id: string;
  subject: string;
  plan_id: string | null;
  status: string;
  evidence: string;
  created_at_ms: number;
  plan_title: string | null;
};

function parseEvidence(raw: string): EvidenceRef[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (v): v is EvidenceRef =>
        !!v &&
        typeof v === 'object' &&
        typeof (v as { kind?: unknown }).kind === 'string' &&
        typeof (v as { ref?: unknown }).ref === 'string' &&
        isEvidenceKind((v as EvidenceRef).kind)
    );
  } catch {
    return [];
  }
}

function clampLimit(limit?: number): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

function fetchAllRows(): EvidenceRow[] {
  // LEFT JOIN plans so legacy implicit plans (no plans row) still resolve
  // planTitle=null gracefully. Filter deleted tasks at SQL — never even
  // parse their evidence JSON.
  const rows = getIdentityDb()
    .prepare(
      `SELECT
         tasks.id            AS id,
         tasks.subject       AS subject,
         tasks.plan_id       AS plan_id,
         tasks.status        AS status,
         tasks.evidence      AS evidence,
         tasks.created_at_ms AS created_at_ms,
         plans.title         AS plan_title
       FROM tasks
       LEFT JOIN plans ON plans.id = tasks.plan_id
       WHERE tasks.status != 'deleted'
       ORDER BY tasks.created_at_ms DESC`
    )
    .all() as Row[];

  const out: EvidenceRow[] = [];
  for (const row of rows) {
    const status: TaskStatus = isTaskStatus(row.status) ? row.status : 'pending';
    const evidence = parseEvidence(row.evidence);
    for (const ev of evidence) {
      out.push({
        taskId: row.id,
        taskSubject: row.subject,
        planId: row.plan_id,
        planTitle: row.plan_title,
        status,
        kind: ev.kind,
        ref: ev.ref,
        label: ev.label ?? null,
        taskCreatedAtMs: row.created_at_ms
      });
    }
  }
  return out;
}

export function listAllEvidence(opts: EvidenceListOpts = {}): EvidenceRow[] {
  const limit = clampLimit(opts.limit);
  const q = opts.q ? opts.q.toLowerCase() : '';
  const all = fetchAllRows();
  const filtered = all.filter((row) => {
    if (opts.kind && row.kind !== opts.kind) return false;
    if (opts.planId && row.planId !== opts.planId) return false;
    if (q) {
      const ref = row.ref.toLowerCase();
      const label = (row.label ?? '').toLowerCase();
      const subj = row.taskSubject.toLowerCase();
      if (!ref.includes(q) && !label.includes(q) && !subj.includes(q)) return false;
    }
    return true;
  });
  return filtered.slice(0, limit);
}

export function evidenceStats(): EvidenceStats {
  const all = fetchAllRows();
  const byKind: Record<EvidenceRef['kind'], number> = {
    run_event: 0,
    task: 0,
    url: 0,
    file: 0,
    chat_message: 0
  };
  let withLabel = 0;
  for (const row of all) {
    byKind[row.kind] += 1;
    if (row.label && row.label.trim().length > 0) withLabel += 1;
  }
  return { byKind, total: all.length, withLabel };
}
