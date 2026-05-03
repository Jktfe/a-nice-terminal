// §6.5 Plan Event Payload Types — M3.5 data/projector
// Locked schema: run_events DDL is immutable. These types govern the payload
// column only (application layer).

export const PLAN_EVENT_KINDS = [
  'plan_section',
  'plan_decision',
  'plan_milestone',
  'plan_acceptance',
  'plan_test',
] as const;

export type PlanEventKind = (typeof PLAN_EVENT_KINDS)[number];

export type PlanStatus =
  | 'planned'
  | 'active'
  | 'blocked'
  | 'passing'
  | 'failing'
  | 'done';

export const EVIDENCE_KINDS = [
  'run_event',
  'raw_ref',
  'task',
  'source_url',
  'file',
] as const;

export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export interface EvidenceRef {
  kind: EvidenceKind;
  ref: string;
  label?: string;
}

export interface ProvenanceRef {
  run_event_id?: string;
  fallback?: {
    source?: string;
    author?: string;
    section?: string;
    query?: string;
  };
}

export interface PlanEventPayload {
  plan_id: string;
  parent_id?: string;
  title: string;
  body?: string;
  order: number;
  status?: PlanStatus;
  owner?: string;
  milestone_id?: string;
  acceptance_id?: string;
  evidence?: EvidenceRef[];
  provenance?: ProvenanceRef[];
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

function isString(x: unknown): x is string {
  return typeof x === 'string';
}

function isNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

function isOptionalString(x: unknown): boolean {
  return x === undefined || isString(x);
}

function isOptionalStringArray(x: unknown): boolean {
  return (
    x === undefined || (Array.isArray(x) && x.every(isString))
  );
}

const PLAN_STATUSES: PlanStatus[] = [
  'planned',
  'active',
  'blocked',
  'passing',
  'failing',
  'done',
];

function isValidStatus(x: unknown): x is PlanStatus {
  return isString(x) && PLAN_STATUSES.includes(x as PlanStatus);
}

function isValidEvidenceRef(x: unknown): x is EvidenceRef {
  if (typeof x !== 'object' || x === null) return false;
  const r = x as Record<string, unknown>;
  return (
    isString(r.kind) &&
    EVIDENCE_KINDS.includes(r.kind as EvidenceKind) &&
    isString(r.ref) &&
    (r.label === undefined || isString(r.label))
  );
}

function isValidProvenanceRef(x: unknown): x is ProvenanceRef {
  if (typeof x !== 'object' || x === null) return false;
  const r = x as Record<string, unknown>;
  const hasExact = r.run_event_id === undefined || isString(r.run_event_id);
  const fb = r.fallback;
  const hasFallback =
    fb === undefined ||
    (typeof fb === 'object' &&
      fb !== null &&
      (isOptionalString((fb as Record<string, unknown>).source) &&
        isOptionalString((fb as Record<string, unknown>).author) &&
        isOptionalString((fb as Record<string, unknown>).section) &&
        isOptionalString((fb as Record<string, unknown>).query)));
  return hasExact && hasFallback;
}

export function validatePlanPayload(payload: unknown): ValidationResult<PlanEventPayload> {
  const errors: string[] = [];
  if (typeof payload !== 'object' || payload === null) {
    return { ok: false, errors: ['payload must be an object'] };
  }
  const p = payload as Record<string, unknown>;

  if (!isString(p.plan_id) || p.plan_id.length === 0) {
    errors.push('plan_id must be a non-empty string');
  }
  if (!isString(p.title) || p.title.length === 0) {
    errors.push('title must be a non-empty string');
  }
  if (!isNumber(p.order)) {
    errors.push('order must be a finite number');
  }
  if (p.status !== undefined && !isValidStatus(p.status)) {
    errors.push(`status must be one of ${PLAN_STATUSES.join(', ')}`);
  }
  if (p.parent_id !== undefined && !isString(p.parent_id)) {
    errors.push('parent_id must be a string');
  }
  if (p.milestone_id !== undefined && !isString(p.milestone_id)) {
    errors.push('milestone_id must be a string');
  }
  if (p.acceptance_id !== undefined && !isString(p.acceptance_id)) {
    errors.push('acceptance_id must be a string');
  }
  if (p.body !== undefined && !isString(p.body)) {
    errors.push('body must be a string');
  }
  if (p.owner !== undefined && !isString(p.owner)) {
    errors.push('owner must be a string');
  }
  if (p.evidence !== undefined) {
    if (!Array.isArray(p.evidence)) {
      errors.push('evidence must be an array');
    } else if (!p.evidence.every(isValidEvidenceRef)) {
      errors.push('evidence contains invalid entries');
    }
  }
  if (p.provenance !== undefined) {
    if (!Array.isArray(p.provenance)) {
      errors.push('provenance must be an array');
    } else if (!p.provenance.every(isValidProvenanceRef)) {
      errors.push('provenance contains invalid entries');
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, value: p as unknown as PlanEventPayload };
}

export function validatePlanPayloadString(payload: string): ValidationResult<PlanEventPayload> {
  try {
    const parsed = JSON.parse(payload);
    return validatePlanPayload(parsed);
  } catch (_e) {
    return { ok: false, errors: ['payload is not valid JSON'] };
  }
}
